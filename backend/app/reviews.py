"""reviews collection: at most one review per (user, trail); rating it again edits the existing one."""
from __future__ import annotations

import datetime as dt

from pymongo import DESCENDING, ReturnDocument

from . import store
from .db import get_db, to_oid
from .user_models import ReviewOut, ReviewSummary

SCORES = ("accuracy", "difficulty", "enjoyment")


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _author(user: dict) -> str:
    """Public name: never the email, which would leak accounts to everyone reading a trail."""
    return (user["profile"].get("display_name") or "").strip() or "Hiker"


def upsert(user: dict, trail_id: str, scores: dict) -> dict:
    if store.get(trail_id) is None:
        raise KeyError(trail_id)
    now = _now()
    comment = (scores.get("comment") or "").strip() or None
    fields = {**{k: scores[k] for k in SCORES}, "comment": comment, "author": _author(user), "updated_at": now}
    return get_db().reviews.find_one_and_update(
        {"user_id": user["_id"], "trail_id": trail_id},
        {"$set": fields, "$setOnInsert": {"created_at": now}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )


def list_for_trail(trail_id: str, limit: int = 100, skip: int = 0) -> list[dict]:
    cur = get_db().reviews.find({"trail_id": trail_id}).sort("created_at", DESCENDING).skip(skip).limit(limit)
    return list(cur)


def summarize(trail_id: str | None = None) -> dict[str, ReviewSummary]:
    """Average scores per trail (or just one trail), computed in the database."""
    pipeline = [
        {"$match": {"trail_id": trail_id} if trail_id else {}},
        {"$group": {"_id": "$trail_id", "count": {"$sum": 1}, **{k: {"$avg": f"${k}"} for k in SCORES}}},
    ]
    return {
        row["_id"]: ReviewSummary(count=row["count"], **{k: round(row[k], 1) for k in SCORES})
        for row in get_db().reviews.aggregate(pipeline)
    }


def delete(user_id: str, trail_id: str) -> bool:
    return get_db().reviews.delete_one({"user_id": to_oid(user_id), "trail_id": trail_id}).deleted_count == 1


def delete_all(user_id: str) -> int:
    return get_db().reviews.delete_many({"user_id": to_oid(user_id)}).deleted_count


def to_out(doc: dict, viewer_id: str | None = None) -> ReviewOut:
    return ReviewOut(
        id=str(doc["_id"]),
        trail_id=doc["trail_id"],
        author=doc["author"],
        accuracy=doc["accuracy"],
        difficulty=doc["difficulty"],
        enjoyment=doc["enjoyment"],
        comment=doc.get("comment"),
        created_at=doc["created_at"],
        updated_at=doc["updated_at"],
        mine=viewer_id is not None and str(doc["user_id"]) == viewer_id,
    )
