"""Feature search, tool error handling, guardrail and API smoke tests. No network / API key needed."""
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from google.genai import types

from app import agent, llm, store, tools
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
    monkeypatch.setenv("LLM_PROVIDER", "claude")
    fake = FakeClient()
    monkeypatch.setattr(agent, "_client", lambda: fake)
    res = agent.run([agent.ChatMessage(role="user", content="view, no car")])
    assert res.recommended_ids == ["mt-nittany-mike-lynch"]
    assert [e["tool"] for e in res.tool_log] == ["search_trails", "search_trails"]
    assert "error" in res.tool_log[0]["output"]
    # the failed call was reported back to the model flagged as an error
    sent = fake.calls[1]["messages"][-1]["content"][0]
    assert sent["is_error"] is True


class FakeGemini:
    """Stands in for google.genai.Client: a bad tool call, a good one, then the final answer."""

    def __init__(self):
        self.calls = []
        self.models = self

    def generate_content(self, *, model, contents, config):
        self.calls.append({"model": model, "contents": list(contents), "config": config})
        n = len(self.calls)
        if n == 1:
            return _gemini_reply(calls=[types.FunctionCall(id="c1", name="search_trails", args={"bogus": 1})])
        if n == 2:
            return _gemini_reply(calls=[types.FunctionCall(id="c2", name="search_trails", args={"features": ["view"], "car_free": True})])
        return _gemini_reply(text="Mike Lynch is great.\nRECOMMENDED: mt-nittany-mike-lynch, not-in-db")


def _gemini_reply(text=None, calls=()):
    parts = [types.Part(text=text)] if text else [types.Part(function_call=c, thought_signature=b"sig") for c in calls]
    return types.GenerateContentResponse(candidates=[types.Candidate(content=types.Content(role="model", parts=parts))])


def test_gemini_is_the_default_provider(monkeypatch):
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    assert llm.provider() == "gemini" and llm.model() == llm.GEMINI_MODEL
    monkeypatch.setenv("LLM_PROVIDER", " Claude ")
    assert llm.provider() == "claude" and llm.model() == llm.CLAUDE_MODEL
    monkeypatch.setenv("LLM_PROVIDER", "typo")
    assert llm.provider() == "gemini"


def test_gemini_loop_runs_tools_and_keeps_the_guardrail(monkeypatch):
    monkeypatch.delenv("DEMO_MODE", raising=False)
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    fake = FakeGemini()
    monkeypatch.setattr(llm, "gemini_client", lambda: fake)
    res = agent.run([agent.ChatMessage(role="user", content="view, no car"), agent.ChatMessage(role="assistant", content="ok"),
                     agent.ChatMessage(role="user", content="and close to campus")])
    assert res.recommended_ids == ["mt-nittany-mike-lynch"]  # an id the search never returned is dropped
    assert [e["tool"] for e in res.tool_log] == ["search_trails", "search_trails"]

    first = fake.calls[0]
    assert [c.role for c in first["contents"]] == ["user", "model", "user"]
    assert {d.name for d in first["config"].tools[0].function_declarations} >= {"search_trails", "get_weather"}
    assert first["config"].automatic_function_calling.disable is True
    # the bad call went back as an error, answering the call's id, after the model turn with its signature intact
    model_turn, answer = fake.calls[1]["contents"][-2:]
    assert model_turn.parts[0].thought_signature == b"sig"
    fr = answer.parts[0].function_response
    assert fr.id == "c1" and fr.name == "search_trails" and "error" in fr.response
    assert "output" in fake.calls[2]["contents"][-1].parts[0].function_response.response


def test_gemini_failure_falls_back_to_offline(monkeypatch):
    monkeypatch.delenv("DEMO_MODE", raising=False)
    monkeypatch.delenv("LLM_PROVIDER", raising=False)

    def no_key():
        raise ValueError("Missing key inputs argument!")

    monkeypatch.setattr(llm, "gemini_client", no_key)
    res = agent.run([agent.ChatMessage(role="user", content="easy hike, no car")])
    assert res.trails and "offline" in res.reply.lower()


def test_empty_gemini_reply_falls_back_to_offline(monkeypatch):
    monkeypatch.delenv("DEMO_MODE", raising=False)
    monkeypatch.delenv("LLM_PROVIDER", raising=False)

    class Empty:
        def __init__(self): self.models = self
        def generate_content(self, **kw):
            return types.GenerateContentResponse(candidates=[types.Candidate(content=types.Content(role="model", parts=[]), finish_reason="MAX_TOKENS")])

    monkeypatch.setattr(llm, "gemini_client", Empty)
    res = agent.run([agent.ChatMessage(role="user", content="easy hike, no car")])
    assert res.trails and "offline" in res.reply.lower()


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
