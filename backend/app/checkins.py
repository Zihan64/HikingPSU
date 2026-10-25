"""Trailhead check-ins: the proof behind a completed hike, and therefore behind every badge.

Flow: start (one location fix at a trail entrance) -> hike -> finish with a rating (badges.py awards).
Only the distance and accuracy derived from the fix are stored; the coordinates never are.

checkins       one document per check-in; status active -> completed | cancelled | expired
checkin_locks  _id = user id while a check-in is active, so two starts can't both succeed
"""
from __future__ import annotations

import datetime as dt
import math
from functools import lru_cache
from zoneinfo import ZoneInfo

from bson import ObjectId
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from . import store
from .db import get_db, to_oid
from .user_models import CheckinOut

RULES = {
    "radius_m": 200,          # check in this close to a trail entrance
    "max_accuracy_m": 100,    # reported accuracy radius must be at least this good
    "min_minutes": 15,        # finish no earlier than max(min_minutes, min_share * estimated time)
    "min_share": 0.4,
    "expires_hours": 24,
    "daily_limit": 2,         # completions per State College calendar day
}
LOCAL_TZ = ZoneInfo("America/New_York")


class CheckinError(Exception):
    """A rule the user hit; `status` is the HTTP status, the message is shown as-is."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def utc(d: dt.datetime | None) -> dt.datetime | None:
    """MongoDB hands datetimes back naive (in UTC); make them aware before comparing or returning."""
    return d.replace(tzinfo=dt.timezone.utc) if d is not None and d.tzinfo is None else d


def _query_time(d: dt.datetime) -> dt.datetime:
    return d.astimezone(dt.timezone.utc).replace(tzinfo=None)  # naive UTC, as stored


def local_clock(d: dt.datetime) -> str:
    """'3:05 PM' in State College time, for messages."""
    return d.astimezone(LOCAL_TZ).strftime("%I:%M %p").lstrip("0")


def start_of_local_day(at: dt.datetime) -> dt.datetime:
    local = at.astimezone(LOCAL_TZ)
    return local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(dt.timezone.utc)


# ---------- where a trail can be entered ----------

def distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance (haversine)."""
    r = 6_371_000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


@lru_cache(maxsize=None)
def entrances(trail_id: str) -> tuple[tuple[float, float], ...]:
    """(lat, lon) points that count as an entrance: the trailhead plus the ends of the mapped route,
    since out-and-back trails can be started from either end and a seeded trailhead can be off."""
    trail = store.get(trail_id)
    if trail is None:
        return ()
    points = [(trail.trailhead.lat, trail.trailhead.lon)]
    geometry = store.load_geometry().get(trail_id) or {}
    lines = geometry.get("lines") or ([geometry["line"]] if geometry.get("line") else [])
    for line in lines:  # GeoJSON order: [lon, lat]
        if line:
            points += [(line[0][1], line[0][0]), (line[-1][1], line[-1][0])]
    return tuple(dict.fromkeys(points))


def nearest_entrance_m(trail_id: str, lat: float, lon: float) -> float:
    return min(distance_m(lat, lon, plat, plon) for plat, plon in entrances(trail_id))


def _format_distance(meters: float) -> str:
    return f"{round(meters / 10) * 10:.0f} m" if meters < 1000 else f"{meters / 1000:.1f} km"


def min_minutes(trail_id: str) -> int:
    trail = store.get(trail_id)
    estimate = trail.difficulty.est_time_min if trail else 0
    return max(RULES["min_minutes"], math.ceil(RULES["min_share"] * estimate))


# ---------- reading ----------

def completions_today(user_id: str, at: dt.datetime | None = None) -> int:
    since = start_of_local_day(at or now())
    return get_db().checkins.count_documents(
        {"user_id": user_id, "status": "completed", "completed_at": {"$gte": _query_time(since)}}
    )


def today_remaining(user_id: str) -> int:
    return max(0, RULES["daily_limit"] - completions_today(user_id))


def _expire(doc: dict) -> None:
    get_db().checkins.update_one({"_id": doc["_id"], "status": "active"}, {"$set": {"status": "expired"}})
    get_db().checkin_locks.delete_one({"_id": doc["user_id"], "checkin_id": doc["_id"]})


def get_active(user_id: str) -> dict | None:
    """The user's active check-in, expiring it first if its 24 hours are up."""
    lock = get_db().checkin_locks.find_one({"_id": user_id})
    if lock is None:
        return None
    doc = get_db().checkins.find_one({"_id": lock["checkin_id"], "status": "active"})
    if doc is None:  # stale lock (e.g. a crash between steps); release it
        get_db().checkin_locks.delete_one({"_id": user_id, "checkin_id": lock["checkin_id"]})
        return None
    if utc(doc["expires_at"]) <= now():
        _expire(doc)
        return None
    return doc


def _owned(user_id: str, checkin_id: str) -> dict:
    oid = to_oid(checkin_id)
    doc = get_db().checkins.find_one({"_id": oid, "user_id": user_id}) if oid else None
    if doc is None:
        raise CheckinError(404, "check-in not found")
    return doc


# ---------- writing ----------

def start(user_id: str, trail_id: str, lat: float, lon: float, accuracy_m: float) -> dict:
    trail = store.get(trail_id)
    if trail is None:
        raise CheckinError(404, "trail not found")
    active = get_active(user_id)
    if active is not None:
        raise CheckinError(409, f"You're already checked in at {active['trail_name']}. Finish or cancel that hike first.")
    if completions_today(user_id) >= RULES["daily_limit"]:
        raise CheckinError(429, f"You've completed {RULES['daily_limit']} trails today, the daily limit. Come back tomorrow!")
    if accuracy_m > RULES["max_accuracy_m"]:
        raise CheckinError(422, (
            f"Your location is only accurate to about {_format_distance(accuracy_m)}. Step into the open or wait a "
            f"moment, then try again (we need {RULES['max_accuracy_m']} m or better)."
        ))
    meters = nearest_entrance_m(trail_id, lat, lon)
    if meters > RULES["radius_m"]:
        raise CheckinError(422, (
            f"You're about {_format_distance(meters)} from the nearest entrance of {trail.name}. "
            f"Check in within {RULES['radius_m']} m."
        ))

    started = now()
    doc = {
        "_id": ObjectId(),
        "user_id": user_id,
        "trail_id": trail_id,
        "trail_name": trail.name,
        "status": "active",
        "started_at": started,
        "finish_after": started + dt.timedelta(minutes=min_minutes(trail_id)),
        "expires_at": started + dt.timedelta(hours=RULES["expires_hours"]),
        "distance_m": round(meters),
        "accuracy_m": round(accuracy_m),
        # no lat/lon: the fix is used for this check and then discarded
    }
    try:
        get_db().checkin_locks.insert_one({"_id": user_id, "checkin_id": doc["_id"], "created_at": started})
    except DuplicateKeyError:  # a second start raced this one
        raise CheckinError(409, "You already have an active check-in. Finish or cancel that hike first.")
    get_db().checkins.insert_one(doc)
    return doc


def cancel(user_id: str, checkin_id: str) -> None:
    doc = _owned(user_id, checkin_id)
    if doc["status"] == "active" and utc(doc["expires_at"]) <= now():
        _expire(doc)
        raise CheckinError(404, "no active check-in with that id")
    done = get_db().checkins.find_one_and_update(
        {"_id": doc["_id"], "status": "active"}, {"$set": {"status": "cancelled", "cancelled_at": now()}}
    )
    if done is None:
        raise CheckinError(404, "no active check-in with that id")
    get_db().checkin_locks.delete_one({"_id": user_id, "checkin_id": doc["_id"]})


def check_finishable(user_id: str, checkin_id: str) -> dict:
    """Every rule for finishing, checked before anything is written. Returns the check-in."""
    doc = _owned(user_id, checkin_id)
    current = now()
    if doc["status"] == "active" and utc(doc["expires_at"]) <= current:
        _expire(doc)
        raise CheckinError(409, "This check-in expired after 24 hours. Check in again at the trailhead to log a new hike.")
    if doc["status"] != "active":
        raise CheckinError(409, f"This check-in is already {doc['status']}.")
    if current < utc(doc["finish_after"]):
        raise CheckinError(409, f"You can finish after {local_clock(utc(doc['finish_after']))}.")
    if completions_today(user_id, current) >= RULES["daily_limit"]:
        raise CheckinError(429, f"You've completed {RULES['daily_limit']} trails today, the daily limit. Finish this one tomorrow.")
    return doc


def mark_completed(doc: dict) -> dict:
    """Atomically active -> completed, so a double submit can't complete a hike twice."""
    done = get_db().checkins.find_one_and_update(
        {"_id": doc["_id"], "status": "active"},
        {"$set": {"status": "completed", "completed_at": now()}},
        return_document=ReturnDocument.AFTER,
    )
    if done is None:
        raise CheckinError(409, "This check-in was already finished.")
    get_db().checkin_locks.delete_one({"_id": doc["user_id"], "checkin_id": doc["_id"]})
    return done


def link(doc: dict, **ids) -> None:
    get_db().checkins.update_one({"_id": doc["_id"]}, {"$set": ids})


def completed_trail_ids(user_id: str) -> list[str]:
    """One entry per verified completion (repeats included), oldest first."""
    cur = get_db().checkins.find({"user_id": user_id, "status": "completed"}, {"trail_id": 1}).sort("completed_at", 1)
    return [d["trail_id"] for d in cur]


def delete_all(user_id: str) -> int:
    get_db().checkin_locks.delete_many({"_id": user_id})
    return get_db().checkins.delete_many({"user_id": user_id}).deleted_count


def to_out(doc: dict) -> CheckinOut:
    return CheckinOut(
        id=str(doc["_id"]),
        trail_id=doc["trail_id"],
        trail_name=doc["trail_name"],
        status=doc["status"],
        started_at=utc(doc["started_at"]),
        finish_after=utc(doc["finish_after"]),
        expires_at=utc(doc["expires_at"]),
        completed_at=utc(doc.get("completed_at")),
        distance_m=doc["distance_m"],
    )
