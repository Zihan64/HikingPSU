"""users collection: account, profile, preferences, saved trails.

One document per user; profile and preferences are embedded because they are always read with the user.
"""
from __future__ import annotations

import datetime as dt

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from .db import get_db, to_oid
from .user_models import Preferences, Profile, UserOut


class EmailTaken(Exception):
    pass


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def normalize_email(email: str) -> str:
    return email.strip().lower()


def create(email: str, password_hash: str) -> dict:
    now = _now()
    doc = {
        "email": normalize_email(email),
        "password_hash": password_hash,
        "profile": Profile().model_dump(),
        "preferences": Preferences().model_dump(),
        "saved_trail_ids": [],
        "created_at": now,
        "updated_at": now,
    }
    try:
        doc["_id"] = get_db().users.insert_one(doc).inserted_id
    except DuplicateKeyError:
        raise EmailTaken(email)
    return doc


def get_by_email(email: str) -> dict | None:
    return get_db().users.find_one({"email": normalize_email(email)})


def get(user_id: str) -> dict | None:
    oid = to_oid(user_id)
    return get_db().users.find_one({"_id": oid}) if oid else None


def patch(user_id: str, changes: dict) -> dict | None:
    """changes: {"profile": {...}, "preferences": {...}} holding only the fields to set."""
    oid = to_oid(user_id)
    if oid is None:
        return None
    sets = {f"{section}.{k}": v for section, fields in changes.items() for k, v in (fields or {}).items()}
    sets["updated_at"] = _now()
    return get_db().users.find_one_and_update({"_id": oid}, {"$set": sets}, return_document=ReturnDocument.AFTER)


def set_saved(user_id: str, trail_id: str, saved: bool) -> dict | None:
    oid = to_oid(user_id)
    if oid is None:
        return None
    op = {"$addToSet" if saved else "$pull": {"saved_trail_ids": trail_id}, "$set": {"updated_at": _now()}}
    return get_db().users.find_one_and_update({"_id": oid}, op, return_document=ReturnDocument.AFTER)


def delete(user_id: str) -> bool:
    oid = to_oid(user_id)
    return bool(oid) and get_db().users.delete_one({"_id": oid}).deleted_count == 1


def to_out(doc: dict) -> UserOut:
    return UserOut(
        id=str(doc["_id"]),
        email=doc["email"],
        profile=doc["profile"],
        preferences=doc["preferences"],
        saved_trail_ids=doc.get("saved_trail_ids", []),
        created_at=doc["created_at"],
    )
