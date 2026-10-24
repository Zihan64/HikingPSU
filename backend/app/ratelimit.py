"""Per-caller limits on /chat so nobody can burn the Anthropic budget.

Signed-in users are keyed by their Auth0 id; anonymous callers by IP (Render puts the
real client IP first in X-Forwarded-For). Counts live in memory, so a restart resets them,
which is fine at our scale. Limits can be changed with env vars without a code change.
"""
from __future__ import annotations

import os
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status

_hits: dict[str, deque[float]] = defaultdict(deque)
_lock = threading.Lock()


def _limit(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return default


def limits(signed_in: bool) -> tuple[int, int]:
    """(per minute, per day)."""
    if signed_in:
        return _limit("CHAT_LIMIT_USER_PER_MIN", 6), _limit("CHAT_LIMIT_USER_PER_DAY", 60)
    return _limit("CHAT_LIMIT_ANON_PER_MIN", 3), _limit("CHAT_LIMIT_ANON_PER_DAY", 20)


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def check(request: Request, user_id: str | None) -> None:
    key = f"user:{user_id}" if user_id else f"ip:{client_ip(request)}"
    per_min, per_day = limits(signed_in=bool(user_id))
    now = time.time()
    with _lock:
        q = _hits[key]
        while q and now - q[0] > 86400:
            q.popleft()
        last_minute = sum(1 for t in q if now - t < 60)
        if len(q) >= per_day:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Daily chat limit reached. Please come back tomorrow.")
        if last_minute >= per_min:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "You're sending messages too fast. Please wait a minute.",
                                headers={"Retry-After": "60"})
        q.append(now)


def reset() -> None:
    """Tests only."""
    with _lock:
        _hits.clear()
