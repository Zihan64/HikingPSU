"""MongoDB connection. Lazy, so the app (and trail search) still runs with no database configured."""
from __future__ import annotations

import logging
import os

from bson import ObjectId
from bson.errors import InvalidId
from pymongo import ASCENDING, DESCENDING, MongoClient
from pymongo.database import Database

log = logging.getLogger("hikingpsu.db")


class DatabaseUnavailable(RuntimeError):
    """MONGODB_URI is not configured."""


_client: MongoClient | None = None
_indexed = False


def set_client(client: MongoClient | None) -> None:
    """Swap the client (tests inject mongomock)."""
    global _client, _indexed
    _client = client
    _indexed = False


def get_db() -> Database:
    global _client, _indexed
    if _client is None:
        uri = os.getenv("MONGODB_URI")
        if not uri:
            raise DatabaseUnavailable("MONGODB_URI is not set")
        _client = MongoClient(uri, serverSelectionTimeoutMS=3000)
    db = _client[os.getenv("MONGODB_DB", "hikingpsu")]
    if not _indexed:
        ensure_indexes(db)
        _indexed = True
    return db


def ensure_indexes(db: Database) -> None:
    # Older builds made email unique; Auth0 users may share or lack an email, so drop that index.
    if db.users.index_information().get("email_1", {}).get("unique"):
        db.users.drop_index("email_1")
    db.hike_logs.create_index([("user_id", ASCENDING), ("completed_on", DESCENDING)])
    db.hike_logs.create_index([("user_id", ASCENDING), ("trail_id", ASCENDING)])
    db.chat_sessions.create_index([("user_id", ASCENDING), ("updated_at", DESCENDING)])
    db.reviews.create_index([("user_id", ASCENDING), ("trail_id", ASCENDING)], unique=True)
    db.reviews.create_index([("trail_id", ASCENDING), ("created_at", DESCENDING)])
    db.reviews.create_index([("created_at", DESCENDING)])
    db.likes.create_index([("target_id", ASCENDING), ("user_id", ASCENDING)], unique=True)
    db.likes.create_index([("user_id", ASCENDING)])
    db.checkins.create_index([("user_id", ASCENDING), ("status", ASCENDING), ("completed_at", ASCENDING)])
    db.badges.create_index([("user_id", ASCENDING), ("key", ASCENDING)], unique=True)
    db.hike_logs.create_index([("user_id", ASCENDING), ("checkin_id", ASCENDING)])
    db.follows.create_index([("follower_id", ASCENDING), ("followee_id", ASCENDING)], unique=True)
    db.follows.create_index([("followee_id", ASCENDING), ("created_at", DESCENDING)])
    db.handles.create_index([("user_id", ASCENDING)])
    db.users.create_index([("handle", ASCENDING)])


def to_oid(value: str) -> ObjectId | None:
    try:
        return ObjectId(value)
    except (InvalidId, TypeError):
        return None
