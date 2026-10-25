"""Personalized recommendations: hard constraints, determinism, comfort drift, pace, reasons. No network / API key."""
import datetime as dt
from types import SimpleNamespace

import mongomock
import pytest
from fastapi.testclient import TestClient

from app import agent, db, preference_parser, recommend, store
from app.main import app
from app.models import Access, Difficulty, Terrain, Trailhead, TrailWithDifficulty
from app.recommend import REC_CALIBRATION as C

from tests.conftest import bearer


def trail(tid, level, *, features=(), bus=None, walk=None, bike=None, drive=10, minutes=120, verified=False):
    return TrailWithDifficulty(
        id=tid, name=tid.title(), area="Test", distance_mi=3, elevation_gain_ft=300, loop=True,
        terrain=Terrain(), trailhead=Trailhead(lat=40.8, lon=-77.86, address="x"),
        access=Access(drive_min=drive, bus=bus, walk_from_campus_min=walk, bike_min=bike),
        features=list(features), verified=verified,
        difficulty=Difficulty(level=level, label="x", effort_mi=3, terrain_bump=0, reasons=[], est_time_min=minutes),
        car_free=bool(bus or walk),
    )


def user(has_car=None, modes=(), saved=(), **prefs):
    return {"_id": "u", "profile": {"has_car": has_car},
            "preferences": {"transit_modes": list(modes), **prefs}, "saved_trail_ids": list(saved)}


def hike(tid, days_ago=0, **kw):
    return {"trail_id": tid, "completed_on": dt.datetime(2026, 10, 1) - dt.timedelta(days=days_ago), **kw}


CATALOG = [
    trail("bus-easy", 1, bus="CATA", features=["lake"]),
    trail("bike-easy", 2, bike=20, features=["overlook"]),
    trail("drive-only", 2, features=["overlook", "sunset"]),
    trail("walk-moderate", 3, walk=30),
    trail("bus-hard", 4, bus="CATA"),
    trail("drive-very-hard", 5),
]


def ids(recs):
    return [r.trail_id for r in recs.trails]


# ---------- hard constraints ----------

def test_car_free_users_never_get_drive_only_trails():
    got = recommend.recommend(user(has_car=False), [], k=20, trails=CATALOG)
    assert "drive-only" not in ids(got) and "drive-very-hard" not in ids(got)
    assert all(set(r.reachable_by) <= {"bus", "walk", "bike"} and r.reachable_by for r in got.trails)


def test_car_free_on_the_whole_real_catalog():
    got = recommend.recommend(user(has_car=False, max_level=5), [], k=100)
    assert got.trails
    for r in got.trails:
        a = r.trail.access
        assert a.bus or (a.walk_from_campus_min or 999) <= C["max_walk_min"] or (a.bike_min or 999) <= C["max_bike_min"]


def test_transit_modes_restrict_reach():
    got = recommend.recommend(user(modes=["bus"]), [], k=20, trails=CATALOG)
    assert set(ids(got)) == {"bus-easy"}  # bus-hard is L4: above comfort 2 + 1


def test_nothing_above_comfort_plus_one():
    for base in range(1, 6):
        got = recommend.recommend(user(max_level=base), [], k=100)
        assert all(r.trail.difficulty.level <= got.comfort_level + 1 for r in got.trails)


def test_time_filter_uses_personal_pace():
    catalog = [trail("short", 2, bus="x", minutes=60), trail("long", 2, bus="x", minutes=100)]
    assert ids(recommend.recommend(user(max_time_min=90), [], trails=catalog)) == ["short"]
    slow = [hike("short", duration_min=120), hike("short", 1, duration_min=120)]  # pace 1.8 (clamped from 2.0)
    assert ids(recommend.recommend(user(max_time_min=90), slow, trails=catalog)) == []


# ---------- scoring and determinism ----------

def test_identical_input_identical_output():
    u, logs = user(preferred_features=["view"], max_level=3), [hike("mt-nittany-mike-lynch", rating=5, felt_difficulty=2)]
    first = recommend.recommend(u, logs, k=10)
    assert all(recommend.recommend(u, logs, k=10) == first for _ in range(3))


def test_ties_break_by_trail_id():
    catalog = [trail("b", 2, bus="x"), trail("a", 2, bus="x"), trail("c", 2, bus="x")]
    assert ids(recommend.recommend(user(), [], trails=catalog)) == ["a", "b", "c"]


def test_interests_and_avoid_use_feature_synonyms():
    got = recommend.recommend(user(preferred_features=["view"], avoid=["sunset"]), [], k=20, trails=CATALOG)
    by_id = {r.trail_id: r for r in got.trails}
    assert by_id["bike-easy"].breakdown["feature"] == C["weights"]["feature"]  # "overlook" matches "view"
    assert by_id["drive-only"].breakdown["avoid"] == -C["weights"]["avoid"]
    assert ids(got)[0] == "bike-easy"


def test_saved_novel_repeat_and_rated_terms():
    catalog = [trail("seen", 2, bus="x"), trail("new", 2, bus="x")]
    u = user(saved=["seen"])
    got = {r.trail_id: r for r in recommend.recommend(u, [hike("seen", rating=5)], trails=catalog).trails}
    assert got["seen"].breakdown == {"level": 0, "saved": 1.0, "repeat": -0.5, "rated": 0.5}
    assert got["new"].breakdown == {"level": 0, "novel": 0.8}


def test_score_is_the_sum_of_its_terms():
    for r in recommend.recommend(user(preferred_features=["lake", "view"]), [], k=100).trails:
        assert r.score == pytest.approx(sum(r.breakdown.values()))


def test_every_reason_matches_a_score_term():
    u = user(preferred_features=["view"], avoid=["sunset"], saved=["drive-only"])
    logs = [hike("bike-easy", rating=5)]
    starts = {
        "feature": "Matches your interests", "avoid": "Has things you avoid", "saved": "On your saved list",
        "novel": "You haven't hiked", "repeat": "You've hiked it", "rated": "You rated it highly", "verified": "Trail data checked",
    }
    for r in recommend.recommend(u, logs, k=20, trails=CATALOG).trails:
        for term, prefix in starts.items():
            assert (term in r.breakdown) == any(x.startswith(prefix) for x in r.reasons), (r.trail_id, term)
        assert any("your level" in x for x in r.reasons)  # the level term always explains itself
        assert any(x.startswith("Reachable by") for x in r.reasons)


# ---------- comfort drift and pace ----------

BY_ID = {t.id: t for t in CATALOG}


def test_comfort_defaults_and_drift_by_at_most_one_level():
    assert recommend.estimate_comfort_level(user(), [], BY_ID) == (2, 0.0)
    easier = [hike("walk-moderate", i, felt_difficulty=1) for i in range(5)]  # L3 felt like 1, five times
    harder = [hike("bike-easy", i, felt_difficulty=5) for i in range(5)]
    assert recommend.estimate_comfort_level(user(max_level=3), easier, BY_ID) == (4, -1.0)
    assert recommend.estimate_comfort_level(user(max_level=3), harder, BY_ID) == (2, 1.0)
    assert recommend.estimate_comfort_level(user(max_level=5), easier, BY_ID)[0] == 5  # clamped
    assert recommend.estimate_comfort_level(user(max_level=1), harder, BY_ID)[0] == 1


def test_drift_uses_only_the_last_five_and_ties_stay():
    old_hard = [hike("bike-easy", 100 + i, felt_difficulty=5) for i in range(10)]
    recent_easy = [hike("walk-moderate", i, felt_difficulty=1) for i in range(5)]
    assert recommend.estimate_comfort_level(user(), old_hard + recent_easy, BY_ID)[0] == 3
    split = [hike("walk-moderate", 0, felt_difficulty=1), hike("bike-easy", 1, felt_difficulty=5)]
    assert recommend.estimate_comfort_level(user(), split, BY_ID) == (2, 0.0)
    as_rated = [hike("walk-moderate", 0, felt_difficulty=3)]
    assert recommend.estimate_comfort_level(user(), as_rated, BY_ID) == (2, 0.0)


def test_pace_defaults_median_and_clamp():
    assert recommend.estimate_pace([], BY_ID) == 1.0
    assert recommend.estimate_pace([hike("bus-easy", duration_min=60)], BY_ID) == 1.0  # one hike is not enough
    logs = [hike("bus-easy", duration_min=d) for d in (60, 120, 240)]  # ratios 0.5, 1.0, 2.0
    assert recommend.estimate_pace(logs, BY_ID) == 1.0
    assert recommend.estimate_pace([hike("bus-easy", duration_min=10)] * 2, BY_ID) == C["pace_clamp"][0]
    assert recommend.estimate_pace([hike("bus-easy", duration_min=999)] * 2, BY_ID) == C["pace_clamp"][1]


def test_logs_for_unknown_trails_are_ignored():
    logs = [hike("deleted-trail", felt_difficulty=1, duration_min=10)] * 3
    got = recommend.recommend(user(), logs, trails=CATALOG)
    assert (got.comfort_level, got.pace_multiplier) == (2, 1.0)


def test_demo_mode_does_not_change_recommendations(monkeypatch):
    u, logs = user(has_car=False, preferred_features=["lake"]), [hike("millbrook-marsh", rating=4, felt_difficulty=1)]
    monkeypatch.setenv("DEMO_MODE", "1")
    offline = recommend.recommend(u, logs, k=10)
    monkeypatch.setenv("DEMO_MODE", "0")
    assert recommend.recommend(u, logs, k=10) == offline


# ---------- API ----------

@pytest.fixture
def client(monkeypatch, fake_auth0):
    monkeypatch.setenv("DEMO_MODE", "1")
    db.set_client(mongomock.MongoClient())
    yield TestClient(app)
    db.set_client(None)


def test_recommendations_endpoint_uses_profile_and_log(client):
    h = bearer("auth0|rec")
    client.patch("/me", headers=h, json={"profile": {"has_car": False}, "preferences": {"max_level": 2, "preferred_features": ["lake"]}})
    client.post("/me/hikes", headers=h, json={"trail_id": "millbrook-marsh", "completed_on": "2026-09-01", "duration_min": 60})
    body = client.get("/me/recommendations?k=3", headers=h).json()
    assert body["comfort_level"] == 2 and len(body["trails"]) <= 3
    for r in body["trails"]:
        assert r["trail"]["id"] == r["trail_id"] and "car" not in r["reachable_by"] and r["reasons"]
        assert r["trail"]["difficulty"]["level"] <= 3
    assert client.get("/me/recommendations").status_code == 401


def test_recommendations_need_a_database(monkeypatch, fake_auth0):
    monkeypatch.delenv("MONGODB_URI", raising=False)
    db.set_client(None)
    assert TestClient(app).get("/me/recommendations", headers=bearer()).status_code == 503


def test_chat_demo_uses_the_same_ranking(client):
    h = bearer("auth0|rec2")
    client.patch("/me", headers=h, json={"profile": {"has_car": False}})
    expected = [r["trail_id"] for r in client.get("/me/recommendations?k=3", headers=h).json()["trails"]]
    res = client.post("/chat", headers=h, json={"messages": [{"role": "user", "content": "What should I hike? Recommend something for me"}]}).json()
    assert res["recommended_ids"] == expected and res["tool_log"][0]["tool"] == "recommend_for_me"


def test_anonymous_chat_has_no_personal_ranking(client):
    res = client.post("/chat", json={"messages": [{"role": "user", "content": "recommend something for me"}]}).json()
    assert all(e["tool"] != "recommend_for_me" for e in res["tool_log"])


def test_parse_preferences_suggests_without_saving(client):
    h = bearer("auth0|parse")
    r = client.post("/me/preferences/parse", headers=h, json={"text": "Out of shape, love waterfalls and lakes, hate mud, no car, 2 hours max"})
    body = r.json()
    assert r.status_code == 200 and body["source"] == "offline"
    assert body["max_level"] == 2 and body["avoid"] == ["mud"] and body["max_time_min"] == 120
    assert {"waterfall", "lake"} <= set(body["preferred_features"]) and "car" not in body["transit_modes"]
    assert client.get("/me", headers=h).json()["preferences"]["avoid"] == []  # nothing saved
    assert client.post("/me/preferences/parse", headers=h, json={"text": ""}).status_code == 422
    assert client.post("/me/preferences/parse", json={"text": "hi"}).status_code == 401


def test_parser_falls_back_offline_when_the_api_fails(monkeypatch):
    monkeypatch.delenv("DEMO_MODE", raising=False)
    monkeypatch.setenv("LLM_PROVIDER", "claude")

    class Boom:
        def __init__(self, *a, **k):
            raise preference_parser.anthropic.APIConnectionError(request=None)

    monkeypatch.setattr(preference_parser.anthropic, "Anthropic", Boom)
    assert preference_parser.parse("easy loop with a view").model_dump() == {
        "max_level": 2, "preferred_features": ["view"], "avoid": [], "transit_modes": [],
        "max_time_min": None, "prefers_loop": True, "source": "offline",
    }


def test_parser_uses_gemini_json_output_by_default(monkeypatch):
    monkeypatch.delenv("DEMO_MODE", raising=False)
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    seen = {}

    class FakeGemini:
        def __init__(self): self.models = self
        def generate_content(self, *, model, contents, config):
            seen.update(model=model, contents=contents, config=config)
            return SimpleNamespace(text='{"max_level": 9, "preferred_features": [" Lake ", "lake"], "transit_modes": ["bus"], "prefers_loop": false}')

    monkeypatch.setattr(preference_parser.llm, "gemini_client", FakeGemini)
    out = preference_parser.parse("love lakes, bus only, out and back").model_dump()
    assert out["source"] == "ai" and out["max_level"] is None  # out-of-range level dropped
    assert out["preferred_features"] == ["lake"] and out["transit_modes"] == ["bus"] and out["prefers_loop"] is False
    assert seen["contents"] == "love lakes, bus only, out and back" and seen["config"].response_mime_type == "application/json"
    assert "max_level" in seen["config"].response_json_schema["properties"]


def test_parser_falls_back_offline_when_gemini_fails(monkeypatch):
    monkeypatch.delenv("DEMO_MODE", raising=False)
    monkeypatch.delenv("LLM_PROVIDER", raising=False)

    class BadJSON:
        def __init__(self): self.models = self
        def generate_content(self, **kw): return SimpleNamespace(text="not json")

    monkeypatch.setattr(preference_parser.llm, "gemini_client", BadJSON)
    assert preference_parser.parse("easy loop with a view").source == "offline"


# ---------- agent guardrail ----------

def test_agent_cannot_reorder_or_drop_the_personal_ranking():
    out = recommend.tool_output(recommend.recommend(user(), [], k=3))
    log = [{"tool": "recommend_for_me", "input": {}, "output": out}]
    picked = [t["id"] for t in out["trails"]]
    res = agent._finalize("Here.\nRECOMMENDED: " + ", ".join([picked[-1], "made-up"]), log)
    assert res.recommended_ids == picked


def test_recommend_tool_only_exists_for_signed_in_users():
    assert agent._call_tool("recommend_for_me", {})[1] is True  # unknown without a recommender
    out, err = agent._call_tool("recommend_for_me", {"k": 99}, lambda k: {"k": k})
    assert not err and out == {"k": 8}
    assert store.get("millbrook-marsh")  # sanity: real catalog loads alongside
