"""User database: profile/preferences, hike log, chat history, with Auth0 login. Uses mongomock; no server or network needed."""
import datetime as dt

import mongomock
import pytest
from fastapi.testclient import TestClient

from app import agent, db, users
from app.main import app
from app.models import ChatResponse

from tests.conftest import bearer

TRAIL = "mt-nittany-mike-lynch"
TRAIL2 = "millbrook-marsh"


@pytest.fixture
def client(monkeypatch, fake_auth0):
    monkeypatch.setattr(agent, "run", lambda messages, profile=None, **kw: _fake_run(messages, profile))
    db.set_client(mongomock.MongoClient())
    yield TestClient(app)
    db.set_client(None)


seen_profiles: list = []


def _fake_run(messages, profile):
    seen_profiles.append(profile)
    return ChatResponse(reply="hi", recommended_ids=[], trails=[])


def signup(client, email="a@psu.edu"):
    """Log in as a fresh Auth0 user; the first /me call creates the user's document."""
    h = bearer("auth0|" + email.split("@")[0])
    assert client.get("/me", headers=h).status_code == 200
    return h


# ---------- login (Auth0) ----------

def test_first_login_creates_user_once(client):
    h = bearer("auth0|alice")
    first = client.get("/me", headers=h).json()
    assert first["id"] == "auth0|alice" and first["email"] == "alice@psu.edu"
    assert first["profile"]["display_name"] == "Alice"
    assert client.get("/me", headers=h).json()["created_at"] == first["created_at"]
    assert db.get_db().users.count_documents({}) == 1


def test_no_password_data_is_stored(client):
    h = signup(client)
    stored = db.get_db().users.find_one()
    assert stored["_id"] == "auth0|a"
    assert not any("password" in k for k in stored)
    assert "password" not in client.get("/me", headers=h).text


def test_users_without_email_or_sharing_one_both_work(client, monkeypatch):
    monkeypatch.setattr("app.auth.fetch_profile", lambda identity: {})  # e.g. /userinfo unreachable
    assert client.get("/me", headers=bearer("auth0|x")).status_code == 200
    assert client.get("/me", headers=bearer("google-oauth2|y")).status_code == 200
    assert db.get_db().users.count_documents({}) == 2


def test_bad_or_missing_tokens(client):
    assert client.get("/me").status_code == 401
    assert client.get("/me", headers={"Authorization": "Bearer garbage"}).status_code == 401
    assert client.get("/me", headers=bearer(aud="https://someone-else")).status_code == 401
    # a bad token on /chat is a 401 too (an absent one is anonymous)
    assert client.post("/chat", headers={"Authorization": "Bearer garbage"},
                       json={"messages": [{"role": "user", "content": "hi"}]}).status_code == 401


# ---------- profile & preferences ----------

def test_patch_only_changes_sent_fields(client):
    h = signup(client)
    r = client.patch("/me", headers=h, json={"profile": {"has_car": False, "fitness": 2}})
    assert r.json()["profile"]["has_car"] is False
    r = client.patch("/me", headers=h, json={"preferences": {"preferred_features": ["view"], "max_level": 3}})
    body = r.json()
    assert body["profile"]["fitness"] == 2  # untouched by the second patch
    assert body["preferences"] == {
        "preferred_features": ["view"], "avoid": [], "transit_modes": [],"preferred_seasons": [], "prefers_loop": None,
        "max_level": 3, "max_time_min": None, "max_drive_min": None, "notes": None,
    }
    assert client.patch("/me", headers=h, json={"profile": {"fitness": 9}}).status_code == 422
    # explicit null clears
    assert client.patch("/me", headers=h, json={"profile": {"fitness": None}}).json()["profile"]["fitness"] is None


def test_saved_trails(client):
    h = signup(client)
    assert client.put(f"/me/saved/{TRAIL}", headers=h).json()["saved_trail_ids"] == [TRAIL]
    assert client.put(f"/me/saved/{TRAIL}", headers=h).json()["saved_trail_ids"] == [TRAIL]  # idempotent
    assert client.put("/me/saved/nope", headers=h).status_code == 404
    assert client.delete(f"/me/saved/{TRAIL}", headers=h).json()["saved_trail_ids"] == []


# ---------- hike log ----------

def test_hike_log_crud_and_stats(client):
    h = signup(client)
    r = client.post("/me/hikes", headers=h, json={"trail_id": TRAIL, "completed_on": "2026-09-01", "rating": 5})
    assert r.status_code == 201
    hike = r.json()
    assert hike["trail_name"] and hike["completed_on"] == "2026-09-01"
    client.post("/me/hikes", headers=h, json={"trail_id": TRAIL2, "completed_on": "2026-10-01"})
    client.post("/me/hikes", headers=h, json={"trail_id": TRAIL, "completed_on": "2026-10-10"})  # repeat is allowed

    listed = client.get("/me/hikes", headers=h).json()
    assert [x["completed_on"] for x in listed] == ["2026-10-10", "2026-10-01", "2026-09-01"]  # newest first
    stats = client.get("/me/hikes/stats", headers=h).json()
    assert stats["total_hikes"] == 3 and stats["unique_trails"] == 2 and stats["total_distance_mi"] > 0

    r = client.patch(f"/me/hikes/{hike['id']}", headers=h, json={"notes": "great views", "rating": 4})
    assert r.json()["notes"] == "great views" and r.json()["rating"] == 4
    assert client.delete(f"/me/hikes/{hike['id']}", headers=h).status_code == 204
    assert client.delete(f"/me/hikes/{hike['id']}", headers=h).status_code == 404


def test_hike_validation(client):
    h = signup(client)
    assert client.post("/me/hikes", headers=h, json={"trail_id": "nope", "completed_on": "2026-01-01"}).status_code == 404
    future = (dt.date.today() + dt.timedelta(days=30)).isoformat()
    assert client.post("/me/hikes", headers=h, json={"trail_id": TRAIL, "completed_on": future}).status_code == 422
    assert client.post("/me/hikes", headers=h, json={"trail_id": TRAIL, "completed_on": "2026-01-01", "rating": 6}).status_code == 422
    assert client.get("/me/hikes/zzz", headers=h).status_code in (404, 405)


def test_users_cannot_touch_each_others_data(client):
    alice, bob = signup(client, "alice@psu.edu"), signup(client, "bob@psu.edu")
    hike_id = client.post("/me/hikes", headers=alice, json={"trail_id": TRAIL, "completed_on": "2026-09-01"}).json()["id"]
    assert client.patch(f"/me/hikes/{hike_id}", headers=bob, json={"notes": "x"}).status_code == 404
    assert client.delete(f"/me/hikes/{hike_id}", headers=bob).status_code == 404
    assert client.get("/me/hikes", headers=bob).json() == []

    chat = client.post("/chat", headers=alice, json={"messages": [{"role": "user", "content": "hi"}]}).json()
    assert client.get(f"/me/chats/{chat['session_id']}", headers=bob).status_code == 404
    assert client.delete(f"/me/chats/{chat['session_id']}", headers=bob).status_code == 404


# ---------- chat history ----------

def test_chat_anonymous_is_unchanged_and_not_saved(client):
    r = client.post("/chat", json={"messages": [{"role": "user", "content": "hi"}]})
    assert r.status_code == 200 and r.json()["session_id"] is None
    assert db.get_db().chat_sessions.count_documents({}) == 0


def test_chat_saves_and_continues_session(client):
    h = signup(client)
    first = client.post("/chat", headers=h, json={"messages": [{"role": "user", "content": "easy hike with a view?"}]}).json()
    sid = first["session_id"]
    assert sid
    history = [
        {"role": "user", "content": "easy hike with a view?"},
        {"role": "assistant", "content": "hi"},
        {"role": "user", "content": "and a lake?"},
    ]
    second = client.post("/chat", headers=h, json={"messages": history, "session_id": sid}).json()
    assert second["session_id"] == sid  # continued, and old turns were not duplicated

    chat = client.get(f"/me/chats/{sid}", headers=h).json()
    assert [m["content"] for m in chat["messages"]] == ["easy hike with a view?", "hi", "and a lake?", "hi"]
    assert chat["title"] == "easy hike with a view?" and chat["message_count"] == 4
    assert [c["id"] for c in client.get("/me/chats", headers=h).json()] == [sid]

    assert client.post("/chat", headers=h, json={"messages": history, "session_id": "bogus"}).json()["session_id"] != sid
    assert client.delete(f"/me/chats/{sid}", headers=h).status_code == 204
    assert client.get(f"/me/chats/{sid}", headers=h).status_code == 404


def test_chat_passes_stored_profile_and_history_to_agent(client):
    h = signup(client)
    client.patch("/me", headers=h, json={"profile": {"has_car": False, "fitness": 2}, "preferences": {"max_level": 2}})
    client.post("/me/hikes", headers=h, json={"trail_id": TRAIL, "completed_on": "2026-09-01", "rating": 5})
    seen_profiles.clear()
    client.post("/chat", headers=h, json={"messages": [{"role": "user", "content": "hi"}], "profile": {"has_car": True}})
    p = seen_profiles[-1]
    assert p["has_car"] is True  # the live request value beats the stored one
    assert p["fitness"] == 2 and p["preferences"] == {"max_level": 2}
    assert p["completed_trail_ids"] == [TRAIL] and p["favorite_trail_ids"] == [TRAIL]


def test_chat_survives_database_outage(client, monkeypatch):
    h = signup(client)

    def boom():
        raise RuntimeError("mongo down")

    monkeypatch.setattr("app.chats.get_db", boom)
    monkeypatch.setattr("app.users.get_db", boom)
    r = client.post("/chat", headers=h, json={"messages": [{"role": "user", "content": "hi"}]})
    assert r.status_code == 200 and r.json()["reply"] == "hi" and r.json()["session_id"] is None


def test_no_database_configured_gives_503_but_trails_still_work(monkeypatch, fake_auth0):
    db.set_client(None)
    monkeypatch.delenv("MONGODB_URI", raising=False)
    c = TestClient(app)
    assert c.get("/me", headers=bearer()).status_code == 503
    assert c.get("/trails").status_code == 200


# ---------- account deletion ----------

def test_delete_account_removes_everything(client):
    h = signup(client)
    client.post("/me/hikes", headers=h, json={"trail_id": TRAIL, "completed_on": "2026-09-01"})
    client.post("/chat", headers=h, json={"messages": [{"role": "user", "content": "hi"}]})
    assert client.delete("/me", headers=h).status_code == 204
    d = db.get_db()
    assert d.users.count_documents({}) == d.hike_logs.count_documents({}) == d.chat_sessions.count_documents({}) == 0
    # The Auth0 login itself still exists, so logging in again starts a fresh, empty profile.
    again = client.get("/me", headers=h).json()
    assert again["saved_trail_ids"] == [] and client.get("/me/hikes", headers=h).json() == []


def test_delete_account_removes_every_record_and_only_mine(client):
    alice, bob = signup(client, "alice@psu.edu"), signup(client, "bob@psu.edu")
    for h in (alice, bob):
        client.put("/me/registration", headers=h, json=FORM)
        client.put(f"/me/saved/{TRAIL}", headers=h)
        client.post("/me/hikes", headers=h, json={"trail_id": TRAIL, "completed_on": "2026-09-01"})
        client.post("/chat", headers=h, json={"messages": [{"role": "user", "content": "hi"}]})
        client.put(f"/trails/{TRAIL}/reviews/me", headers=h, json=GOOD)
    assert client.delete("/me", headers=alice).status_code == 204
    d = db.get_db()
    for name in d.list_collection_names():
        assert d[name].count_documents({"$or": [{"_id": "auth0|alice"}, {"user_id": "auth0|alice"}]}) == 0, name
    assert d.users.count_documents({}) == d.hike_logs.count_documents({}) == d.chat_sessions.count_documents({}) == d.reviews.count_documents({}) == 1
    # signing in again (the Auth0 login wasn't deleted here) starts over with the sign-up form
    assert client.get("/me", headers=alice).json()["registered"] is False


def test_delete_account_also_deletes_auth0_login_when_configured(client, monkeypatch):
    h = signup(client)
    calls = []

    class Resp:
        def __init__(self, body=None): self.body = body
        def raise_for_status(self): pass
        def json(self): return self.body

    monkeypatch.setenv("AUTH0_MGMT_CLIENT_ID", "mgmt-id")
    monkeypatch.setenv("AUTH0_MGMT_CLIENT_SECRET", "mgmt-secret")
    monkeypatch.setattr("app.auth.httpx.post", lambda url, **kw: calls.append(("POST", url, kw["json"])) or Resp({"access_token": "mgmt-token"}))
    monkeypatch.setattr("app.auth.httpx.delete", lambda url, **kw: calls.append(("DELETE", url, kw["headers"])) or Resp())
    assert client.delete("/me", headers=h).status_code == 204
    (_, token_url, body), (_, delete_url, headers) = calls
    assert token_url.endswith("/oauth/token") and body["client_id"] == "mgmt-id" and body["audience"].endswith("/api/v2/")
    assert delete_url.endswith("/api/v2/users/auth0%7Ca") and headers["Authorization"] == "Bearer mgmt-token"
    assert db.get_db().users.count_documents({}) == 0


def test_delete_account_still_clears_database_if_auth0_fails(client, monkeypatch):
    h = signup(client)
    monkeypatch.setenv("AUTH0_MGMT_CLIENT_ID", "mgmt-id")
    monkeypatch.setenv("AUTH0_MGMT_CLIENT_SECRET", "mgmt-secret")
    def boom(*a, **kw): raise RuntimeError("auth0 down")
    monkeypatch.setattr("app.auth.httpx.post", boom)
    assert client.delete("/me", headers=h).status_code == 204
    assert db.get_db().users.count_documents({}) == 0


# ---------- trail reviews ----------

GOOD = {"accuracy": 4, "difficulty": 3, "enjoyment": 5, "comment": "  Great ridge views  "}


def test_reviews_public_read_needs_account_to_write(client):
    assert client.get(f"/trails/{TRAIL}/reviews").json() == {
        "summary": {"count": 0, "accuracy": None, "difficulty": None, "enjoyment": None}, "reviews": [],
    }
    assert client.put(f"/trails/{TRAIL}/reviews/me", json=GOOD).status_code == 401
    assert client.get("/trails/nope/reviews").status_code == 404
    assert client.put("/trails/nope/reviews/me", headers=signup(client), json=GOOD).status_code == 404


def test_review_create_update_and_summary(client):
    alice, bob = signup(client, "alice@psu.edu"), signup(client, "bob@psu.edu")
    client.patch("/me", headers=alice, json={"profile": {"display_name": "Alice"}})
    client.patch("/me", headers=bob, json={"profile": {"display_name": None}})

    r = client.put(f"/trails/{TRAIL}/reviews/me", headers=alice, json=GOOD)
    assert r.status_code == 200
    assert r.json()["comment"] == "Great ridge views" and r.json()["author"] == "Alice" and r.json()["mine"] is True
    client.put(f"/trails/{TRAIL}/reviews/me", headers=bob, json={"accuracy": 2, "difficulty": 5, "enjoyment": 3})

    # re-rating replaces, not duplicates
    client.put(f"/trails/{TRAIL}/reviews/me", headers=alice, json={**GOOD, "enjoyment": 4})
    body = client.get(f"/trails/{TRAIL}/reviews", headers=alice).json()
    assert len(body["reviews"]) == 2
    assert body["summary"] == {"count": 2, "accuracy": 3.0, "difficulty": 4.0, "enjoyment": 3.5}
    mine = {x["author"]: x["mine"] for x in body["reviews"]}
    assert mine == {"Alice": True, "Hiker": False}  # no display name -> "Hiker", never the email
    assert "psu.edu" not in client.get(f"/trails/{TRAIL}/reviews").text
    assert all(not x["mine"] for x in client.get(f"/trails/{TRAIL}/reviews").json()["reviews"])

    client.put(f"/trails/{TRAIL2}/reviews/me", headers=bob, json=GOOD)
    summaries = client.get("/reviews/summary").json()
    assert summaries[TRAIL]["count"] == 2 and summaries[TRAIL2]["count"] == 1


def test_review_validation(client):
    h = signup(client)
    for bad in ({**GOOD, "accuracy": 0}, {**GOOD, "difficulty": 6}, {**GOOD, "comment": "x" * 1001}):
        assert client.put(f"/trails/{TRAIL}/reviews/me", headers=h, json=bad).status_code == 422
    assert client.put(f"/trails/{TRAIL}/reviews/me", headers=h, json={"accuracy": 3}).status_code == 422
    blank = client.put(f"/trails/{TRAIL}/reviews/me", headers=h, json={**GOOD, "comment": "   "})
    assert blank.status_code == 200 and blank.json()["comment"] is None  # comment is optional


def test_review_delete_is_own_only_and_account_delete_removes_reviews(client):
    alice, bob = signup(client, "alice@psu.edu"), signup(client, "bob@psu.edu")
    client.put(f"/trails/{TRAIL}/reviews/me", headers=alice, json=GOOD)
    assert client.delete(f"/trails/{TRAIL}/reviews/me", headers=bob).status_code == 404
    assert len(client.get(f"/trails/{TRAIL}/reviews").json()["reviews"]) == 1
    assert client.delete(f"/trails/{TRAIL}/reviews/me", headers=alice).status_code == 204
    assert client.delete(f"/trails/{TRAIL}/reviews/me", headers=alice).status_code == 404

    client.put(f"/trails/{TRAIL}/reviews/me", headers=alice, json=GOOD)
    client.delete("/me", headers=alice)
    assert db.get_db().reviews.count_documents({}) == 0


def test_email_like_auth0_name_is_never_shown(client, monkeypatch):
    # Auth0 password signups get name == email; that must not become the public review author.
    monkeypatch.setattr("app.auth.fetch_profile", lambda identity: {"email": "c@psu.edu", "name": "c@psu.edu"})
    h = bearer("auth0|c")
    assert client.get("/me", headers=h).json()["profile"]["display_name"] is None
    r = client.put(f"/trails/{TRAIL}/reviews/me", headers=h, json=GOOD).json()
    assert r["author"] == "Hiker" and "psu.edu" not in client.get(f"/trails/{TRAIL}/reviews").text


# ---------- dashboard insights ----------

def test_insights_empty_user(client):
    h = signup(client)
    body = client.get("/me/insights", headers=h).json()
    assert body["stats"]["total_hikes"] == 0
    assert body["level_counts"] == {str(i): 0 for i in range(1, 6)}
    assert body["avg_rating"] is None and body["comfortable_level"] is None
    assert body["profile_completeness"] == 0


def test_insights_from_hikes_and_new_profile_fields(client):
    h = signup(client)
    patch = {"profile": {"age": 21, "group_type": "friends"}, "preferences": {"transit_modes": ["bus", "walk"], "prefers_loop": True}}
    me = client.patch("/me", json=patch, headers=h).json()
    assert me["profile"]["age"] == 21 and me["preferences"]["transit_modes"] == ["bus", "walk"]
    for trail, rating in ((TRAIL, 5), (TRAIL2, 2)):
        r = client.post("/me/hikes", json={"trail_id": trail, "completed_on": "2025-10-04", "rating": rating, "felt_difficulty": 3}, headers=h)
        assert r.status_code == 201
    body = client.get("/me/insights", headers=h).json()
    assert body["stats"]["unique_trails"] == 2
    assert sum(body["level_counts"].values()) == 2
    assert body["avg_rating"] == 3.5
    assert body["season_counts"]["fall"] == 2
    assert body["profile_completeness"] > 0
    assert len(body["recent_hikes"]) == 2
    from app import store
    for f in store.get(TRAIL).features:
        if f not in store.get(TRAIL2).features:
            assert body["feature_affinity"][f] == 1.0


def test_insights_requires_login(client):
    assert client.get("/me/insights").status_code == 401


# ---------- sign-up form ----------

FORM = {  # pages 1 and 2; page 3 (contact) skipped
    "full_name": "Alice Nittany", "gender": "female", "birthday": "2004-05-06",
    "hiking_experience": 0, "transit_modes": ["bus", "walk"],
}


def test_new_user_is_unregistered_until_form_is_saved(client):
    h = signup(client)
    assert client.get("/me", headers=h).json()["registered"] is False
    r = client.put("/me/registration", headers=h, json=FORM)
    assert r.status_code == 200
    body = r.json()
    assert body["registered"] is True
    p = body["profile"]
    assert p["full_name"] == "Alice Nittany" and p["gender"] == "female" and p["birthday"] == "2004-05-06"
    assert p["hiking_experience"] == 0 and p["is_psu_student"] is None  # PSU question left unanswered
    assert p["secondary_email"] is None and p["phone"] is None and p["address"] is None
    assert body["email"] == "a@psu.edu"  # the login email is never touched by the form
    assert client.get("/me", headers=h).json()["profile"] == p  # persisted (birthday round-trips through BSON)


def test_transport_is_saved_and_has_car_follows_it(client):
    h = signup(client)
    body = client.put("/me/registration", headers=h, json=FORM).json()
    assert body["preferences"]["transit_modes"] == ["bus", "walk"] and body["profile"]["has_car"] is False
    body = client.put("/me/registration", headers=h, json={**FORM, "transit_modes": ["car", "bike", "car"]}).json()
    assert body["preferences"]["transit_modes"] == ["car", "bike"] and body["profile"]["has_car"] is True


def test_registration_fills_recommender_levels(client):
    h = signup(client)
    body = client.put("/me/registration", headers=h, json=FORM).json()
    assert body["preferences"]["max_level"] == 1 and body["profile"]["fitness"] == 1  # never hiked
    assert body["profile"]["age"] == users.age_on(dt.date(2004, 5, 6), dt.date.today())
    # levels the user already has (from the first submit, or set on the dashboard) are not overwritten
    body = client.put("/me/registration", headers=h, json={**FORM, "hiking_experience": 5}).json()
    assert body["preferences"]["max_level"] == 1 and body["profile"]["fitness"] == 1


def test_registration_keeps_levels_set_on_the_dashboard(client):
    h = signup(client)
    client.patch("/me", headers=h, json={"profile": {"fitness": 4}, "preferences": {"max_level": 3}})
    body = client.put("/me/registration", headers=h, json=FORM).json()
    assert body["profile"]["fitness"] == 4 and body["preferences"]["max_level"] == 3


def test_age_on():
    assert users.age_on(dt.date(2000, 5, 6), dt.date(2026, 5, 5)) == 25
    assert users.age_on(dt.date(2000, 5, 6), dt.date(2026, 5, 6)) == 26


def test_psu_student_answer(client):
    h = signup(client)
    assert client.put("/me/registration", headers=h, json={**FORM, "is_psu_student": True}).json()["profile"]["is_psu_student"] is True
    assert client.put("/me/registration", headers=h, json={**FORM, "is_psu_student": False}).json()["profile"]["is_psu_student"] is False


def test_contact_page_is_optional_and_editable(client):
    h = signup(client)
    first = client.put("/me/registration", headers=h, json={
        **FORM, "secondary_email": " Alice@Example.com ", "phone": "+1 (814) 555-0100", "address": "  123 College Ave, State College ",
    }).json()["profile"]
    assert first["secondary_email"] == "alice@example.com" and first["phone"] == "+1 (814) 555-0100"
    assert first["address"] == "123 College Ave, State College"
    registered_at = db.get_db().users.find_one()["registered_at"]
    kept = client.put("/me/registration", headers=h, json=FORM).json()["profile"]  # skipped page 3: keep what's there
    assert kept["phone"] == "+1 (814) 555-0100"
    cleared = client.put("/me/registration", headers=h, json={**FORM, "secondary_email": "", "phone": None, "address": ""}).json()["profile"]
    assert cleared["secondary_email"] is None and cleared["phone"] is None and cleared["address"] is None
    assert db.get_db().users.find_one()["registered_at"] == registered_at


def test_registration_validation(client):
    h = signup(client)
    future = (dt.date.today() + dt.timedelta(days=1)).isoformat()
    for bad in [
        {k: v for k, v in FORM.items() if k != "gender"},        # required field missing
        {k: v for k, v in FORM.items() if k != "transit_modes"},
        {**FORM, "full_name": "   "},
        {**FORM, "gender": "custom"},                              # custom needs a description
        {**FORM, "gender": "other"},
        {**FORM, "birthday": future},
        {**FORM, "hiking_experience": 6},
        {**FORM, "hiking_experience": -1},
        {**FORM, "transit_modes": []},
        {**FORM, "transit_modes": ["plane"]},
        {**FORM, "is_psu_student": "maybe"},
        {**FORM, "secondary_email": "not-an-email"},
        {**FORM, "phone": "call me"},
        {**FORM, "address": "x" * 201},
    ]:
        assert client.put("/me/registration", headers=h, json=bad).status_code == 422, bad
    assert client.get("/me", headers=h).json()["registered"] is False
    ok = client.put("/me/registration", headers=h, json={**FORM, "gender": "custom", "gender_custom": "Non-binary"}).json()
    assert ok["profile"]["gender"] == "custom" and ok["profile"]["gender_custom"] == "Non-binary"
    assert client.put("/me/registration", json=FORM).status_code == 401


def test_legacy_single_transport_answer_is_replaced(client):
    h = signup(client)
    db.get_db().users.update_one({}, {"$set": {"profile.transport": "bike_walk"}})  # saved by the first form version
    assert client.get("/me", headers=h).status_code == 200  # old documents still load
    client.put("/me/registration", headers=h, json=FORM)
    assert "transport" not in db.get_db().users.find_one()["profile"]


def test_registration_names_reviews_by_first_name_only(client, monkeypatch):
    monkeypatch.setattr("app.auth.fetch_profile", lambda identity: {"email": "c@psu.edu", "name": "c@psu.edu"})
    h = bearer("auth0|c")
    assert client.put("/me/registration", headers=h, json=FORM).json()["profile"]["display_name"] == "Alice"


def test_agent_assumes_a_car_when_the_user_has_one_and_never_sees_personal_details(client):
    h = signup(client)
    client.put("/me/registration", headers=h, json={
        **FORM, "transit_modes": ["car"], "is_psu_student": True,
        "phone": "814-555-0100", "secondary_email": "x@y.com", "address": "1 Main St",
    })
    seen_profiles.clear()
    client.post("/chat", headers=h, json={"messages": [{"role": "user", "content": "hi"}]})
    profile = seen_profiles[-1]
    assert profile["has_car"] is True and profile["preferences"]["transit_modes"] == ["car"]
    assert profile["hiking_experience"] == 0 and profile["is_psu_student"] is True
    for private in ("full_name", "gender", "birthday", "phone", "secondary_email", "address"):
        assert private not in profile


def test_patch_can_edit_birthday(client):
    h = signup(client)
    r = client.patch("/me", headers=h, json={"profile": {"birthday": "2000-01-02"}})
    assert r.status_code == 200 and r.json()["profile"]["birthday"] == "2000-01-02"
