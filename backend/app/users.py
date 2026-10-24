"""users collection: profile, preferences, saved trails.

One document per user. `_id` is the Auth0 user id (e.g. "auth0|65f1...", "google-oauth2|1098...").
Auth0 owns the account itself (email, password, social logins); nothing password-related is stored here.
Profile and preferences are embedded because they are always read with the user.
"""
from __future__ import annotations

import datetime as dt

from pymongo import ReturnDocument

from .db import get_db
from .user_models import Preferences, Profile, UserOut


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def normalize_email(email: str | None) -> str | None:
    return email.strip().lower() if email else None


def get_or_create(user_id: str, email: str | None = None, name: str | None = None) -> dict:
    """Create the user's document on first login; return the existing one otherwise. Safe under races."""
    now = _now()
    # Auth0 sets `name` to the email for password signups; reviews show display_name publicly,
    # so only use names that don't look like an email.
    safe_name = name.strip()[:60] if name and "@" not in name and name.strip() else None
    profile = Profile(display_name=safe_name).model_dump()
    return get_db().users.find_one_and_update(
        {"_id": user_id},
        {
            "$setOnInsert": {
                "email": normalize_email(email),
                "profile": profile,
                "preferences": Preferences().model_dump(),
                "saved_trail_ids": [],
                "created_at": now,
                "updated_at": now,
            }
        },
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )


def get(user_id: str) -> dict | None:
    return get_db().users.find_one({"_id": user_id}) if user_id else None


def patch(user_id: str, changes: dict) -> dict | None:
    """changes: {"profile": {...}, "preferences": {...}} holding only the fields to set."""
    sets = {f"{section}.{k}": v for section, fields in changes.items() for k, v in (fields or {}).items()}
    sets["updated_at"] = _now()
    return get_db().users.find_one_and_update({"_id": user_id}, {"$set": sets}, return_document=ReturnDocument.AFTER)


def set_saved(user_id: str, trail_id: str, saved: bool) -> dict | None:
    op = {"$addToSet" if saved else "$pull": {"saved_trail_ids": trail_id}, "$set": {"updated_at": _now()}}
    return get_db().users.find_one_and_update({"_id": user_id}, op, return_document=ReturnDocument.AFTER)


def delete(user_id: str) -> bool:
    return get_db().users.delete_one({"_id": user_id}).deleted_count == 1


def to_out(doc: dict) -> UserOut:
    return UserOut(
        id=str(doc["_id"]),
        email=doc.get("email"),
        profile=doc["profile"],
        preferences=doc["preferences"],
        saved_trail_ids=doc.get("saved_trail_ids", []),
        created_at=doc["created_at"],
    )
