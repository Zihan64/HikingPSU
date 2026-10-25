"""HTTP routes for public profiles, usernames, people search and follows (rules in social.py)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from . import auth, social, users
from .user_models import ActivityItem, FollowState, HandleIn, PublicProfile, UserCard, UserOut

router = APIRouter(tags=["social"])


def _rule(e: social.SocialError) -> HTTPException:
    return HTTPException(e.status, str(e))


@router.get("/users", response_model=list[UserCard])
def search_users(q: str = "", viewer_id: str | None = Depends(auth.current_user_id_optional)):
    """Hikers whose username starts with q, or with a word of their name starting with q."""
    try:
        return social.search(q, viewer_id)
    except social.SocialError as e:
        raise _rule(e)


@router.get("/users/{handle}", response_model=PublicProfile)
def public_profile(handle: str, viewer_id: str | None = Depends(auth.current_user_id_optional)):
    try:
        return social.profile(social.require(handle), viewer_id)
    except social.SocialError as e:
        raise _rule(e)


@router.get("/users/{handle}/followers", response_model=list[UserCard])
def list_followers(handle: str, skip: int = 0, limit: int = 50, viewer_id: str | None = Depends(auth.current_user_id_optional)):
    try:
        return social.followers(social.require(handle), viewer_id, skip=max(skip, 0), limit=min(max(limit, 1), 100))
    except social.SocialError as e:
        raise _rule(e)


@router.get("/users/{handle}/following", response_model=list[UserCard])
def list_following(handle: str, skip: int = 0, limit: int = 50, viewer_id: str | None = Depends(auth.current_user_id_optional)):
    try:
        return social.following(social.require(handle), viewer_id, skip=max(skip, 0), limit=min(max(limit, 1), 100))
    except social.SocialError as e:
        raise _rule(e)


@router.get("/me/following/activity", response_model=list[ActivityItem])
def following_activity(limit: int = 30, user_id: str = Depends(auth.current_user_id)):
    return social.activity(user_id, limit=min(max(limit, 1), 100))


@router.put("/me/following/{handle}", response_model=FollowState)
def follow(handle: str, user_id: str = Depends(auth.current_user_id)):
    try:
        return social.follow(user_id, social.require(handle))
    except social.SocialError as e:
        raise _rule(e)


@router.delete("/me/following/{handle}", response_model=FollowState)
def unfollow(handle: str, user_id: str = Depends(auth.current_user_id)):
    try:
        return social.unfollow(user_id, social.require(handle))
    except social.SocialError as e:
        raise _rule(e)


@router.put("/me/handle", response_model=UserOut)
def set_handle(body: HandleIn, user: dict = Depends(auth.current_user)):
    try:
        return users.to_out(social.change_handle(user, body.handle))
    except social.SocialError as e:
        raise _rule(e)
