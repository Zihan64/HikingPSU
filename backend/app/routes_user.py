"""HTTP routes for everything stored per user. Sign-up and login happen on Auth0 (see auth.py)."""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Response

from . import auth, chats, hikes, reviews, store, users
from .user_models import (
    ChatSessionOut,
    ChatSessionSummary,
    HikeCreate,
    HikeOut,
    HikeStats,
    HikeUpdate,
    MePatch,
    Registration,
    UserOut,
)

me_router = APIRouter(prefix="/me", tags=["me"])



# ---------- profile & preferences ----------

@me_router.get("", response_model=UserOut)
def get_me(user: dict = Depends(auth.current_user)):
    return users.to_out(user)


@me_router.patch("", response_model=UserOut)
def patch_me(body: MePatch, user: dict = Depends(auth.current_user)):
    changes = body.model_dump(exclude_unset=True)
    return users.to_out(users.patch(str(user["_id"]), changes) or user)


@me_router.put("/registration", response_model=UserOut)
def register(body: Registration, user: dict = Depends(auth.current_user)):
    """The sign-up form shown after a new account's first login (also used to edit it later)."""
    return users.to_out(users.register(user, body) or user)


@me_router.delete("", status_code=204)
def delete_me(user: dict = Depends(auth.current_user)):
    uid = str(user["_id"])
    hikes.delete_all(uid)
    chats.delete_all(uid)
    reviews.delete_all(uid)
    users.delete(uid)
    return Response(status_code=204)


# ---------- saved trails ----------

@me_router.put("/saved/{trail_id}", response_model=UserOut)
def save_trail(trail_id: str, user: dict = Depends(auth.current_user)):
    if store.get(trail_id) is None:
        raise HTTPException(404, "trail not found")
    return users.to_out(users.set_saved(str(user["_id"]), trail_id, True) or user)


@me_router.delete("/saved/{trail_id}", response_model=UserOut)
def unsave_trail(trail_id: str, user: dict = Depends(auth.current_user)):
    return users.to_out(users.set_saved(str(user["_id"]), trail_id, False) or user)


# ---------- hike log ----------

@me_router.post("/hikes", response_model=HikeOut, status_code=201)
def add_hike(body: HikeCreate, user_id: str = Depends(auth.current_user_id)):
    if body.completed_on > dt.date.today() + dt.timedelta(days=1):  # a day of slack for time zones
        raise HTTPException(422, "completed_on cannot be in the future")
    try:
        doc = hikes.add(user_id, **body.model_dump())
    except KeyError:
        raise HTTPException(404, "trail not found")
    return hikes.to_out(doc)


@me_router.get("/hikes", response_model=list[HikeOut])
def list_hikes(limit: int = 100, skip: int = 0, user_id: str = Depends(auth.current_user_id)):
    return [hikes.to_out(d) for d in hikes.list_for(user_id, limit=min(max(limit, 1), 200), skip=max(skip, 0))]


@me_router.get("/hikes/stats", response_model=HikeStats)
def hike_stats(user_id: str = Depends(auth.current_user_id)):
    return hikes.stats(user_id)


@me_router.patch("/hikes/{hike_id}", response_model=HikeOut)
def update_hike(hike_id: str, body: HikeUpdate, user_id: str = Depends(auth.current_user_id)):
    changes = body.model_dump(exclude_unset=True)
    if changes.get("completed_on", ...) is None:
        raise HTTPException(422, "completed_on cannot be null")
    doc = hikes.update(user_id, hike_id, changes)
    if doc is None:
        raise HTTPException(404, "hike not found")
    return hikes.to_out(doc)


@me_router.delete("/hikes/{hike_id}", status_code=204)
def delete_hike(hike_id: str, user_id: str = Depends(auth.current_user_id)):
    if not hikes.delete(user_id, hike_id):
        raise HTTPException(404, "hike not found")
    return Response(status_code=204)


# ---------- chat history ----------

@me_router.get("/chats", response_model=list[ChatSessionSummary])
def list_chats(limit: int = 50, skip: int = 0, user_id: str = Depends(auth.current_user_id)):
    return chats.list_for(user_id, limit=min(max(limit, 1), 100), skip=max(skip, 0))


@me_router.get("/chats/{session_id}", response_model=ChatSessionOut)
def get_chat(session_id: str, user_id: str = Depends(auth.current_user_id)):
    session = chats.get(user_id, session_id)
    if session is None:
        raise HTTPException(404, "chat not found")
    return session


@me_router.delete("/chats/{session_id}", status_code=204)
def delete_chat(session_id: str, user_id: str = Depends(auth.current_user_id)):
    if not chats.delete(user_id, session_id):
        raise HTTPException(404, "chat not found")
    return Response(status_code=204)
