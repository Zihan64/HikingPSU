"""Public profiles, usernames, people search and follows. mongomock; no server or network."""
import datetime as dt

import mongomock
import pytest
from fastapi.testclient import TestClient

from app import db, ratelimit, social
from app.main import app

from tests.conftest import bearer

FORM = {"full_name": "Alice Nittany", "gender": "female", "birthday": "2004-05-06",
        "hiking_experience": 2, "transit_modes": ["bus"], "phone": "814-555-0100",
        "secondary_email": "alice.secret@example.com", "address": "1 Secret Lane"}
PRIVATE_BITS = ("Nittany", "2004", "814-555", "secret", "Secret Lane", "@psu.edu", "female")


@pytest.fixture
def client(fake_auth0):
    db.set_client(mongomock.MongoClient())
    ratelimit.reset()
    yield TestClient(app)
    db.set_client(None)
    ratelimit.reset()


def join(client, name):
    """Sign in as auth0|<name> (Auth0 name: Name) and finish sign-up. Returns the auth header."""
    h = bearer(f"auth0|{name}")
    assert client.put("/me/registration", headers=h, json={**FORM, "full_name": f"{name.title()} Nittany"}).status_code == 200
    return h


def badge(user_id, key, minutes_ago=0):
    db.get_db().badges.insert_one({"user_id": user_id, "key": f"trail:{key}", "kind": "trail", "target_id": key,
                                   "name": key, "awarded_at": dt.datetime(2026, 10, 24, 12) - dt.timedelta(minutes=minutes_ago)})


# ---------- usernames ----------

def test_sign_up_assigns_a_username_from_the_public_name(client):
    h = join(client, "alice")
    assert client.get("/me", headers=h).json()["handle"] == "alice"
    again = client.put("/me/registration", headers=bearer("auth0|alice2"), json=FORM).json()  # also typed "Alice Nittany"
    assert again["handle"].startswith("alice") and again["handle"] != "alice"  # returned at sign-up, with digits


def test_the_public_name_is_the_first_name_typed_at_sign_up_never_the_full_name(client, monkeypatch):
    monkeypatch.setattr("app.auth.fetch_profile", lambda identity: {"email": "z@psu.edu", "name": "Zihan Zhao"})  # Google profile
    h = bearer("auth0|z")
    me = client.put("/me/registration", headers=h, json={**FORM, "full_name": "Zihan Zhao"}).json()
    assert me["profile"]["display_name"] == "Zihan" and me["handle"] == "zihan"
    assert "Zhao" not in client.get("/users/zihan").text and client.get("/users?q=zha").json() == []


def test_older_accounts_with_a_full_public_name_are_trimmed_with_their_reviews(client):
    h = join(client, "zed")
    review = {"accuracy": 4, "difficulty": 3, "enjoyment": 5, "comment": "Nice"}
    client.put("/trails/millbrook-marsh/reviews/me", headers=h, json=review)
    db.get_db().users.update_one({}, {"$set": {"profile.display_name": "Zed Fullname"}})  # saved before the rule
    db.get_db().reviews.update_many({}, {"$set": {"author": "Zed Fullname"}})
    assert client.get("/me", headers=h).json()["profile"]["display_name"] == "Zed"
    assert client.get("/trails/millbrook-marsh/reviews").json()["reviews"][0]["author"] == "Zed"


def test_taken_names_get_digits_and_odd_names_are_cleaned(client, monkeypatch):
    join(client, "alice")
    other = bearer("auth0|other")
    client.put("/me/registration", headers=other, json={**FORM, "full_name": "Alice Smith"})
    second = client.get("/me", headers=other).json()["handle"]
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
    m = join(client, "maria")
    client.put("/me/handle", headers=m, json={"handle": "mtnmaria"})
    monkeypatch.setattr("app.auth.fetch_profile", lambda identity: {"email": "v@psu.edu", "name": "Vic Viewer"})
    viewer = join(client, "viewer")
    assert [c["handle"] for c in client.get("/users?q=ALI").json()] == ["alice"]  # username prefix, any case
    assert [c["handle"] for c in client.get("/users?q=MAR").json()] == ["mtnmaria"]  # or the public name
    assert client.get("/users?q=aria").json() == []  # not the middle of a name
    assert client.get("/users?q=nittany").json() == []  # last names are never public, so never searched
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


# ---------- review fixes ----------

def test_official_looking_usernames_are_refused(client):
    a = join(client, "alice")
    for bad in ["hikingpsu_official", "admin2", "theofficialone", "moderator_amy", "hikingpsu"]:
        assert client.put("/me/handle", headers=a, json={"handle": bad}).status_code == 422, bad
    assert client.put("/me/handle", headers=a, json={"handle": "psuhiker"}).status_code == 200  # "psu" inside is fine


def test_sign_up_never_assigns_an_official_looking_username(client):
    for i, typed in enumerate(["HikingPSUOfficial Smith", "Admin2 Smith", "Officialhiker", "Moderator1", "Hiking-PSU-Official"]):
        h = bearer(f"auth0|typed{i}")
        handle = client.put("/me/registration", headers=h, json={**FORM, "full_name": typed}).json()["handle"]
        assert handle.startswith("hiker") and not social._reserved(handle), (typed, handle)
        with pytest.raises(social.SocialError, match="reserved"):  # and the same names are refused when picked by hand
            social.validate("".join(ch for ch in typed.split()[0].lower() if ch.isalnum()))


def test_accounts_that_never_signed_up_cannot_follow_or_claim_names(client):
    join(client, "bob")
    ghost = bearer("auth0|ghost")
    r = client.put("/me/following/bob", headers=ghost)
    assert r.status_code == 403 and "signing up" in r.json()["detail"]
    assert client.put("/me/handle", headers=ghost, json={"handle": "goodname"}).status_code == 403
    assert db.get_db().follows.count_documents({}) == 0 and db.get_db().handles.count_documents({"_id": "goodname"}) == 0


def test_a_private_hikers_follows_stay_private_in_other_peoples_lists(client):
    a, b, c = join(client, "alice"), join(client, "bob"), join(client, "carl")
    client.put("/me/following/bob", headers=a)
    client.patch("/me", headers=a, json={"profile": {"public_profile": False}})
    assert client.get("/users/bob/followers", headers=c).json() == []  # a third party can't see private Alice
    assert client.get("/users/bob/followers").json() == []
    assert [x["handle"] for x in client.get("/users/bob/followers", headers=b).json()] == ["alice"]  # Bob, the owner, can
    assert [x["handle"] for x in client.get("/users/bob/followers", headers=a).json()] == ["alice"]  # and so can Alice
    assert client.get("/users/bob", headers=c).json()["followers_count"] == 1  # the count is still right


def test_lists_page_by_a_cursor_newest_first(client):
    hosts = [join(client, n) for n in ("ann", "ben", "cat")]
    bob = join(client, "bob")
    t0 = dt.datetime(2026, 10, 20, 12)
    for i, (name, h) in enumerate(zip(("ann", "ben", "cat"), hosts)):
        client.put("/me/following/bob", headers=h)
        db.get_db().follows.update_one({"follower_id": f"auth0|{name}"}, {"$set": {"created_at": t0 + dt.timedelta(hours=i)}})
    first = client.get("/users/bob/followers?limit=2", headers=bob).json()
    assert [x["handle"] for x in first] == ["cat", "ben"] and first[0]["followed_at"].endswith(("Z", "+00:00"))
    client.delete("/me/following/bob", headers=hosts[2])  # cat unfollows while the list is open
    rest = client.get("/users/bob/followers", headers=bob, params={"limit": 2, "before": first[-1]["followed_at"]}).json()
    assert [x["handle"] for x in rest] == ["ann"]  # nobody skipped


def test_hidden_followers_never_cut_a_page_short(client):
    bob, carl = join(client, "bob"), join(client, "carl")
    t0 = dt.datetime(2026, 10, 20, 12)
    names = ["pam", "pat", "peg", "quinn", "quincy"]  # newest first: three private hikers, then two public ones
    for i, name in enumerate(names):
        h = join(client, name)
        client.put("/me/following/bob", headers=h)
        db.get_db().follows.update_one({"follower_id": f"auth0|{name}"}, {"$set": {"created_at": t0 - dt.timedelta(hours=i)}})
        if name.startswith("pa") or name == "peg":
            client.patch("/me", headers=h, json={"profile": {"public_profile": False}})
    page = client.get("/users/bob/followers?limit=2", headers=carl).json()
    assert [x["handle"] for x in page] == ["quinn", "quincy"]  # a full page, so "Show more" stays honest
    naive = page[0]["followed_at"].replace("Z", "").replace("+00:00", "")  # a cursor without a timezone is UTC
    assert [x["handle"] for x in client.get("/users/bob/followers", headers=carl, params={"limit": 2, "before": naive}).json()] == ["quincy"]
    assert [x["handle"] for x in client.get("/users/bob/followers?limit=2", headers=bob).json()] == ["pam", "pat"]  # the owner sees everyone


def test_an_exact_username_is_found_even_behind_many_name_matches(client, monkeypatch):
    for i in range(21):  # 21 hikers named Alina, with usernames that sort before "ali"
        h = bearer(f"auth0|n{i}")
        client.put("/me/registration", headers=h, json={**FORM, "full_name": "Alina X"})
        client.put("/me/handle", headers=h, json={"handle": f"aaa{i:02d}"})
    other = join(client, "other")
    client.put("/me/handle", headers=other, json={"handle": "ali"})
    found = [c["handle"] for c in client.get("/users?q=ali").json()]
    assert found[0] == "ali" and len(found) == 20


def test_emails_and_contact_details_are_never_searched(client, monkeypatch):
    monkeypatch.setattr("app.auth.fetch_profile", lambda identity: {"email": "zzsecret@psu.edu", "name": "Quinn"})
    join(client, "quinn")
    for q in ("zzsecret", "Nittany", "814-555", "Secret Lane"):
        assert client.get("/users", params={"q": q}).json() == [], q


def test_control_characters_in_a_search_are_refused(client):
    assert client.get("/users", params={"q": "al\x00ice"}).status_code == 422
    assert client.get("/users", params={"q": "ab\x1f"}).status_code == 422


def test_people_search_is_throttled(client):
    for _ in range(15):
        assert client.get("/users?q=ab").status_code == 200
    r = client.get("/users?q=ab")
    assert r.status_code == 429 and r.headers["retry-after"] == "60"


def test_a_stale_username_change_cannot_win(client):
    a = join(client, "alice")
    stale = db.get_db().users.find_one({"_id": "auth0|alice"})  # read by a request that is still running
    client.put("/me/handle", headers=a, json={"handle": "fresh"})
    with pytest.raises(social.SocialError) as e:
        social.change_handle(stale, "late")
    assert e.value.status == 409
    assert db.get_db().handles.find_one({"_id": "late"}) is None  # nothing left reserved
    assert db.get_db().handles.find_one({"_id": "fresh"})["user_id"] == "auth0|alice"


def test_a_racing_first_visit_releases_the_extra_username(client):
    a = join(client, "alice")
    db.get_db().users.update_one({}, {"$unset": {"handle": ""}})
    db.get_db().handles.delete_many({})
    stale = db.get_db().users.find_one({"_id": "auth0|alice"})
    assert client.get("/me", headers=a).json()["handle"] == "alice"  # the other visit got there first
    db.get_db().users.update_one({}, {"$set": {"profile.display_name": "Alicia"}})
    stale["profile"]["display_name"] = "Alicia"
    assert social.ensure_handle({**stale, "handle": None})["handle"] == "alice"
    assert db.get_db().handles.count_documents({"user_id": "auth0|alice"}) == 1  # "alicia" was released


def test_leftover_reservations_are_taken_over_after_a_minute(client):
    a = join(client, "alice")
    db.get_db().handles.insert_one({"_id": "freename", "user_id": "auth0|gone", "created_at": dt.datetime(2026, 1, 1)})
    assert client.put("/me/handle", headers=a, json={"handle": "freename"}).status_code == 200
    db.get_db().handles.insert_one({"_id": "justnow", "user_id": "auth0|other",
                                    "created_at": dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)})
    assert client.put("/me/handle", headers=a, json={"handle": "justnow"}).status_code == 409  # may still be in use
