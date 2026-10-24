"""Per-caller limits on /chat so nobody can burn the Anthropic budget.

Signed-in users are keyed by their Auth0 id; anonymous callers by IP. On top of the per-caller
limits, a global daily budget caps live AI calls across everyone; past it, callers get the offline
answer instead of an error. Counts live in memory, so a restart resets them, which is fine at our
scale. Limits can be changed with env vars without a code change.
"""
from __future__ import annotations

import datetime as dt
import os
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status

_hits: dict[str, deque[float]] = defaultdict(deque)
_live_calls = {"day": "", "count": 0}  # live AI calls today (UTC), across all callers
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
    """The address Render's proxy saw. It appends that to X-Forwarded-For, so only the LAST entry is
    trustworthy: everything before it is whatever the client sent, and trusting it lets one caller
    pose as a new IP on every request."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[-1].strip()
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


def take_live_call() -> bool:
    """Count one live AI call against today's global budget. False once it is spent."""
    today = dt.datetime.now(dt.timezone.utc).date().isoformat()
    with _lock:
        if _live_calls["day"] != today:
            _live_calls.update(day=today, count=0)
        if _live_calls["count"] >= _limit("CHAT_LIMIT_GLOBAL_PER_DAY", 1000):
            return False
        _live_calls["count"] += 1
        return True


def reset() -> None:
    """Tests only."""
    with _lock:
        _hits.clear()
        _live_calls.update(day="", count=0)
