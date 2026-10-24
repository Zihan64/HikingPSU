"""hike_logs collection: one document per completed hike (a user may repeat a trail)."""
from __future__ import annotations

import datetime as dt

from pymongo import DESCENDING, ReturnDocument

from . import store
from .db import get_db, to_oid
from .user_models import HikeOut, HikeStats


def _to_dt(d: dt.date) -> dt.datetime:
    return dt.datetime.combine(d, dt.time.min)  # BSON stores datetimes, not dates


def add(user_id: str, trail_id: str, completed_on: dt.date, **fields) -> dict:
    trail = store.get(trail_id)
    if trail is None:
        raise KeyError(trail_id)
    now = dt.datetime.now(dt.timezone.utc)
    doc = {
        "user_id": to_oid(user_id),
        "trail_id": trail_id,
        "trail_name": trail.name,  # denormalized so history survives trail renames/removals
        "completed_on": _to_dt(completed_on),
        **fields,
        "created_at": now,
        "updated_at": now,
    }
    doc["_id"] = get_db().hike_logs.insert_one(doc).inserted_id
    return doc


def list_for(user_id: str, limit: int = 100, skip: int = 0) -> list[dict]:
    cur = get_db().hike_logs.find({"user_id": to_oid(user_id)}).sort("completed_on", DESCENDING).skip(skip).limit(limit)
    return list(cur)


def update(user_id: str, hike_id: str, changes: dict) -> dict | None:
    oid = to_oid(hike_id)
    if oid is None:
        return None
    if "completed_on" in changes and changes["completed_on"] is not None:
        changes["completed_on"] = _to_dt(changes["completed_on"])
    changes["updated_at"] = dt.datetime.now(dt.timezone.utc)
    return get_db().hike_logs.find_one_and_update(
        {"_id": oid, "user_id": to_oid(user_id)}, {"$set": changes}, return_document=ReturnDocument.AFTER
    )


def delete(user_id: str, hike_id: str) -> bool:
    oid = to_oid(hike_id)
    return bool(oid) and get_db().hike_logs.delete_one({"_id": oid, "user_id": to_oid(user_id)}).deleted_count == 1


def delete_all(user_id: str) -> int:
    return get_db().hike_logs.delete_many({"user_id": to_oid(user_id)}).deleted_count


def stats(user_id: str) -> HikeStats:
    docs = list(get_db().hike_logs.find({"user_id": to_oid(user_id)}, {"trail_id": 1}))
    dist, gain = 0.0, 0
    for d in docs:
        t = store.get(d["trail_id"])
        if t:
            dist += t.distance_mi
            gain += t.elevation_gain_ft
    return HikeStats(
        total_hikes=len(docs),
        unique_trails=len({d["trail_id"] for d in docs}),
        total_distance_mi=round(dist, 1),
        total_elevation_gain_ft=gain,
    )


def agent_summary(user_id: str, limit: int = 20) -> dict:
    """Compact history for the agent's system prompt."""
    docs = list_for(user_id, limit=limit)
    done = list(dict.fromkeys(d["trail_id"] for d in docs))
    loved = list(dict.fromkeys(d["trail_id"] for d in docs if (d.get("rating") or 0) >= 4))
    return {"completed_trail_ids": done, "favorite_trail_ids": loved}


def to_out(doc: dict) -> HikeOut:
    return HikeOut(
        id=str(doc["_id"]),
        trail_id=doc["trail_id"],
        trail_name=doc["trail_name"],
        completed_on=doc["completed_on"].date(),
        duration_min=doc.get("duration_min"),
        rating=doc.get("rating"),
        felt_difficulty=doc.get("felt_difficulty"),
        notes=doc.get("notes"),
        created_at=doc["created_at"],
    )
