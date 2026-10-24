"""chat_sessions collection: one document per conversation, messages embedded in order."""
from __future__ import annotations

import datetime as dt

from pymongo import DESCENDING

from .db import get_db, to_oid
from .models import ChatMessage
from .user_models import ChatSessionOut, ChatSessionSummary, StoredMessage

MAX_MESSAGES = 500  # keeps a session far below Mongo's 16MB document limit; past this we start a new one
TITLE_LEN = 60


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _msg(role: str, content: str, ts: dt.datetime, recommended_ids: list[str] | None = None) -> dict:
    return {"role": role, "content": content, "ts": ts, "recommended_ids": recommended_ids or []}


def record_exchange(
    user_id: str,
    session_id: str | None,
    request_messages: list[ChatMessage],
    reply: str,
    recommended_ids: list[str],
) -> str:
    """Store this turn and return the session id.

    The client resends the whole history every call, so an existing session only gets the newest user
    message plus the reply; a new session is seeded with everything the client sent.
    """
    coll = get_db().chat_sessions
    uid, now = to_oid(user_id), _now()
    reply_doc = _msg("assistant", reply, now, recommended_ids)

    oid = to_oid(session_id) if session_id else None
    session = coll.find_one({"_id": oid, "user_id": uid}, {"message_count": 1}) if oid else None
    if session and session["message_count"] < MAX_MESSAGES:
        new = [_msg("user", request_messages[-1].content, now), reply_doc]
        coll.update_one(
            {"_id": oid},
            {"$push": {"messages": {"$each": new}}, "$inc": {"message_count": len(new)}, "$set": {"updated_at": now}},
        )
        return str(oid)

    seeded = [_msg(m.role, m.content, now) for m in request_messages] + [reply_doc]
    first_user = next((m.content for m in request_messages if m.role == "user"), "New chat")
    return str(
        coll.insert_one(
            {
                "user_id": uid,
                "title": first_user.strip()[:TITLE_LEN],
                "messages": seeded,
                "message_count": len(seeded),
                "created_at": now,
                "updated_at": now,
            }
        ).inserted_id
    )


def list_for(user_id: str, limit: int = 50, skip: int = 0) -> list[ChatSessionSummary]:
    cur = get_db().chat_sessions.find({"user_id": to_oid(user_id)}, {"messages": 0}).sort("updated_at", DESCENDING)
    return [_summary(d) for d in cur.skip(skip).limit(limit)]


def get(user_id: str, session_id: str) -> ChatSessionOut | None:
    oid = to_oid(session_id)
    doc = get_db().chat_sessions.find_one({"_id": oid, "user_id": to_oid(user_id)}) if oid else None
    if doc is None:
        return None
    return ChatSessionOut(**_summary(doc).model_dump(), messages=[StoredMessage(**m) for m in doc["messages"]])


def delete(user_id: str, session_id: str) -> bool:
    oid = to_oid(session_id)
    return bool(oid) and get_db().chat_sessions.delete_one({"_id": oid, "user_id": to_oid(user_id)}).deleted_count == 1


def delete_all(user_id: str) -> int:
    return get_db().chat_sessions.delete_many({"user_id": to_oid(user_id)}).deleted_count


def _summary(doc: dict) -> ChatSessionSummary:
    return ChatSessionSummary(
        id=str(doc["_id"]),
        title=doc["title"],
        message_count=doc["message_count"],
        created_at=doc["created_at"],
        updated_at=doc["updated_at"],
    )
