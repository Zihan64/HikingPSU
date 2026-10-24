"""Feature search, tool error handling, guardrail and API smoke tests. No network / API key needed."""
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app import agent, store, tools
from app.main import app


# ---------- features search ----------

def ids(**kw):
    return {t.id for t in store.search(limit=100, **kw)}


def test_view_matches_overlook_and_ridge_views():
    got = ids(features=["view"])
    # the data says "overlook", "7 overlooks", "ridge views", "view" ... never the bare word "view"
    assert {"mt-nittany-mike-lynch", "mt-nittany-full-loop", "shingletown-ridge-loop", "indian-steps"} <= got


def test_sunset_and_lake_synonyms():
    assert "mt-nittany-mike-lynch" in ids(features=["sunset"])
    assert {"colyer-lake-hobies", "whipple-dam-loop"} <= ids(features=["lake"])


def test_multiple_features_are_or():
    got = ids(features=["lake", "stream"])
    assert {"colyer-lake-hobies", "shingletown-gap"} <= got


def test_unknown_feature_returns_nothing_instead_of_everything():
    assert ids(features=["zipline"]) == set()


def test_view_plus_car_free_still_finds_mt_nittany():
    got = ids(features=["view"], car_free=True)
    assert "mt-nittany-mike-lynch" in got


def test_search_tool_accepts_string_features_and_clamps_limit():
    out = tools.search_trails(features="view", limit=500)
    assert out["count"] >= 1
    assert out["count"] <= 8


# ---------- tool error handling ----------

def test_unknown_tool_is_an_error_not_an_exception():
    out, is_err = agent._call_tool("delete_everything", {})
    assert is_err and "unknown tool" in out["error"]


def test_bad_tool_arguments_are_an_error_not_an_exception():
    out, is_err = agent._call_tool("search_trails", {"bogus": 1})
    assert is_err and "error" in out


# ---------- guardrail ----------

def _search_log(*trail_ids):
    trails = [{"id": i, "name": store.get(i).name} for i in trail_ids]
    return [{"tool": "search_trails", "input": {}, "output": {"count": len(trails), "trails": trails}}]


def test_guardrail_drops_ids_that_were_never_searched():
    log = _search_log("millbrook-marsh")
    res = agent._finalize("Go here!\nRECOMMENDED: millbrook-marsh, shingletown-ridge-loop, made-up-trail", log)
    assert res.recommended_ids == ["millbrook-marsh"]
    assert "RECOMMENDED" not in res.reply


def test_guardrail_survives_a_failed_search():
    log = [{"tool": "search_trails", "input": {}, "output": {"error": "TypeError: boom"}}]
    res = agent._finalize("Sorry, nothing.\nRECOMMENDED: millbrook-marsh", log)
    assert res.recommended_ids == []


def test_missing_recommended_line_falls_back_to_trail_names_in_text():
    log = _search_log("millbrook-marsh", "arboretum-hartley-wood")
    res = agent._finalize(f"Try {store.get('millbrook-marsh').name}: flat and easy.", log)
    assert res.recommended_ids == ["millbrook-marsh"]


# ---------- live loop with a fake Claude ----------

def _block(**kw):
    return SimpleNamespace(**kw)


class FakeClient:
    """Turn 1: tool call with a bad argument. Turn 2: valid call. Turn 3: final answer."""

    def __init__(self):
        self.calls = []
        self.messages = self

    def create(self, **kw):
        # snapshot: the agent keeps appending to the same list after each call
        self.calls.append({**kw, "messages": list(kw["messages"])})
        n = len(self.calls)
        if n == 1:
            blk = _block(type="tool_use", id="t1", name="search_trails", input={"bogus": 1})
            return _block(stop_reason="tool_use", content=[blk])
        if n == 2:
            blk = _block(type="tool_use", id="t2", name="search_trails", input={"features": ["view"], "car_free": True})
            return _block(stop_reason="tool_use", content=[blk])
        text = _block(type="text", text="Mike Lynch is great.\nRECOMMENDED: mt-nittany-mike-lynch, not-in-db")
        return _block(stop_reason="end_turn", content=[text])


def test_live_loop_recovers_from_a_bad_tool_call(monkeypatch):
    monkeypatch.delenv("DEMO_MODE", raising=False)
    fake = FakeClient()
    monkeypatch.setattr(agent, "_client", lambda: fake)
    res = agent.run([agent.ChatMessage(role="user", content="view, no car")])
    assert res.recommended_ids == ["mt-nittany-mike-lynch"]
    assert [e["tool"] for e in res.tool_log] == ["search_trails", "search_trails"]
    assert "error" in res.tool_log[0]["output"]
    # the failed call was reported back to the model flagged as an error
    sent = fake.calls[1]["messages"][-1]["content"][0]
    assert sent["is_error"] is True


def test_run_falls_back_to_offline_when_the_live_agent_crashes(monkeypatch):
    monkeypatch.delenv("DEMO_MODE", raising=False)

    def boom(*a, **k):
        raise RuntimeError("no api key")

    monkeypatch.setattr(agent, "_run_live", boom)
    res = agent.run([agent.ChatMessage(role="user", content="easy hike, no car")])
    assert res.trails and all(t.car_free for t in res.trails)
    assert "offline" in res.reply.lower()


# ---------- HTTP API ----------

@pytest.fixture
def client():
    return TestClient(app)


def test_health_and_trails(client):
    assert client.get("/health").json()["ok"] is True
    r = client.get("/trails", params={"car_free": True})
    assert r.status_code == 200 and r.json() and all(t["car_free"] for t in r.json())


def test_trail_404(client):
    assert client.get("/trails/does-not-exist").status_code == 404


def test_chat_demo_mode(client, monkeypatch):
    monkeypatch.setenv("DEMO_MODE", "1")
    r = client.post("/chat", json={"messages": [{"role": "user", "content": "easy hike, no car"}]})
    assert r.status_code == 200
    body = r.json()
    assert body["recommended_ids"] and body["trails"]


def test_offline_demo_respects_view_and_difficulty(client, monkeypatch):
    monkeypatch.setenv("DEMO_MODE", "1")

    def ask(text):
        r = client.post("/chat", json={"messages": [{"role": "user", "content": text}]})
        return r.json()["recommended_ids"]

    assert ask("Saturday afternoon, two of us, no car, ~3 hours, want a view")[0] == "mt-nittany-mike-lynch"
    hard = store.get(ask("I have a car, want something hard with rocks on Sunday")[0])
    assert hard.difficulty.level >= 3
    assert ask("zzz nothing recognisable")  # never an empty page


def test_chat_requires_messages(client):
    assert client.post("/chat", json={"messages": []}).status_code == 400
