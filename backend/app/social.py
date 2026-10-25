"""Public profiles, usernames (handles), people search and follows.

handles   _id = handle (lowercase) -> user_id; unique by construction, so two users can't claim one name
follows   one document per (follower_id, followee_id)
users     .handle is the user's current handle; profile.public_profile False hides badges and stats

Only the public name (profile.display_name), handle, join date, counts and badges ever leave this
module; email, full name, birthday, gender, phone and address never do.
"""
from __future__ import annotations

import datetime as dt
import re
import secrets
import unicodedata

from pymongo import DESCENDING
from pymongo.errors import DuplicateKeyError

from . import badges, checkins, store
from .db import get_db
from .user_models import ActivityItem, ActivityUser, FollowState, PublicProfile, UserCard

HANDLE_RE = re.compile(r"^[a-z][a-z0-9_]{2,19}$")
RESERVED = {
    "about", "activity", "admin", "administrator", "api", "help", "hikingpsu", "login", "logout", "me", "mod",
    "moderator", "null", "official", "pennstate", "profile", "psu", "root", "settings", "signup", "staff",
    "support", "system", "team", "undefined", "user", "users",
}


class SocialError(Exception):
    """A rule the user hit; `status` is the HTTP status, the message is shown as-is."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def public_name(user: dict) -> str:
    return (user["profile"].get("display_name") or "").strip() or "Hiker"


def is_public(user: dict) -> bool:
    return user["profile"].get("public_profile") is not False  # null (never set) means public


# ---------- handles ----------

def normalize(handle: str) -> str:
    return (handle or "").strip().lower()


def validate(handle: str) -> str:
    h = normalize(handle)
    if not HANDLE_RE.match(h):
        raise SocialError(422, "Usernames are 3-20 characters: lowercase letters, numbers and underscores, starting with a letter.")
    if h in RESERVED:
        raise SocialError(422, "That username is reserved. Please pick another.")
    return h


def _claim(user_id: str, handle: str) -> bool:
    try:
        get_db().handles.insert_one({"_id": handle, "user_id": user_id, "created_at": _now()})
        return True
    except DuplicateKeyError:
        return get_db().handles.find_one({"_id": handle, "user_id": user_id}) is not None  # already ours


def _base(name: str) -> str:
    """'Zoë O'Brien' -> 'zoeobrien': ASCII letters and digits only, starting with a letter."""
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    base = re.sub(r"[^a-z0-9]", "", ascii_name).lstrip("0123456789")[:15]
    return base if len(base) >= 3 and base not in RESERVED else "hiker"


def ensure_handle(user: dict) -> dict:
    """Give a signed-up user a handle if they have none: their name, or their name plus digits."""
    if user.get("handle"):
        return user
    base = _base(public_name(user))
    candidates = [base] + [f"{base}{secrets.randbelow(9000) + 1000}" for _ in range(20)]
    for handle in candidates:
        if _claim(user["_id"], handle):
            get_db().users.update_one({"_id": user["_id"]}, {"$set": {"handle": handle}})
            return {**user, "handle": handle}
    return user  # astronomically unlikely; the next /me tries again


def change_handle(user: dict, new: str) -> dict:
    handle = validate(new)
    old = user.get("handle")
    if handle == old:
        return user
    if not _claim(user["_id"], handle):
        raise SocialError(409, "That username is taken.")
    get_db().users.update_one({"_id": user["_id"]}, {"$set": {"handle": handle}})
    if old:
        get_db().handles.delete_one({"_id": old, "user_id": user["_id"]})
    return {**user, "handle": handle}


def user_by_handle(handle: str) -> dict | None:
    """A signed-up user by handle (case-insensitive), or None."""
    h = get_db().handles.find_one({"_id": normalize(handle)})
    user = get_db().users.find_one({"_id": h["user_id"]}) if h else None
    return user if user and user.get("registered_at") and user.get("handle") == h["_id"] else None


def require(handle: str) -> dict:
    user = user_by_handle(handle)
    if user is None:
        raise SocialError(404, "no hiker with that username")
    return user


def handles_for(user_ids: list[str]) -> dict[str, str]:
    """user id -> handle, for the users that have one (e.g. review authors)."""
    ids = list(dict.fromkeys(user_ids))
    if not ids:
        return {}
    return {d["_id"]: d["handle"] for d in get_db().users.find({"_id": {"$in": ids}, "handle": {"$exists": True}}, {"handle": 1})}


# ---------- follows ----------

def followers_count(user_id: str) -> int:
    return get_db().follows.count_documents({"followee_id": user_id})


def following_count(user_id: str) -> int:
    return get_db().follows.count_documents({"follower_id": user_id})


def follows(follower_id: str | None, followee_id: str) -> bool:
    return bool(follower_id) and get_db().follows.find_one({"follower_id": follower_id, "followee_id": followee_id}) is not None


def follow(follower_id: str, target: dict) -> FollowState:
    if target["_id"] == follower_id:
        raise SocialError(422, "You can't follow yourself.")
    get_db().follows.update_one(
        {"follower_id": follower_id, "followee_id": target["_id"]},
        {"$setOnInsert": {"created_at": _now()}},
        upsert=True,
    )
    return FollowState(following=True, followers_count=followers_count(target["_id"]))


def unfollow(follower_id: str, target: dict) -> FollowState:
    get_db().follows.delete_one({"follower_id": follower_id, "followee_id": target["_id"]})
    return FollowState(following=False, followers_count=followers_count(target["_id"]))


# ---------- what others see ----------

def _counts(collection: str, field: str, ids: list[str]) -> dict[str, int]:
    if not ids:
        return {}
    pipeline = [{"$match": {field: {"$in": ids}}}, {"$group": {"_id": f"${field}", "n": {"$sum": 1}}}]
    return {row["_id"]: row["n"] for row in get_db()[collection].aggregate(pipeline)}


def cards(users: list[dict], viewer_id: str | None) -> list[UserCard]:
    """UserCards for a page of users, with their counts fetched in a few queries."""
    ids = [u["_id"] for u in users]
    badge_counts = _counts("badges", "user_id", ids)
    follower_counts = _counts("follows", "followee_id", ids)
    followed = {d["followee_id"] for d in get_db().follows.find({"follower_id": viewer_id, "followee_id": {"$in": ids}})} if viewer_id else set()
    return [
        UserCard(
            handle=u["handle"], display_name=public_name(u), is_public=is_public(u),
            badge_count=badge_counts.get(u["_id"], 0) if is_public(u) or u["_id"] == viewer_id else 0,
            followers_count=follower_counts.get(u["_id"], 0),
            following=(u["_id"] in followed) if viewer_id else None, is_me=u["_id"] == viewer_id,
        )
        for u in users
    ]


def profile(user: dict, viewer_id: str | None) -> PublicProfile:
    me = user["_id"] == viewer_id
    shown = is_public(user) or me
    joined = checkins.utc(user.get("registered_at") or user["created_at"]).astimezone(checkins.LOCAL_TZ).date()
    earned = list(get_db().badges.find({"user_id": user["_id"]}).sort([("awarded_at", DESCENDING), ("key", 1)])) if shown else []
    return PublicProfile(
        handle=user["handle"], display_name=public_name(user), joined=joined, is_me=me, is_public=is_public(user),
        following=follows(viewer_id, user["_id"]) if viewer_id else None,
        follows_you=bool(viewer_id) and follows(user["_id"], viewer_id),
        followers_count=followers_count(user["_id"]), following_count=following_count(user["_id"]),
        completed_trails=len(set(checkins.completed_trail_ids(user["_id"]))) if shown else None,
        total_trails=len(store.load_all()),
        badge_count=len(earned) if shown else None,
        badges=[badges.to_out(d) for d in earned],
    )


def search(q: str, viewer_id: str | None, limit: int = 20) -> list[UserCard]:
    text = (q or "").strip()
    if not 2 <= len(text) <= 30:
        raise SocialError(422, "Search with 2 to 30 characters.")
    pattern = re.escape(text.lower())
    found = list(get_db().users.find(
        {"registered_at": {"$exists": True}, "handle": {"$exists": True},
         "$or": [{"handle": {"$regex": f"^{pattern}"}},
                 {"profile.display_name": {"$regex": f"(^|\\s){re.escape(text)}", "$options": "i"}}]},
    ).sort("handle", 1).limit(limit))
    found.sort(key=lambda u: (u["handle"] != text.lower(), not u["handle"].startswith(text.lower()), u["handle"]))
    return cards(found, viewer_id)


def _list(user: dict, viewer_id: str | None, mine_field: str, theirs_field: str, skip: int, limit: int) -> list[UserCard]:
    if not is_public(user) and user["_id"] != viewer_id:
        raise SocialError(403, "this profile is private")
    rows = list(get_db().follows.find({mine_field: user["_id"]}).sort("created_at", DESCENDING).skip(skip).limit(limit))
    ids = [r[theirs_field] for r in rows]
    by_id = {u["_id"]: u for u in get_db().users.find({"_id": {"$in": ids}, "handle": {"$exists": True}, "registered_at": {"$exists": True}})}
    return cards([by_id[i] for i in ids if i in by_id], viewer_id)


def followers(user: dict, viewer_id: str | None, skip: int = 0, limit: int = 50) -> list[UserCard]:
    return _list(user, viewer_id, "followee_id", "follower_id", skip, limit)


def following(user: dict, viewer_id: str | None, skip: int = 0, limit: int = 50) -> list[UserCard]:
    return _list(user, viewer_id, "follower_id", "followee_id", skip, limit)


def activity(viewer_id: str, limit: int = 30) -> list[ActivityItem]:
    """Badges recently earned by the public profiles the viewer follows."""
    ids = [d["followee_id"] for d in get_db().follows.find({"follower_id": viewer_id}, {"followee_id": 1})]
    people = {u["_id"]: u for u in get_db().users.find({"_id": {"$in": ids}, "handle": {"$exists": True}}) if is_public(u)}
    docs = get_db().badges.find({"user_id": {"$in": list(people)}}).sort([("awarded_at", DESCENDING), ("key", 1)]).limit(limit)
    return [ActivityItem(user=ActivityUser(handle=people[d["user_id"]]["handle"], display_name=public_name(people[d["user_id"]])),
                         badge=badges.to_out(d)) for d in docs]


def delete_all(user_id: str) -> None:
    """Account deletion: their handle, who they follow, and who follows them."""
    get_db().follows.delete_many({"$or": [{"follower_id": user_id}, {"followee_id": user_id}]})
    get_db().handles.delete_many({"user_id": user_id})
