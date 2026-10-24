"""users collection: profile, preferences, saved trails.

One document per user. `_id` is the Auth0 user id (e.g. "auth0|65f1...", "google-oauth2|1098...").
Auth0 owns the account itself (email, password, social logins); nothing password-related is stored here.
Profile and preferences are embedded because they are always read with the user.
"""
from __future__ import annotations

import datetime as dt

from pymongo import ReturnDocument

from .db import get_db
from .user_models import Preferences, Profile, Registration, UserOut


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def normalize_email(email: str | None) -> str | None:
    return email.strip().lower() if email else None


def _bson(v):
    """BSON stores datetimes, not dates (e.g. profile.birthday)."""
    if isinstance(v, dt.date) and not isinstance(v, dt.datetime):
        return dt.datetime.combine(v, dt.time.min)
    return v


# Sign-up answers -> the fields the recommender already uses.
TRANSIT_FOR = {"car": ["car"], "bus": ["bus", "walk"], "bike_walk": ["bike", "walk"]}
MAX_LEVEL_FOR_EXPERIENCE = {0: 1, 1: 2, 2: 2, 3: 3, 4: 4, 5: 5}


def age_on(birthday: dt.date, today: dt.date) -> int:
    return today.year - birthday.year - ((today.month, today.day) < (birthday.month, birthday.day))


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
    sets = {f"{section}.{k}": _bson(v) for section, fields in changes.items() for k, v in (fields or {}).items()}
    sets["updated_at"] = _now()
    return get_db().users.find_one_and_update({"_id": user_id}, {"$set": sets}, return_document=ReturnDocument.AFTER)


def register(user: dict, form: Registration) -> dict | None:
    """Save the sign-up form. Submitting again (to edit it) keeps the original registered_at.

    Transport and experience also fill transit_modes / has_car / max_level / fitness so recommendations
    use them right away; max_level and fitness are only set if the user hasn't chosen them already.
    """
    now = _now()
    profile, prefs = user["profile"], user["preferences"]
    age = age_on(form.birthday, now.date())
    sets = {
        "profile.full_name": form.full_name,
        "profile.gender": form.gender,
        "profile.gender_custom": form.gender_custom,
        "profile.birthday": _bson(form.birthday),
        "profile.age": age if 10 <= age <= 110 else None,
        "profile.hiking_experience": form.hiking_experience,
        "profile.transport": form.transport,
        "profile.has_car": form.transport == "car",
        "preferences.transit_modes": TRANSIT_FOR[form.transport],
        "updated_at": now,
    }
    if prefs.get("max_level") is None:
        sets["preferences.max_level"] = MAX_LEVEL_FOR_EXPERIENCE[form.hiking_experience]
    if profile.get("fitness") is None:
        sets["profile.fitness"] = max(1, form.hiking_experience)
    if not profile.get("display_name"):
        # Reviews show display_name publicly, so use the first name only.
        sets["profile.display_name"] = form.full_name.split()[0]
    # Optional fields change only when sent; sending "" or null clears one.
    optional = {"phone": "profile.phone", "preferences": "preferences.notes", "email": "email"}
    for field, path in optional.items():
        if field in form.model_fields_set:
            sets[path] = normalize_email(form.email) if field == "email" else getattr(form, field)
    if not user.get("registered_at"):
        sets["registered_at"] = now
    return get_db().users.find_one_and_update({"_id": user["_id"]}, {"$set": sets}, return_document=ReturnDocument.AFTER)


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
        registered=doc.get("registered_at") is not None,
    )
