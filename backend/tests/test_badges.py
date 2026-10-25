"""Trail medals: derived from the hike log and reviews (mongomock; no server or network needed)."""
import mongomock
import pytest
from fastapi.testclient import TestClient

from app import db
from app.main import app

from tests.conftest import bearer

EASY = ["arboretum-hartley-wood", "millbrook-marsh", "walnut-springs-thompson-woods", "bluebird-5694641", "whipple-dam-loop"]
L3 = ["jo-hays-vista", "indian-steps", "shingletown-gap"]
HARD = ["mt-nittany-full-loop", "mount-nittany-white-trail-17408208", "mountain-mist-trail-21272887",
        "mount-nittany-blue-trail-17408207", "rudy-ridge-loop-21272869"]
L5 = ["shingletown-ridge-loop", "moss-hanne-trail-17233610", "mount-nittany-blue-and-white-trails-17408263",
      "greenwood-spur-1024489", "north-sand-mountain-trail-13655344", "ironstone-trail-5694643"]
REVIEW = {"accuracy": 4, "difficulty": 4, "enjoyment": 5, "comment": "Worth every step"}


@pytest.fixture
def client(fake_auth0):
    db.set_client(mongomock.MongoClient())
    yield TestClient(app)
    db.set_client(None)


def hike(client, h, trail, day):
    r = client.post("/me/hikes", headers=h, json={"trail_id": trail, "completed_on": day})
    assert r.status_code == 201, r.text


def medals(client, h):
    r = client.get("/me/badges", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    return body, {b["id"]: b for b in body["badges"]}


def test_needs_login(client):
    assert client.get("/me/badges").status_code == 401


def test_new_hiker_has_every_medal_locked(client):
    body, by_id = medals(client, bearer())
    assert len(by_id) == 10 and body["earned"] == 0 and body["top"] is None
    assert by_id["trailhead"]["progress"] == 0 and by_id["trailhead"]["goal"] == 1
    assert by_id["allegheny-front"]["goal"] == 6  # every L5 trail in the catalogue


def test_first_easy_trail_earns_trailhead(client):
    h = bearer()
    hike(client, h, EASY[0], "2026-09-05")
    body, by_id = medals(client, h)
    assert by_id["trailhead"]["earned"] and by_id["trailhead"]["earned_on"] == "2026-09-05"
    assert body["top"] == "trailhead" and by_id["valley-walker"]["progress"] == 1


def test_repeats_count_once(client):
    h = bearer()
    for d in ("2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"):
        hike(client, h, EASY[0], d)
    _, by_id = medals(client, h)
    assert by_id["valley-walker"]["progress"] == 1 and not by_id["valley-walker"]["earned"]


def test_hard_trails_also_count_for_easier_medals(client):
    h = bearer()
    hike(client, h, HARD[0], "2026-09-10")
    body, by_id = medals(client, h)
    assert by_id["trailhead"]["earned"] and by_id["summit"]["earned"]
    assert by_id["ridge-walker"]["progress"] == 1 and body["top"] == "summit"


def test_one_day_cannot_hold_more_than_a_day_of_hiking(client):
    h = bearer()
    for t in L5:
        hike(client, h, t, "2026-09-12")  # about 46 hours of estimated hiking on one date
    _, by_id = medals(client, h)
    assert by_id["valley-walker"]["progress"] < 5


def test_honour_medal_needs_reviews(client):
    h = bearer()
    for i, t in enumerate(HARD):
        hike(client, h, t, f"2026-09-{10 + i}")
    body, by_id = medals(client, h)
    assert by_id["summit"]["earned"] and not by_id["seven-mountains"]["earned"]
    assert by_id["seven-mountains"]["progress"] == 0
    for t in HARD:
        assert client.put(f"/trails/{t}/reviews/me", headers=h, json=REVIEW).status_code == 200
    body, by_id = medals(client, h)
    assert by_id["seven-mountains"]["earned"] and body["top"] == "seven-mountains"


def test_ladder_explorer_car_free_and_seasons(client):
    h = bearer()
    days = ["2026-01-10", "2026-04-10", "2026-07-10", "2026-10-10", "2026-10-11"]
    for t, d in zip(EASY, days):
        hike(client, h, t, d)
    for i, t in enumerate(L3):
        hike(client, h, t, f"2026-10-{12 + i}")
    _, by_id = medals(client, h)
    assert by_id["valley-walker"]["earned"] and by_id["ridge-walker"]["earned"]
    assert by_id["car-free"]["earned"]          # three of the easy trails are reachable without a car
    assert by_id["four-seasons"]["earned"]
    assert by_id["explorer"]["progress"] >= 2   # Whipple Dam + Rothrock; "other nearby" is not a park


def test_hearts_on_reviews_earn_trail_guide_and_feed_shows_top_medal(client):
    alice = bearer("auth0|alice")
    hike(client, alice, HARD[0], "2026-09-10")
    review = client.put(f"/trails/{HARD[0]}/reviews/me", headers=alice, json=REVIEW).json()
    for name in ("bob", "cara", "dev", "eli", "fay"):
        assert client.put(f"/reviews/{review['id']}/like", headers=bearer(f"auth0|{name}")).status_code == 200
    _, by_id = medals(client, alice)
    assert by_id["trail-guide"]["earned"] and by_id["trail-guide"]["earned_on"] is None
    feed = client.get("/reviews/feed").json()
    assert feed[0]["id"] == review["id"] and feed[0]["badge"] == "summit"
    top = client.get("/reviews/feed?sort=top").json()
    assert top[0]["badge"] == "summit"
