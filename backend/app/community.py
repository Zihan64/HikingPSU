"""Community comments: the cross-trail feed, the top comments shown on each trail card, and hearts.

Comments are trail reviews. Starter tips (data/community_seed.json) fill trail cards that no hiker
has commented on yet; they are static content, labelled as tips, and never count toward ratings.
"""
from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

from pymongo import DESCENDING
from pymongo.errors import ConnectionFailure

from . import likes, reviews, store
from .db import DatabaseUnavailable, get_db, to_oid
from .user_models import ReviewOut

SEED_PATH = Path(__file__).resolve().parent.parent / "data" / "community_seed.json"
TIP_AUTHOR = "HikingPSU"
TIP_DATE = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)
TOP_WINDOW = 500  # "most loved" ranks this many recent reviews; plenty at campus scale


def _load_tips() -> dict[str, dict]:
    tips, seen = {}, {}
    for row in json.loads(SEED_PATH.read_text(encoding="utf-8")) if SEED_PATH.exists() else []:
        n = seen[row["trail_id"]] = seen.get(row["trail_id"], 0) + 1
        tip_id = f"tip:{row['trail_id']}:{n}"
        tips[tip_id] = {"id": tip_id, "trail_id": row["trail_id"], "comment": row["comment"]}
    return tips


TIPS = _load_tips()


def _tip_out(tip: dict, like_count: int = 0, liked: bool = False) -> ReviewOut:
    return ReviewOut(id=tip["id"], trail_id=tip["trail_id"], author=TIP_AUTHOR, comment=tip["comment"],
                     created_at=TIP_DATE, updated_at=TIP_DATE, likes=like_count, liked=liked, tip=True)


def highlights(viewer_id: str | None = None, per_trail: int = 2) -> dict[str, list[ReviewOut]]:
    """Up to `per_trail` comments per trail: most hearted first, hikers' comments before tips on a tie."""
    tips = [t for t in TIPS.values() if store.get(t["trail_id"]) is not None]
    tip_ids = [t["id"] for t in tips]
    try:
        docs = list(get_db().reviews.find({"comment": {"$ne": None}}).sort("created_at", DESCENDING).limit(2000))
        items = reviews.to_out_many(docs, viewer_id)
        counts, mine = likes.counts(tip_ids), likes.liked_by(viewer_id, tip_ids)
    except (DatabaseUnavailable, ConnectionFailure):
        items, counts, mine = [], {}, set()  # no user database: tips still make the cards useful
    items += [_tip_out(t, counts.get(t["id"], 0), t["id"] in mine) for t in tips]
    items.sort(key=lambda r: (-r.likes, r.tip, -r.created_at.timestamp()))
    grouped: dict[str, list[ReviewOut]] = {}
    for r in items:
        bucket = grouped.setdefault(r.trail_id, [])
        if len(bucket) < per_trail:
            bucket.append(r)
    return grouped


def feed(viewer_id: str | None, sort: str = "recent", limit: int = 20, skip: int = 0, trail_id: str | None = None) -> list[ReviewOut]:
    """Hikers' written comments across every trail; ratings-only reviews and tips are left out."""
    query = {"comment": {"$ne": None}, **({"trail_id": trail_id} if trail_id else {})}
    cur = get_db().reviews.find(query).sort([("created_at", DESCENDING), ("_id", DESCENDING)])
    if sort != "top":
        return reviews.to_out_many(list(cur.skip(skip).limit(limit)), viewer_id, with_trail_name=True)
    ranked = reviews.to_out_many(list(cur.limit(TOP_WINDOW)), viewer_id, with_trail_name=True)
    ranked.sort(key=lambda r: -r.likes)  # stable: newest first among equal hearts
    return ranked[skip:skip + limit]


def exists(comment_id: str) -> bool:
    """A tip or a review with a written comment: only text can be hearted."""
    if comment_id in TIPS:
        return True
    oid = to_oid(comment_id)
    return oid is not None and get_db().reviews.count_documents({"_id": oid, "comment": {"$ne": None}}, limit=1) == 1


def set_like(user_id: str, comment_id: str, liked: bool) -> tuple[int, bool]:
    (likes.add if liked else likes.remove)(user_id, comment_id)
    return likes.counts([comment_id]).get(comment_id, 0), liked
