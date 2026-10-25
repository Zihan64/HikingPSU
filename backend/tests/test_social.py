"""Public profiles, usernames, people search and follows. mongomock; no server or network."""
import datetime as dt

import mongomock
import pytest
from fastapi.testclient import TestClient

from app import db, social
from app.main import app

from tests.conftest import bearer

FORM = {"full_name": "Alice Nittany", "gender": "female", "birthday": "2004-05-06",
        "hiking_experience": 2, "transit_modes": ["bus"], "phone": "814-555-0100",
        "secondary_email": "alice.secret@example.com", "address": "1 Secret Lane"}
PRIVATE_BITS = ("Nittany", "2004", "814-555", "secret", "Secret Lane", "@psu.edu", "female")


@pytest.fixture
def client(fake_auth0):
    db.set_client(mongomock.MongoClient())
    yield TestClient(app)
    db.set_client(None)


def join(client, name):
    """Sign in as auth0|<name> (Auth0 name: Name) and finish sign-up. Returns the auth header."""
    h = bearer(f"auth0|{name}")
    assert client.put("/me/registration", headers=h, json=FORM).status_code == 200
    return h


def badge(user_id, key, minutes_ago=0):
    db.get_db().badges.insert_one({"user_id": user_id, "key": f"trail:{key}", "kind": "trail", "target_id": key,
                                   "name": key, "awarded_at": dt.datetime(2026, 10, 24, 12) - dt.timedelta(minutes=minutes_ago)})


# ---------- usernames ----------

def test_sign_up_assigns_a_username_from_the_public_name(client):
    h = join(client, "alice")
    assert client.get("/me", headers=h).json()["handle"] == "alice"
    assert client.put("/me/registration", headers=bearer("auth0|alice2"), json=FORM).json()["handle"] == "alice2"  # returned at sign-up


def test_taken_names_get_digits_and_odd_names_are_cleaned(client, monkeypatch):
    join(client, "alice")
    monkeypatch.setattr("app.auth.fetch_profile", lambda identity: {"email": "x@psu.edu", "name": "Alice"})
    second = client.get("/me", headers=join(client, "other")).json()["handle"]
    assert second.startswith("alice") and second != "alice" and social.HANDLE_RE.match(second)
    assert social._base("Zoë O'Brien") == "zoeobrien"
    assert social._base("李") == "hiker" and social._base("Al") == "hiker" and social._base("Admin") == "hiker"
    assert social._base("2pac Shakur") == "pacshakur"


def test_accounts_from_before_usernames_get_one_on_their_next_visit(client):
    h = join(client, "bob")
    db.get_db().users.update_one({}, {"$unset": {"handle": ""}})
    db.get_db().handles.delete_many({})
    assert client.get("/me", headers=h).json()["handle"] == "bob"


def test_no_username_before_sign_up(client):
    assert client.get("/me", headers=bearer("auth0|carol")).json()["handle"] is None


def test_changing_the_username(client):
    a, b = join(client, "alice"), join(client, "bob")
    r = client.put("/me/handle", headers=a, json={"handle": "  Trail_Queen "})
    assert r.status_code == 200 and r.json()["handle"] == "trail_queen"
    assert client.get("/users/TRAIL_queen").json()["handle"] == "trail_queen"  # lookups ignore case
    assert client.get("/users/alice").status_code == 404
    assert client.put("/me/handle", headers=b, json={"handle": "alice"}).json()["handle"] == "alice"  # old name freed
    taken = client.put("/me/handle", headers=b, json={"handle": "trail_queen"})
    assert taken.status_code == 409 and taken.json()["detail"] == "That username is taken."
    assert client.put("/me/handle", headers=a, json={"handle": "trail_queen"}).status_code == 200  # unchanged: fine
    for bad in ["ab", "1abc", "has space", "émile", "a" * 21, "dash-ed"]:
        assert client.put("/me/handle", headers=a, json={"handle": bad}).status_code == 422, bad
    reserved = client.put("/me/handle", headers=a, json={"handle": "admin"})
    assert reserved.status_code == 422 and "reserved" in reserved.json()["detail"]
    assert client.put("/me/handle", json={"handle": "zed"}).status_code == 401


# ---------- public profiles ----------

def test_public_profile_shows_only_public_things(client):
    a = join(client, "alice")
    badge("auth0|alice", "millbrook-marsh")
    db.get_db().checkins.insert_one({"user_id": "auth0|alice", "trail_id": "millbrook-marsh", "status": "completed",
                                     "completed_at": dt.datetime(2026, 10, 24, 12)})
    r = client.get("/users/alice")
    assert r.status_code == 200
    p = r.json()
    assert p["handle"] == "alice" and p["display_name"] == "Alice" and p["is_public"] and not p["is_me"]
    assert p["following"] is None and p["follows_you"] is False  # signed out
    assert p["completed_trails"] == 1 and p["badge_count"] == 1 and p["badges"][0]["key"] == "trail:millbrook-marsh"
    assert dt.date.fromisoformat(p["joined"])
    assert not any(bit in r.text for bit in PRIVATE_BITS)
    assert client.get("/users/alice", headers=a).json()["is_me"] is True


def test_private_profiles_hide_badges_and_stats_from_others(client):
    a, b = join(client, "alice"), join(client, "bob")
    badge("auth0|alice", "millbrook-marsh")
    assert client.patch("/me", headers=a, json={"profile": {"public_profile": False}}).status_code == 200
    seen = client.get("/users/alice", headers=b).json()
    assert seen["is_public"] is False and seen["badges"] == [] and seen["completed_trails"] is None and seen["badge_count"] is None
    assert seen["display_name"] == "Alice" and seen["followers_count"] == 0
    own = client.get("/users/alice", headers=a).json()
    assert own["badge_count"] == 1 and len(own["badges"]) == 1  # the owner still sees everything
    assert client.get("/users/alice/followers", headers=b).status_code == 403
    assert client.get("/users/alice/following").status_code == 403
    assert client.get("/users/alice/followers", headers=a).status_code == 200
    card = client.get("/users?q=alice", headers=b).json()[0]
    assert card["is_public"] is False and card["badge_count"] == 0  # findable, but nothing shown
    assert client.patch("/me", headers=a, json={"profile": {"public_profile": None}}).status_code == 200
    assert client.get("/users/alice", headers=b).json()["badge_count"] == 1  # null means public again


def test_unknown_or_unfinished_accounts_are_not_found(client):
    assert client.get("/users/nobody").status_code == 404
    client.get("/me", headers=bearer("auth0|carol"))
    db.get_db().handles.insert_one({"_id": "carol", "user_id": "auth0|carol"})  # a handle, but no sign-up
    db.get_db().users.update_one({"_id": "auth0|carol"}, {"$set": {"handle": "carol"}})
    assert client.get("/users/carol").status_code == 404


# ---------- search ----------

def test_search_by_username_or_name(client, monkeypatch):
    join(client, "alice")
    monkeypatch.setattr("app.auth.fetch_profile", lambda identity: {"email": "x@psu.edu", "name": "Maria Alvarez"})
    m = join(client, "maria")
    client.put("/me/handle", headers=m, json={"handle": "mtnmaria"})
    monkeypatch.setattr("app.auth.fetch_profile", lambda identity: {"email": "v@psu.edu", "name": "Vic Viewer"})
    viewer = join(client, "viewer")
    assert [c["handle"] for c in client.get("/users?q=ALI").json()] == ["alice"]  # username prefix, any case
    assert [c["handle"] for c in client.get("/users?q=al").json()] == ["alice", "mtnmaria"]  # ...or "Alvarez"
    assert [c["handle"] for c in client.get("/users?q=alv").json()] == ["mtnmaria"]  # start of a word in the name
    assert client.get("/users?q=lvarez").json() == []  # not the middle of a word
    assert client.get("/users?q=a").status_code == 422 and client.get("/users?q=" + "x" * 31).status_code == 422
    assert client.get("/users?q=a.*").json() == []  # regex characters are literal
    assert client.get("/users?q=psu.edu").json() == []  # emails are never searched
    cards = {c["handle"]: c for c in client.get("/users?q=al", headers=viewer).json()}
    assert cards["alice"]["following"] is False and cards["alice"]["is_me"] is False
    assert client.get("/users?q=view", headers=viewer).json()[0]["is_me"] is True


def test_exact_username_matches_come_first(client):
    join(client, "alicex")
    h = join(client, "other")
    client.put("/me/handle", headers=h, json={"handle": "ali"})
    assert [c["handle"] for c in client.get("/users?q=ali").json()][0] == "ali"


def test_people_who_never_finished_sign_up_are_not_searchable(client):
    client.get("/me", headers=bearer("auth0|ghost"))
    db.get_db().users.update_one({"_id": "auth0|ghost"}, {"$set": {"handle": "ghost"}})  # even with a username
    assert client.get("/users?q=gho").json() == []


# ---------- follows ----------

def test_follow_and_unfollow(client):
    a, b = join(client, "alice"), join(client, "bob")
    assert client.put("/me/following/bob", headers=a).json() == {"following": True, "followers_count": 1}
    assert client.put("/me/following/BOB", headers=a).json() == {"following": True, "followers_count": 1}  # idempotent
    p = client.get("/users/bob", headers=a).json()
    assert p["following"] is True and p["followers_count"] == 1
    assert client.get("/users/alice", headers=b).json()["follows_you"] is True
    assert client.get("/users/alice").json()["following_count"] == 1
    assert client.delete("/me/following/bob", headers=a).json() == {"following": False, "followers_count": 0}
    assert client.delete("/me/following/bob", headers=a).json()["following"] is False
    selfie = client.put("/me/following/alice", headers=a)
    assert selfie.status_code == 422 and "yourself" in selfie.json()["detail"]
    assert client.put("/me/following/nobody", headers=a).status_code == 404
    assert client.put("/me/following/bob").status_code == 401


def test_follower_and_following_lists(client):
    a, b, c = join(client, "alice"), join(client, "bob"), join(client, "carl")
    client.put("/me/following/carl", headers=a)
    client.put("/me/following/carl", headers=b)
    client.put("/me/following/bob", headers=c)
    followers = client.get("/users/carl/followers", headers=a).json()
    assert {f["handle"] for f in followers} == {"alice", "bob"}
    mine = next(f for f in followers if f["handle"] == "alice")
    assert mine["is_me"] and next(f for f in followers if f["handle"] == "bob")["following"] is False
    assert [f["handle"] for f in client.get("/users/carl/following").json()] == ["bob"]
    assert len(client.get("/users/carl/followers?limit=1").json()) == 1
    assert len(client.get("/users/carl/followers?skip=1&limit=1").json()) == 1
    assert client.get("/users/nobody/followers").status_code == 404


def test_activity_from_people_you_follow(client):
    a, b, c = join(client, "alice"), join(client, "bob"), join(client, "carl")
    badge("auth0|bob", "millbrook-marsh", minutes_ago=30)
    badge("auth0|carl", "musser-gap", minutes_ago=10)
    badge("auth0|alice", "indian-steps")  # not followed
    client.put("/me/following/bob", headers=a)
    client.put("/me/following/carl", headers=a)
    feed = client.get("/me/following/activity", headers=a).json()
    assert [(i["user"]["handle"], i["badge"]["target_id"]) for i in feed] == [("carl", "musser-gap"), ("bob", "millbrook-marsh")]
    assert feed[0]["user"] == {"handle": "carl", "display_name": "Carl"}
    client.patch("/me", headers=c, json={"profile": {"public_profile": False}})
    assert [i["user"]["handle"] for i in client.get("/me/following/activity", headers=a).json()] == ["bob"]  # private: hidden
    client.delete("/me/following/bob", headers=a)
    assert client.get("/me/following/activity", headers=a).json() == []
    assert client.get("/me/following/activity").status_code == 401 and b


# ---------- review authors ----------

def test_reviews_carry_the_author_username(client):
    a = join(client, "alice")
    review = {"accuracy": 4, "difficulty": 3, "enjoyment": 5, "comment": "Lovely boardwalk"}
    put = client.put("/trails/millbrook-marsh/reviews/me", headers=a, json=review).json()
    assert put["author_handle"] == "alice"
    assert client.get("/trails/millbrook-marsh/reviews").json()["reviews"][0]["author_handle"] == "alice"
    assert client.get("/reviews/feed").json()[0]["author_handle"] == "alice"
    tips = [c for cs in client.get("/reviews/highlights").json().values() for c in cs if c.get("tip")]
    assert tips and all(t["author_handle"] is None for t in tips)


# ---------- account deletion ----------

def test_deleting_an_account_removes_its_username_and_follows(client):
    a, b = join(client, "alice"), join(client, "bob")
    client.put("/me/following/bob", headers=a)
    client.put("/me/following/alice", headers=b)
    assert client.delete("/me", headers=a).status_code == 204
    assert db.get_db().follows.count_documents({}) == 0
    assert db.get_db().handles.count_documents({"_id": "alice"}) == 0
    assert client.get("/users/alice").status_code == 404
    assert client.get("/users/bob").json()["followers_count"] == 0
    assert client.put("/me/handle", headers=b, json={"handle": "alice"}).status_code == 200  # the name is free again
