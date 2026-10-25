"""Per-caller limits on /chat so nobody can burn the Anthropic budget.

Signed-in users are keyed by their Auth0 id; anonymous callers by IP. On top of the per-caller
limits, a global daily budget caps live AI calls across everyone; past it, callers get the offline
answer instead of an error. Counts live in memory, so a restart resets them, which is fine at our
scale. Limits can be changed with env vars without a code change.
"""
from __future__ import annotations

import datetime as dt
import logging
import os
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status

_hits: dict[str, deque[float]] = defaultdict(deque)
_live_calls = {"day": "", "count": 0}  # live AI calls today (UTC), across all callers
_lock = threading.Lock()
_logged_source = False
log = logging.getLogger("hikingpsu.ratelimit")


def _limit(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return default


def limits(signed_in: bool) -> tuple[int, int]:
    """(per minute, per day)."""
    if signed_in:
        return _limit("CHAT_LIMIT_USER_PER_MIN", 6), _limit("CHAT_LIMIT_USER_PER_DAY", 60)
    return _limit("CHAT_LIMIT_ANON_PER_MIN", 3), _limit("CHAT_LIMIT_ANON_PER_DAY", 5)


# Render sits behind Cloudflare, which sets these to the visitor's address and overwrites any
# value the visitor sends, so they can't be spoofed and don't change between requests.
_EDGE_HEADERS = ("cf-connecting-ip", "true-client-ip")


def client_ip(request: Request) -> str:
    """The visitor's address, for keying guest limits.

    Prefer Cloudflare's header. X-Forwarded-For is only a fallback: its LAST entry is the one our
    proxy added (anything before it is whatever the client sent), but on Render that last entry can
    be a proxy's own address, which changes between requests and would let guests skip the limit."""
    global _logged_source
    source, ip = None, None
    for name in _EDGE_HEADERS:
        value = request.headers.get(name, "").strip()
        if value:
            source, ip = name, value
            break
    forwarded = request.headers.get("x-forwarded-for")
    if ip is None and forwarded:
        source, ip = "x-forwarded-for (last)", forwarded.split(",")[-1].strip()
    if ip is None:
        source, ip = "socket", request.client.host if request.client else "unknown"
    if not _logged_source:  # once per process: shows in the Render log which header is used
        _logged_source = True
        log.warning("guest rate-limit key from %s; x-forwarded-for has %d entr(ies)",
                    source, len(forwarded.split(",")) if forwarded else 0)
    return ip


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
            msg = ("Daily chat limit reached. Please come back tomorrow." if user_id
                   else f"Guests can ask {per_day} questions a day. Log in to keep planning.")
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, msg)
        if last_minute >= per_min:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "You're sending messages too fast. Please wait a minute.",
                                headers={"Retry-After": "60"})
        q.append(now)


def throttle(request: Request, user_id: str | None, bucket: str, per_min: int, per_day: int) -> None:
    """A separate per-caller limit for one endpoint (e.g. people search), keyed like check()."""
    key = f"{bucket}:" + (f"user:{user_id}" if user_id else f"ip:{client_ip(request)}")
    now = time.time()
    with _lock:
        q = _hits[key]
        while q and now - q[0] > 86400:
            q.popleft()
        if len(q) >= per_day or sum(1 for t in q if now - t < 60) >= per_min:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many searches. Please wait a minute.",
                                headers={"Retry-After": "60"})
        q.append(now)


def check_search(request: Request, user_id: str | None) -> None:
    if user_id:
        throttle(request, user_id, "search", _limit("SEARCH_LIMIT_USER_PER_MIN", 30), _limit("SEARCH_LIMIT_USER_PER_DAY", 600))
    else:
        throttle(request, None, "search", _limit("SEARCH_LIMIT_ANON_PER_MIN", 15), _limit("SEARCH_LIMIT_ANON_PER_DAY", 200))


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
