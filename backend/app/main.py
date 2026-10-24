import logging

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pymongo.errors import ConnectionFailure

from . import agent, auth, chats, hikes, store, users
from .db import DatabaseUnavailable
from .models import ChatRequest, ChatResponse, TrailWithDifficulty
<<<<<<< HEAD
from .routes_reviews import router as reviews_router
from .routes_user import auth_router, me_router
=======
from .routes_user import me_router
>>>>>>> 977baf91bd1fd85331ca8dd01797821748ea8323

log = logging.getLogger("hikingpsu.main")

app = FastAPI(title="HikingPSU API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.include_router(me_router)
app.include_router(reviews_router)


@app.exception_handler(DatabaseUnavailable)
@app.exception_handler(ConnectionFailure)  # includes ServerSelectionTimeoutError
def _db_down(request: Request, exc: Exception):
    log.error("database unavailable: %r", exc)
    return JSONResponse({"detail": "user database unavailable"}, status_code=503)


@app.get("/health")
def health():
    return {"ok": True, "trails": len(store.load_all())}


@app.get("/auth/config")
def auth_config():
    """Whether login (Auth0) is configured on this server."""
    return {"enabled": auth.auth_configured()}


@app.get("/trails", response_model=list[TrailWithDifficulty])
def list_trails(max_level: int | None = None, car_free: bool | None = None, max_time_min: int | None = None):
    return store.search(max_level=max_level, car_free=car_free, max_time_min=max_time_min, limit=100)


@app.get("/trails/{trail_id}", response_model=TrailWithDifficulty)
def get_trail(trail_id: str):
    t = store.get(trail_id)
    if not t:
        raise HTTPException(404, "trail not found")
    return t


@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest, user_id: str | None = Depends(auth.current_user_id_optional)):
    if not req.messages:
        raise HTTPException(400, "messages required")
    profile = req.profile
    if user_id:
        # Persistence is best-effort: a database outage must never break the chat itself.
        try:
            profile = {**_stored_profile(user_id), **(req.profile or {})}
        except Exception:
            log.exception("could not load user profile; continuing anonymously")
    res = agent.run(req.messages, profile)
    if user_id:
        try:
            res.session_id = chats.record_exchange(user_id, req.session_id, req.messages, res.reply, res.recommended_ids)
        except Exception:
            log.exception("could not save chat history")
    return res


def _stored_profile(user_id: str) -> dict:
    """What the agent should know about a signed-in user (explicit request fields still win)."""
    user = users.get(user_id)
    if user is None:
        return {}
    profile = {k: v for k, v in user["profile"].items() if v is not None and k != "bio"}
    prefs = {k: v for k, v in user["preferences"].items() if v not in (None, [])}
    return {**profile, "preferences": prefs, **hikes.agent_summary(user_id)}
