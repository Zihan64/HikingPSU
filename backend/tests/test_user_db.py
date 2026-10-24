"""User database: accounts, profile/preferences, hike log, chat history. Uses mongomock; no server needed."""
import datetime as dt

import mongomock
import pytest
from fastapi.testclient import TestClient

from app import agent, db
from app.main import app
from app.models import ChatResponse

TRAIL = "mt-nittany-mike-lynch"
TRAIL2 = "millbrook-marsh"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(agent, "run", lambda messages, profile=None: _fake_run(messages, profile))
    db.set_client(mongomock.MongoClient())
    yield TestClient(app)
    db.set_client(None)


seen_profiles: list = []


def _fake_run(messages, profile):
    seen_profiles.append(profile)
    return ChatResponse(reply="hi", recommended_ids=[], trails=[])


def signup(client, email="a@psu.edu", password="correct horse"):
    r = client.post("/auth/register", json={"email": email, "password": password})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# ---------- auth ----------

def test_register_login_and_duplicate(client):
    signup(client)
    assert client.post("/auth/register", json={"email": "A@PSU.edu", "password": "another pass"}).status_code == 409
    assert client.post("/auth/login", json={"email": "a@psu.edu", "password": "correct horse"}).status_code == 200
    assert client.post("/auth/login", json={"email": "a@psu.edu", "password": "wrong password"}).status_code == 401
    assert client.post("/auth/login", json={"email": "nobody@psu.edu", "password": "correct horse"}).status_code == 401


def test_password_is_hashed_and_never_returned(client):
    h = signup(client)
    stored = db.get_db().users.find_one()
    assert stored["password_hash"].startswith("scrypt$") and "correct horse" not in stored["password_hash"]
    assert "password" not in client.get("/me", headers=h).text


def test_bad_inputs_and_tokens(client):
    assert client.post("/auth/register", json={"email": "nope", "password": "correct horse"}).status_code == 422
    assert client.post("/auth/register", json={"email": "a@b.co", "password": "short"}).status_code == 422
    assert client.get("/me").status_code == 401
    assert client.get("/me", headers={"Authorization": "Bearer garbage"}).status_code == 401


# ---------- profile & preferences ----------

def test_patch_only_changes_sent_fields(client):
    h = signup(client)
    r = client.patch("/me", headers=h, json={"profile": {"has_car": False, "fitness": 2}})
    assert r.json()["profile"]["has_car"] is False
    r = client.patch("/me", headers=h, json={"preferences": {"preferred_features": ["view"], "max_level": 3}})
    body = r.json()
    assert body["profile"]["fitness"] == 2  # untouched by the second patch
    assert body["preferences"] == {
        "preferred_features": ["view"], "max_level": 3, "max_time_min": None, "max_drive_min": None, "notes": None,
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


def test_no_database_configured_gives_503_but_trails_still_work(monkeypatch):
    db.set_client(None)
    monkeypatch.delenv("MONGODB_URI", raising=False)
    c = TestClient(app)
    assert c.post("/auth/login", json={"email": "a@b.co", "password": "whatever1"}).status_code == 503
    assert c.get("/trails").status_code == 200


# ---------- account deletion ----------

def test_delete_account_removes_everything(client):
    h = signup(client)
    client.post("/me/hikes", headers=h, json={"trail_id": TRAIL, "completed_on": "2026-09-01"})
    client.post("/chat", headers=h, json={"messages": [{"role": "user", "content": "hi"}]})
    assert client.delete("/me", headers=h).status_code == 204
    d = db.get_db()
    assert d.users.count_documents({}) == d.hike_logs.count_documents({}) == d.chat_sessions.count_documents({}) == 0
    assert client.get("/me", headers=h).status_code == 401
