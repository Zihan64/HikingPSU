"""Trailhead check-ins and badges. mongomock + a controllable clock; no server, network or real location."""
import datetime as dt

import mongomock
import pytest
from fastapi.testclient import TestClient
from pymongo.errors import AutoReconnect

from app import badges, checkins, db, hikes, store
from app.main import app

from tests.conftest import bearer

MIKE = "mt-nittany-mike-lynch"          # curated, ~86 min estimate -> finish after 35 min
MARSH = "millbrook-marsh"               # "Other nearby trails", short -> 15 min minimum
MOSHANNON = "moss-hanne-trail-17233610"  # the only trail in Black Moshannon
WHIPPLE = ["whipple-dam-loop", "whipple-lake-trail-21279199"]
SGL_C = "pa-sgl-176-trail-c-21058525"   # mapped as two pieces joined ~2.4 km in
SGL_C_FAR_END = (40.7861385, -77.9843306)  # the last point of the second piece in data/trail_geometry.json
SGL_C_JUNCTION = (40.786874, -77.979097)   # where the two pieces meet, mid-trail
RATING = {"accuracy": 4, "difficulty": 3, "enjoyment": 5, "comment": "  lovely  "}


class Clock:
    def __init__(self):
        self.t = dt.datetime(2026, 10, 24, 14, 0, tzinfo=dt.timezone.utc)  # 10:00 AM in State College

    def __call__(self):
        return self.t

    def advance(self, **kw):
        self.t += dt.timedelta(**kw)


@pytest.fixture
def clock(monkeypatch):
    c = Clock()
    monkeypatch.setattr(checkins, "now", c)
    return c


@pytest.fixture
def client(fake_auth0, clock):
    db.set_client(mongomock.MongoClient())
    yield TestClient(app)
    db.set_client(None)


def at(trail_id, north_m=0.0, accuracy=15.0):
    """A fix about `north_m` metres north of the trail's trailhead."""
    th = store.get(trail_id).trailhead
    return {"trail_id": trail_id, "lat": th.lat + north_m / 111_195, "lon": th.lon, "accuracy_m": accuracy}


def hike(client, h, trail_id, clock):
    """Check in, wait long enough, finish with a rating. Returns the finish response JSON."""
    r = client.post("/me/checkins", headers=h, json=at(trail_id))
    assert r.status_code == 201, r.text
    clock.advance(minutes=checkins.min_minutes(trail_id))
    r = client.post(f"/me/checkins/{r.json()['id']}/finish", headers=h, json=RATING)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- starting ----------

def test_check_in_near_the_trailhead(client, clock):
    h = bearer("auth0|a")
    r = client.post("/me/checkins", headers=h, json=at(MIKE, north_m=150))
    assert r.status_code == 201
    c = r.json()
    assert c["status"] == "active" and c["trail_name"] == store.get(MIKE).name and 140 <= c["distance_m"] <= 160
    started = dt.datetime.fromisoformat(c["started_at"])
    assert started.tzinfo is not None  # the browser must not read UTC as local time
    assert dt.datetime.fromisoformat(c["finish_after"]) - started == dt.timedelta(minutes=35)  # 40% of 86 min
    assert dt.datetime.fromisoformat(c["expires_at"]) - started == dt.timedelta(hours=24)
    assert client.get("/me/checkins/active", headers=h).json()["id"] == c["id"]


def test_coordinates_are_never_stored(client, clock):
    h = bearer("auth0|a")
    client.post("/me/checkins", headers=h, json=at(MIKE, north_m=40))
    stored = db.get_db().checkins.find_one()
    assert not {"lat", "lon", "latitude", "longitude"} & set(stored)
    assert stored["distance_m"] == 40 and stored["accuracy_m"] == 15


def test_accuracy_must_be_100_m_or_better(client, clock):
    h = bearer("auth0|a")
    assert client.post("/me/checkins", headers=h, json=at(MIKE, accuracy=100.5)).status_code == 422
    assert client.post("/me/checkins", headers=h, json=at(MIKE, accuracy=100)).status_code == 201


def test_too_far_or_too_inaccurate_is_refused_with_a_clear_reason(client, clock):
    h = bearer("auth0|a")
    far = client.post("/me/checkins", headers=h, json=at(MIKE, north_m=850))
    assert far.status_code == 422 and "about 850 m" in far.json()["detail"] and "within 200 m" in far.json()["detail"]
    assert "km" in client.post("/me/checkins", headers=h, json=at(MIKE, north_m=5000)).json()["detail"]
    fuzzy = client.post("/me/checkins", headers=h, json=at(MIKE, accuracy=250))
    assert fuzzy.status_code == 422 and "accurate" in fuzzy.json()["detail"]
    assert client.post("/me/checkins", headers=h, json=at(MIKE, north_m=210)).status_code == 422
    assert client.post("/me/checkins", headers=h, json={**at(MIKE), "trail_id": "nope"}).status_code == 404
    assert client.post("/me/checkins", headers=h, json={**at(MIKE), "lat": 95}).status_code == 422
    assert client.post("/me/checkins", json=at(MIKE)).status_code == 401
    assert db.get_db().checkins.count_documents({}) == 0


def test_the_far_end_of_a_mapped_route_counts_but_a_mid_trail_junction_does_not(client, clock):
    fix = lambda lat, lon: {"trail_id": SGL_C, "lat": lat, "lon": lon, "accuracy_m": 10}
    junction = client.post("/me/checkins", headers=bearer("auth0|a"), json=fix(*SGL_C_JUNCTION))
    assert junction.status_code == 422 and "within 200 m" in junction.json()["detail"]
    assert client.post("/me/checkins", headers=bearer("auth0|a"), json=fix(*SGL_C_FAR_END)).status_code == 201


def test_route_ends_ignore_pieces_that_join_other_pieces():
    main = [[-77.80, 40.80], [-77.79, 40.80], [-77.78, 40.80]]   # an east-west trail
    spur = [[-77.79, 40.8000001], [-77.79, 40.81]]              # a spur leaving its middle, heading north
    ends = checkins.route_ends([main, spur])
    assert (40.80, -77.80) in ends and (40.80, -77.78) in ends and (40.81, -77.79) in ends
    assert len(ends) == 3  # the spur's start sits on the main line: a junction, not an end
    assert checkins.route_ends([main]) == [(40.80, -77.80), (40.80, -77.78)]


def test_one_active_check_in_at_a_time_and_cancelling(client, clock):
    h = bearer("auth0|a")
    first = client.post("/me/checkins", headers=h, json=at(MIKE)).json()
    again = client.post("/me/checkins", headers=h, json=at(MARSH))
    assert again.status_code == 409 and store.get(MIKE).name in again.json()["detail"]
    assert client.delete(f"/me/checkins/{first['id']}", headers=h).status_code == 204
    assert client.get("/me/checkins/active", headers=h).json() is None
    assert client.delete(f"/me/checkins/{first['id']}", headers=h).status_code == 404
    assert db.get_db().checkins.find_one()["status"] == "cancelled"
    assert client.post("/me/checkins", headers=h, json=at(MARSH)).status_code == 201


def _between_a_starts_two_writes(monkeypatch, action):
    """Run `action` once, right after the next start() has written its check-in but before its lock."""
    real_db, fired = checkins.get_db, []

    class Checkins:
        def __init__(self, coll): self.coll = coll
        def __getattr__(self, name): return getattr(self.coll, name)
        def insert_one(self, doc):
            result = self.coll.insert_one(doc)
            if not fired:
                fired.append(True)
                action()
            return result

    class DB:
        def __getattr__(self, name):
            coll = getattr(real_db(), name)
            return Checkins(coll) if name == "checkins" else coll

    monkeypatch.setattr(checkins, "get_db", lambda: DB())


def test_overlapping_starts_leave_exactly_one_active(client, clock, monkeypatch):
    def second_tab():
        assert checkins.get_active("auth0|a") is None  # a poll in the gap sees nothing and deletes nothing
        checkins.start("auth0|a", MARSH, at(MARSH)["lat"], at(MARSH)["lon"], 10)
    _between_a_starts_two_writes(monkeypatch, second_tab)
    with pytest.raises(checkins.CheckinError) as e:
        checkins.start("auth0|a", MIKE, at(MIKE)["lat"], at(MIKE)["lon"], 10)
    assert e.value.status == 409
    active = list(db.get_db().checkins.find({"status": "active"}))
    assert [d["trail_id"] for d in active] == [MARSH]  # the loser removed its own check-in
    assert db.get_db().checkin_locks.find_one()["checkin_id"] == active[0]["_id"]


def test_a_poll_during_a_start_keeps_its_lock(client, clock, monkeypatch):
    _between_a_starts_two_writes(monkeypatch, lambda: checkins.get_active("auth0|a"))
    doc = checkins.start("auth0|a", MIKE, at(MIKE)["lat"], at(MIKE)["lon"], 10)
    assert checkins.get_active("auth0|a")["_id"] == doc["_id"]
    assert db.get_db().checkins.find_one({"_id": doc["_id"]})["status"] == "active"


def test_a_check_in_whose_lock_was_never_written_is_retired(client, clock):
    h = bearer("auth0|a")
    c = client.post("/me/checkins", headers=h, json=at(MIKE)).json()
    db.get_db().checkin_locks.delete_many({})  # as if the start crashed between its two writes
    clock.advance(hours=1)
    assert client.post(f"/me/checkins/{c['id']}/finish", headers=h, json=RATING).status_code == 409
    assert client.get("/me/checkins/active", headers=h).json() is None
    assert db.get_db().checkins.find_one()["status"] == "cancelled"
    assert client.post("/me/checkins", headers=h, json=at(MARSH)).status_code == 201


def test_a_stale_lock_is_released(client, clock):
    h = bearer("auth0|a")
    c = client.post("/me/checkins", headers=h, json=at(MIKE)).json()
    db.get_db().checkins.update_one({}, {"$set": {"status": "cancelled"}})  # lock left behind
    assert client.get("/me/checkins/active", headers=h).json() is None
    assert db.get_db().checkin_locks.count_documents({}) == 0 and c["id"]


def test_users_cannot_touch_each_others_check_ins(client, clock):
    a, b = bearer("auth0|a"), bearer("auth0|b")
    c = client.post("/me/checkins", headers=a, json=at(MIKE)).json()
    clock.advance(hours=1)
    assert client.post(f"/me/checkins/{c['id']}/finish", headers=b, json=RATING).status_code == 404
    assert client.delete(f"/me/checkins/{c['id']}", headers=b).status_code == 404
    assert client.get("/me/checkins/active", headers=b).json() is None
    assert client.post("/me/checkins/not-an-id/finish", headers=a, json=RATING).status_code == 404


# ---------- finishing ----------

def test_finishing_too_early_then_on_time(client, clock):
    h = bearer("auth0|a")
    c = client.post("/me/checkins", headers=h, json=at(MIKE)).json()
    clock.advance(minutes=33)
    early = client.post(f"/me/checkins/{c['id']}/finish", headers=h, json=RATING)
    assert early.status_code == 409 and early.json()["detail"] == "You can finish in 2 mins."
    clock.advance(seconds=50)
    assert client.post(f"/me/checkins/{c['id']}/finish", headers=h, json=RATING).json()["detail"] == "You can finish in 2 mins."
    assert db.get_db().reviews.count_documents({}) == 0  # nothing written on a refused finish
    clock.advance(seconds=10)  # 60 s before finish_after: allowed, for a phone clock slightly ahead of ours
    r = client.post(f"/me/checkins/{c['id']}/finish", headers=h, json=RATING)
    assert r.status_code == 200
    body = r.json()
    assert body["checkin"]["status"] == "completed" and body["checkin"]["completed_at"]
    assert body["review"]["enjoyment"] == 5 and body["review"]["comment"] == "lovely" and body["review"]["mine"]
    assert [b["key"] for b in body["new_badges"]] == [f"trail:{MIKE}"]
    assert body["new_badges"][0]["tier"] == "bronze" and body["new_badges"][0]["title"] == store.get(MIKE).name
    assert client.get("/me/checkins/active", headers=h).json() is None

    log = client.get("/me/hikes", headers=h).json()
    assert len(log) == 1 and log[0]["trail_id"] == MIKE and log[0]["duration_min"] == 34
    assert log[0]["rating"] == 5 and log[0]["felt_difficulty"] == 3 and log[0]["completed_on"] == "2026-10-24"
    stored = db.get_db().checkins.find_one()
    assert stored["review_id"] == body["review"]["id"] and stored["hike_id"] == log[0]["id"]


def test_finish_needs_the_three_ratings(client, clock):
    h = bearer("auth0|a")
    c = client.post("/me/checkins", headers=h, json=at(MIKE)).json()
    clock.advance(hours=2)
    assert client.post(f"/me/checkins/{c['id']}/finish", headers=h, json={"accuracy": 4, "difficulty": 3}).status_code == 422
    assert client.post(f"/me/checkins/{c['id']}/finish", headers=h, json={**RATING, "enjoyment": 0}).status_code == 422
    ok = client.post(f"/me/checkins/{c['id']}/finish", headers=h, json={**RATING, "comment": None})
    assert ok.status_code == 200 and ok.json()["review"]["comment"] is None


def test_a_hike_can_only_be_finished_once(client, clock):
    h = bearer("auth0|a")
    c = client.post("/me/checkins", headers=h, json=at(MARSH)).json()
    clock.advance(minutes=15)
    assert client.post(f"/me/checkins/{c['id']}/finish", headers=h, json=RATING).status_code == 200
    again = client.post(f"/me/checkins/{c['id']}/finish", headers=h, json=RATING)
    assert again.status_code == 409 and "already completed" in again.json()["detail"]
    assert db.get_db().hike_logs.count_documents({}) == 1


def test_a_double_submit_that_passes_the_checks_twice_still_counts_once(client, clock):
    h = bearer("auth0|a")
    c = client.post("/me/checkins", headers=h, json=at(MARSH)).json()
    clock.advance(minutes=15)
    doc, resume = checkins.prepare_finish("auth0|a", c["id"])  # the second tap, checked before the first lands
    assert client.post(f"/me/checkins/{c['id']}/finish", headers=h, json=RATING).status_code == 200
    with pytest.raises(checkins.CheckinError) as e:
        checkins.mark_completed(doc)
    assert e.value.status == 409 and not resume
    assert db.get_db().hike_logs.count_documents({}) == 1


def test_a_finish_cut_off_by_a_database_error_can_be_retried(client, clock, monkeypatch):
    h = bearer("auth0|a")
    c = client.post("/me/checkins", headers=h, json=at(MARSH)).json()
    clock.advance(minutes=15)
    real_add = hikes.add

    def flaky(*a, **kw):
        monkeypatch.setattr(hikes, "add", real_add)
        raise AutoReconnect("primary stepped down")

    monkeypatch.setattr(hikes, "add", flaky)
    assert client.post(f"/me/checkins/{c['id']}/finish", headers=h, json=RATING).status_code == 503
    assert db.get_db().checkins.find_one()["status"] == "completed" and db.get_db().hike_logs.count_documents({}) == 0
    retry = client.post(f"/me/checkins/{c['id']}/finish", headers=h, json=RATING)
    assert retry.status_code == 200 and [b["key"] for b in retry.json()["new_badges"]] == [f"trail:{MARSH}"]
    assert db.get_db().hike_logs.count_documents({}) == 1
    again = client.post(f"/me/checkins/{c['id']}/finish", headers=h, json=RATING)
    assert again.status_code == 409 and db.get_db().hike_logs.count_documents({}) == 1


def test_the_badge_board_repairs_badges_a_cut_off_finish_missed(client, clock):
    db.get_db().checkins.insert_one({"user_id": "auth0|a", "trail_id": MARSH, "status": "completed",
                                     "completed_at": checkins.now(), "hike_id": "h"})
    board = client.get("/me/badges", headers=bearer("auth0|a")).json()
    assert [b["key"] for b in board["badges"]] == [f"trail:{MARSH}"]


def test_check_ins_expire_after_24_hours(client, clock):
    h = bearer("auth0|a")
    c = client.post("/me/checkins", headers=h, json=at(MIKE)).json()
    clock.advance(hours=24)
    assert client.get("/me/checkins/active", headers=h).json() is None
    r = client.post(f"/me/checkins/{c['id']}/finish", headers=h, json=RATING)
    assert r.status_code == 409 and "already expired" in r.json()["detail"]
    assert db.get_db().checkins.find_one()["status"] == "expired"
    assert client.post("/me/checkins", headers=h, json=at(MIKE)).status_code == 201  # free to start again


def test_finishing_an_expired_check_in_says_it_expired(client, clock):
    h = bearer("auth0|a")
    c = client.post("/me/checkins", headers=h, json=at(MIKE)).json()
    clock.advance(hours=25)
    r = client.post(f"/me/checkins/{c['id']}/finish", headers=h, json=RATING)
    assert r.status_code == 409 and "expired after 24 hours" in r.json()["detail"]


def test_two_completions_a_day(client, clock):
    h = bearer("auth0|a")
    hike(client, h, MARSH, clock)
    hike(client, h, MIKE, clock)
    capped = client.post("/me/checkins", headers=h, json=at(MOSHANNON))
    assert capped.status_code == 429 and "daily limit" in capped.json()["detail"]
    assert client.get("/me/badges", headers=h).json()["today_remaining"] == 0
    clock.t = dt.datetime(2026, 10, 25, 4, 1, tzinfo=dt.timezone.utc)  # 12:01 AM the next day in State College
    assert client.post("/me/checkins", headers=h, json=at(MOSHANNON)).status_code == 201


def test_the_daily_limit_follows_state_college_days_not_utc(client, clock):
    h = bearer("auth0|a")
    clock.t = dt.datetime(2026, 10, 24, 22, 40, tzinfo=dt.timezone.utc)  # 6:40 PM EDT
    hike(client, h, MARSH, clock)
    hike(client, h, MOSHANNON, clock)                                     # finished ~7:30 PM EDT, 23:3x UTC
    clock.t = dt.datetime(2026, 10, 25, 0, 30, tzinfo=dt.timezone.utc)   # 8:30 PM EDT: a new UTC day, same local day
    assert client.post("/me/checkins", headers=h, json=at(MIKE)).status_code == 429
    log = client.get("/me/hikes", headers=h).json()
    assert {x["completed_on"] for x in log} == {"2026-10-24"}  # logged under the State College date


def test_a_late_evening_start_that_finishes_after_midnight_is_allowed(client, clock):
    h = bearer("auth0|a")
    hike(client, h, MOSHANNON, clock)
    hike(client, h, MIKE, clock)
    clock.t = dt.datetime(2026, 10, 25, 3, 40, tzinfo=dt.timezone.utc)   # 11:40 PM EDT, 2 done today
    assert client.post("/me/checkins", headers=h, json=at(MARSH)).status_code == 429  # 15 min: would finish today
    clock.t = dt.datetime(2026, 10, 25, 3, 50, tzinfo=dt.timezone.utc)   # 11:50 PM: earliest finish 12:05 AM
    c = client.post("/me/checkins", headers=h, json=at(MARSH))
    assert c.status_code == 201
    clock.advance(minutes=15)
    assert client.post(f"/me/checkins/{c.json()['id']}/finish", headers=h, json=RATING).status_code == 200


def test_the_daily_limit_is_rechecked_at_finish(client, clock):
    h = bearer("auth0|a")
    c = client.post("/me/checkins", headers=h, json=at(MIKE)).json()
    db.get_db().checkins.insert_many([  # two hikes completed today while this one was open (e.g. before a deploy)
        {"user_id": "auth0|a", "trail_id": t, "status": "completed", "completed_at": checkins.now()} for t in (MARSH, MOSHANNON)
    ])
    clock.advance(hours=1)
    assert client.post(f"/me/checkins/{c['id']}/finish", headers=h, json=RATING).status_code == 429


def test_local_day_boundaries():
    edt_evening = dt.datetime(2026, 10, 25, 3, 59, tzinfo=dt.timezone.utc)  # 11:59 PM Oct 24 in State College
    assert checkins.start_of_local_day(edt_evening) == dt.datetime(2026, 10, 24, 4, 0, tzinfo=dt.timezone.utc)
    est_morning = dt.datetime(2026, 12, 1, 5, 30, tzinfo=dt.timezone.utc)  # winter: UTC-5
    assert checkins.start_of_local_day(est_morning) == dt.datetime(2026, 12, 1, 5, 0, tzinfo=dt.timezone.utc)


def test_minimum_hike_time():
    assert checkins.min_minutes(MARSH) == 15  # 40% of a 37 min estimate is under the floor
    assert checkins.min_minutes(MIKE) == 35
    assert checkins.min_minutes("mt-nittany-full-loop") == 80


# ---------- badges ----------

def test_repeats_earn_no_second_trail_badge_but_five_earn_a_special_one(client, clock):
    h = bearer("auth0|a")
    for n in range(1, 6):
        new = [b["key"] for b in hike(client, h, MARSH, clock)["new_badges"]]
        assert new == ([f"trail:{MARSH}"] if n == 1 else [f"repeat:{MARSH}"] if n == 5 else []), n
        clock.advance(days=1)
    board = client.get("/me/badges", headers=h).json()
    repeat = next(b for b in board["badges"] if b["kind"] == "repeat")
    assert repeat["tier"] == "special" and repeat["title"].endswith("Regular") and "5 times" in repeat["description"]
    assert board["completed_trails"] == 1 and board["repeats"] == [{"trail_id": MARSH, "trail_name": store.get(MARSH).name, "count": 5}]
    assert client.post("/me/hikes", headers=h, json={"trail_id": MARSH, "completed_on": "2026-10-01"}).status_code == 201
    assert client.get("/me/badges", headers=h).json()["completed_trails"] == 1  # manual log entries never count


def test_completing_a_park(client, clock):
    h = bearer("auth0|a")
    one = hike(client, h, MOSHANNON, clock)["new_badges"]
    assert [b["key"] for b in one] == [f"trail:{MOSHANNON}", "park:black-moshannon"]  # a one-trail park
    assert one[1]["tier"] == "silver" and one[1]["title"].endswith(" Complete") and "the only trail" in one[1]["description"]
    first = hike(client, h, WHIPPLE[0], clock)["new_badges"]
    assert [b["key"] for b in first] == [f"trail:{WHIPPLE[0]}"]
    clock.advance(days=1)
    second = [b["key"] for b in hike(client, h, WHIPPLE[1], clock)["new_badges"]]
    assert second == [f"trail:{WHIPPLE[1]}", "park:whipple-dam"]
    board = client.get("/me/badges", headers=h).json()
    assert next(b for b in board["badges"] if b["key"] == "park:whipple-dam")["description"].startswith("Completed all 2 trails")
    parks = {p["park_id"]: p for p in board["parks"]}
    real_parks = badges.parks
    grown = lambda: [{**p, "trail_ids": p["trail_ids"] + [MARSH]} if p["id"] == "whipple-dam" else p for p in real_parks()]
    try:
        badges.parks = grown  # the park later lists a trail this hiker never did
        later = client.get("/me/badges", headers=h).json()
    finally:
        badges.parks = real_parks
    kept = next(b for b in later["badges"] if b["key"] == "park:whipple-dam")
    assert kept["description"].startswith("Completed all 2 trails")  # still what was earned
    assert next(p for p in later["parks"] if p["park_id"] == "whipple-dam")["total"] == 3
    assert parks["whipple-dam"] == {"park_id": "whipple-dam", "name": parks["whipple-dam"]["name"], "completed": 2, "total": 2, "earned": True}
    assert parks["rothrock"]["completed"] == 0 and parks["rothrock"]["total"] == 20 and not parks["rothrock"]["earned"]
    assert "other-nearby-trails" not in parks


def test_badge_rules():
    others = [t.id for t in store.load_all() if t.park_id == "other-nearby-trails"]
    assert len(others) >= 10
    keys = [b["key"] for b in badges.due(others[:10])]
    assert "milestone:10" in keys and not any(k.startswith("park:") for k in keys)  # other trails count, no park badge
    assert "milestone:10" not in [b["key"] for b in badges.due(others[:9] * 3)]  # distinct trails only
    thirty = [t.id for t in store.load_all()][:30]
    assert {"milestone:10", "milestone:30"} <= {b["key"] for b in badges.due(thirty)}
    assert [b["kind"] for b in badges.due([MARSH] * 4)] == ["trail"]


def test_milestone_badges_display(client, clock):
    out = badges.to_out({"key": "milestone:30", "kind": "milestone", "target_id": None, "awarded_at": dt.datetime(2026, 1, 1)})
    assert out.tier == "platinum" and out.title == "Happy Valley Legend" and out.awarded_at.tzinfo is not None
    assert badges.to_out({"key": "milestone:10", "kind": "milestone", "awarded_at": dt.datetime(2026, 1, 1)}).tier == "gold"


def test_award_is_idempotent_and_repairs_missed_badges(client, clock):
    db.get_db().checkins.insert_one({"user_id": "auth0|a", "trail_id": MARSH, "status": "completed", "completed_at": checkins.now()})
    assert [b["key"] for b in badges.award("auth0|a")] == [f"trail:{MARSH}"]  # e.g. a crash skipped awarding
    assert badges.award("auth0|a") == []
    assert db.get_db().badges.count_documents({}) == 1


def test_badge_board_starts_empty(client, clock):
    board = client.get("/me/badges", headers=bearer("auth0|new")).json()
    assert board["badges"] == [] and board["completed_trails"] == 0 and board["total_trails"] == len(store.load_all())
    assert board["milestones"] == [{"count": 10, "earned": False}, {"count": 30, "earned": False}]
    assert board["today_remaining"] == 2 and board["repeats"] == []
    assert client.get("/me/badges").status_code == 401


def test_deleting_the_account_removes_check_ins_and_badges(client, clock):
    a, b = bearer("auth0|a"), bearer("auth0|b")
    hike(client, a, MARSH, clock)
    hike(client, b, MARSH, clock)
    client.post("/me/checkins", headers=a, json=at(MIKE))
    assert client.delete("/me", headers=a).status_code == 204
    d = db.get_db()
    assert d.checkins.count_documents({"user_id": "auth0|a"}) == 0 and d.checkin_locks.count_documents({"_id": "auth0|a"}) == 0
    assert d.badges.count_documents({"user_id": "auth0|a"}) == 0
    assert d.badges.count_documents({"user_id": "auth0|b"}) == 1 and d.checkins.count_documents({"user_id": "auth0|b"}) == 1
