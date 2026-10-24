"""User database: profile/preferences, hike log, chat history, with Auth0 login. Uses mongomock; no server or network needed."""
import datetime as dt

import mongomock
import pytest
from fastapi.testclient import TestClient

from app import agent, db
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


# ---------- community: feed, trail-card highlights, hearts ----------

def test_highlights_show_tips_until_hikers_comment(client):
    tips = client.get("/reviews/highlights").json()
    assert all(1 <= len(v) <= 2 for v in tips.values()) and len(tips[TRAIL]) == 2
    assert all(c["tip"] and c["accuracy"] is None for c in tips[TRAIL])

    alice = signup(client, "alice@psu.edu")
    client.put(f"/trails/{TRAIL}/reviews/me", headers=alice, json=GOOD)
    client.put(f"/trails/{TRAIL2}/reviews/me", headers=alice, json={**GOOD, "comment": None})
    top = client.get("/reviews/highlights").json()
    assert top[TRAIL][0]["comment"] == "Great ridge views" and top[TRAIL][1]["tip"]  # hikers beat tips on a tie
    assert all(c["tip"] for c in top[TRAIL2])  # a review without a comment isn't highlighted
    # Tips never count as ratings.
    assert client.get("/reviews/summary").json()[TRAIL]["count"] == 1


def test_hearts_rank_comments_and_need_login(client):
    alice, bob = signup(client, "alice@psu.edu"), signup(client, "bob@psu.edu")
    review = client.put(f"/trails/{TRAIL}/reviews/me", headers=alice, json=GOOD).json()
    tip = client.get("/reviews/highlights").json()[TRAIL][1]

    assert client.put(f"/reviews/{tip['id']}/like").status_code == 401
    assert client.put("/reviews/nope/like", headers=bob).status_code == 404
    assert client.put(f"/reviews/{tip['id']}/like", headers=bob).json() == {"likes": 1, "liked": True}
    assert client.put(f"/reviews/{tip['id']}/like", headers=bob).json() == {"likes": 1, "liked": True}  # idempotent
    client.put(f"/reviews/{tip['id']}/like", headers=alice)

    top = client.get("/reviews/highlights", headers=bob).json()[TRAIL]
    assert top[0]["id"] == tip["id"] and top[0]["likes"] == 2 and top[0]["liked"] is True
    assert top[1]["id"] == review["id"] and top[1]["liked"] is False
    assert client.get("/reviews/highlights").json()[TRAIL][0]["liked"] is False  # anonymous viewer

    client.put(f"/reviews/{review['id']}/like", headers=bob)
    listed = client.get(f"/trails/{TRAIL}/reviews", headers=bob).json()["reviews"][0]
    assert listed["likes"] == 1 and listed["liked"] is True
    assert client.delete(f"/reviews/{tip['id']}/like", headers=bob).json() == {"likes": 1, "liked": False}


def test_feed_mixes_trails_and_sorts_by_hearts(client):
    alice, bob = signup(client, "alice@psu.edu"), signup(client, "bob@psu.edu")
    first = client.put(f"/trails/{TRAIL}/reviews/me", headers=alice, json=GOOD).json()
    client.put(f"/trails/{TRAIL2}/reviews/me", headers=bob, json={**GOOD, "comment": "Boardwalk was lovely"})

    recent = client.get("/reviews/feed").json()
    assert [r["trail_id"] for r in recent] == [TRAIL2, TRAIL] and not any(r["tip"] for r in recent)
    assert recent[0]["trail_name"].startswith("Millbrook Marsh")
    client.put(f"/reviews/{first['id']}/like", headers=bob)
    assert client.get("/reviews/feed?sort=top").json()[0]["id"] == first["id"]
    assert [r["trail_id"] for r in client.get(f"/reviews/feed?trail_id={TRAIL2}").json()] == [TRAIL2]
    assert len(client.get("/reviews/feed?limit=1&skip=1").json()) == 1
    assert client.get("/reviews/feed?trail_id=nope").status_code == 404
    assert client.get("/reviews/feed?sort=bogus").status_code == 422


def test_feed_and_hearts_are_for_written_comments_only(client):
    alice, bob = signup(client, "alice@psu.edu"), signup(client, "bob@psu.edu")
    silent = client.put(f"/trails/{TRAIL}/reviews/me", headers=alice, json={**GOOD, "comment": None}).json()
    assert client.get("/reviews/feed").json() == []
    assert client.put(f"/reviews/{silent['id']}/like", headers=bob).status_code == 404

    # Removing the text from a hearted review takes it out of the feed and drops its hearts.
    talky = client.put(f"/trails/{TRAIL}/reviews/me", headers=alice, json=GOOD).json()
    assert client.put(f"/reviews/{talky['id']}/like", headers=bob).json()["likes"] == 1
    client.put(f"/trails/{TRAIL}/reviews/me", headers=alice, json={**GOOD, "comment": "  "})
    assert client.get("/reviews/feed").json() == [] and db.get_db().likes.count_documents({}) == 0


def test_deleting_reviews_and_accounts_removes_their_hearts(client):
    alice, bob = signup(client, "alice@psu.edu"), signup(client, "bob@psu.edu")
    review = client.put(f"/trails/{TRAIL}/reviews/me", headers=alice, json=GOOD).json()
    client.put(f"/reviews/{review['id']}/like", headers=bob)
    client.delete(f"/trails/{TRAIL}/reviews/me", headers=alice)
    assert db.get_db().likes.count_documents({}) == 0

    tip_id = next(iter(client.get("/reviews/highlights").json().values()))[0]["id"]
    client.put(f"/reviews/{tip_id}/like", headers=bob)
    client.delete("/me", headers=bob)
    assert db.get_db().likes.count_documents({}) == 0


def test_highlights_work_without_a_database(monkeypatch, fake_auth0):
    db.set_client(None)
    monkeypatch.delenv("MONGODB_URI", raising=False)
    body = TestClient(app).get("/reviews/highlights").json()
    assert body[TRAIL] and all(c["tip"] and c["likes"] == 0 for c in body[TRAIL])


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
