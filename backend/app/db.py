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
    db.users.create_index([("email", ASCENDING)], unique=True)
    db.hike_logs.create_index([("user_id", ASCENDING), ("completed_on", DESCENDING)])
    db.hike_logs.create_index([("user_id", ASCENDING), ("trail_id", ASCENDING)])
    db.chat_sessions.create_index([("user_id", ASCENDING), ("updated_at", DESCENDING)])


def to_oid(value: str) -> ObjectId | None:
    try:
        return ObjectId(value)
    except (InvalidId, TypeError):
        return None
