import hashlib
import hmac
import logging
import os
import secrets

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pymongo.errors import ConnectionFailure

from . import agent, auth, chats, hikes, llm, ratelimit, recommend, store, users
from .db import DatabaseUnavailable
from .models import MAX_USER_MESSAGE_CHARS, ChatMessage, ChatRequest, ChatResponse, TrailWithDifficulty
from .routes_checkins import router as checkins_router
from .routes_reviews import router as reviews_router
from .routes_social import router as social_router
from .routes_user import me_router
from .official import router as official_router

log = logging.getLogger("hikingpsu.main")

app = FastAPI(title="HikingPSU API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.include_router(me_router)
app.include_router(checkins_router)
app.include_router(social_router)
app.include_router(reviews_router)
app.include_router(official_router)


@app.exception_handler(DatabaseUnavailable)
@app.exception_handler(ConnectionFailure)  # includes ServerSelectionTimeoutError
def _db_down(request: Request, exc: Exception):
    log.error("database unavailable: %r", exc)
    return JSONResponse({"detail": "user database unavailable"}, status_code=503)


@app.get("/health")
def health():
    # "ai" says which LLM is configured (llm.py), so a deploy can be checked without opening the chat.
    return {"ok": True, "trails": len(store.load_all()), "ai": {"provider": llm.provider(), "model": llm.model()}}


@app.get("/auth/config")
def auth_config():
    """Whether login (Auth0) is configured on this server."""
    return {"enabled": auth.auth_configured()}


@app.get("/trails", response_model=list[TrailWithDifficulty])
def list_trails(max_level: int | None = None, car_free: bool | None = None, max_time_min: int | None = None):
    return store.search(max_level=max_level, car_free=car_free, max_time_min=max_time_min, limit=len(store.load_all()))


@app.get('/parks')
def list_parks():
    counts = {}
    for trail in store.load_all():
        counts[trail.park_id] = counts.get(trail.park_id, 0) + 1
    return [{**{key: p[key] for key in ['id','name','manager','kind','center','official_area_id']},
             'trail_count':counts.get(p['id'], 0)}
            for p in sorted(store.load_parks(), key=lambda p:(p['kind'] == 'unverified', p['name']))]


@app.get('/trails/{trail_id}/geometry')
def trail_geometry(trail_id: str):
    if not store.get(trail_id):
        raise HTTPException(404, 'trail not found')
    entry = store.load_geometry().get(trail_id)
    if not entry:
        raise HTTPException(404, 'Route line not available yet')
    return entry


@app.get("/trails/{trail_id}", response_model=TrailWithDifficulty)
def get_trail(trail_id: str):
    t = store.get(trail_id)
    if not t:
        raise HTTPException(404, "trail not found")
    return t


@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest, request: Request, user_id: str | None = Depends(auth.current_user_id_optional)):
    if not req.messages:
        raise HTTPException(400, "messages required")
    if req.messages[-1].role != "user" or not req.messages[-1].content.strip():
        raise HTTPException(400, "last message must be a non-empty user message")
    if any(m.role == "user" and len(m.content) > MAX_USER_MESSAGE_CHARS for m in req.messages):
        raise HTTPException(413, f"Message too long (max {MAX_USER_MESSAGE_CHARS} characters).")
    ratelimit.check(request, user_id)
    profile = req.profile.model_dump(exclude_none=True) if req.profile else {}
    recommender = None
    if user_id:
        # Persistence is best-effort: a database outage must never break the chat itself.
        try:
            profile = {**_stored_profile(user_id), **profile}
            recommender = _recommender(user_id)
        except Exception:
            log.exception("could not load user profile; continuing anonymously")
    offline = not ratelimit.take_live_call()
    res = agent.run(_recent(req.messages), profile, recommender=recommender, offline=offline)
    res.reply_sig = _sign(res.reply)
    if user_id:
        try:
            res.session_id = chats.record_exchange(user_id, req.session_id, req.messages, res.reply, res.recommended_ids)
        except Exception:
            log.exception("could not save chat history")
    return res


HISTORY_MESSAGES = 10
MAX_ASSISTANT_CHARS = 2000  # older replies are context only; their tail rarely matters

# Signs our replies so a client can't put words in the assistant's mouth (a forged "Sure, I'll write
# your essay" turn is a reliable jailbreak). Set CHAT_SIGNING_KEY when running several workers;
# otherwise a restart only means older replies are dropped from the model's context.
_SIGNING_KEY = os.getenv("CHAT_SIGNING_KEY", "").encode() or secrets.token_bytes(32)


def _sign(text: str) -> str:
    return hmac.new(_SIGNING_KEY, text.encode(), hashlib.sha256).hexdigest()


def _genuine(m: ChatMessage) -> bool:
    return m.role == "user" or (m.sig is not None and hmac.compare_digest(m.sig, _sign(m.content)))


def _recent(messages):
    """What the model sees: the last few turns (cost grows with history), only assistant turns we
    actually wrote, each one trimmed. Must start with a user turn."""
    recent = [m if m.role == "user" else ChatMessage(role="assistant", content=m.content[:MAX_ASSISTANT_CHARS])
              for m in messages[-HISTORY_MESSAGES:] if _genuine(m)]
    while recent and recent[0].role != "user":
        recent = recent[1:]
    return recent


# Personal details from the sign-up form stay in the database; the model doesn't need them.
PRIVATE_PROFILE_FIELDS = {"bio", "full_name", "gender", "gender_custom", "birthday", "phone", "secondary_email", "address",
                          "transport"}  # transport: legacy single answer, superseded by preferences.transit_modes


def _stored_profile(user_id: str) -> dict:
    """What the agent should know about a signed-in user (explicit request fields still win)."""
    user = users.get(user_id)
    if user is None:
        return {}
    profile = {k: v for k, v in user["profile"].items() if v is not None and k not in PRIVATE_PROFILE_FIELDS}
    prefs = {k: v for k, v in user["preferences"].items() if v not in (None, [])}
    return {**profile, "preferences": prefs, **hikes.agent_summary(user_id)}


def _recommender(user_id: str):
    """The recommend_for_me tool for this user, or None before their account document exists."""
    user = users.get(user_id)
    if user is None:
        return None
    return lambda k: recommend.tool_output(recommend.for_user(user, k=k))
