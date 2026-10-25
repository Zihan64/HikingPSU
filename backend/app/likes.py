"""likes collection: one heart per (user, comment). A comment is a review id or a starter-tip id."""
from __future__ import annotations

import datetime as dt
from collections.abc import Iterable

from .db import get_db


def add(user_id: str, target_id: str) -> None:
    """Idempotent: hearting twice still counts once."""
    get_db().likes.update_one(
        {"target_id": target_id, "user_id": user_id},
        {"$setOnInsert": {"created_at": dt.datetime.now(dt.timezone.utc)}},
        upsert=True,
    )


def remove(user_id: str, target_id: str) -> None:
    get_db().likes.delete_one({"target_id": target_id, "user_id": user_id})


def counts(target_ids: Iterable[str]) -> dict[str, int]:
    ids = list(target_ids)
    if not ids:
        return {}
    pipeline = [{"$match": {"target_id": {"$in": ids}}}, {"$group": {"_id": "$target_id", "n": {"$sum": 1}}}]
    return {row["_id"]: row["n"] for row in get_db().likes.aggregate(pipeline)}


def liked_by(user_id: str | None, target_ids: Iterable[str]) -> set[str]:
    ids = list(target_ids)
    if not user_id or not ids:
        return set()
    return {d["target_id"] for d in get_db().likes.find({"user_id": user_id, "target_id": {"$in": ids}}, {"target_id": 1})}


def delete_for_targets(target_ids: Iterable[str]) -> None:
    ids = list(target_ids)
    if ids:
        get_db().likes.delete_many({"target_id": {"$in": ids}})


def delete_by_user(user_id: str) -> None:
    get_db().likes.delete_many({"user_id": user_id})
