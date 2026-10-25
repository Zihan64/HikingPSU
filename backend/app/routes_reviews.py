"""HTTP routes for trail reviews. Reading is public; writing needs an account."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response

from . import auth, community, reviews, store
from .user_models import LikeState, ReviewIn, ReviewOut, ReviewSummary, TrailReviews

router = APIRouter(tags=["reviews"])


def _require_trail(trail_id: str) -> None:
    if store.get(trail_id) is None:
        raise HTTPException(404, "trail not found")


@router.get("/reviews/summary", response_model=dict[str, ReviewSummary])
def all_summaries():
    """Average scores for every reviewed trail, keyed by trail id (for trail cards and the map)."""
    return reviews.summarize()


@router.get("/trails/{trail_id}/reviews", response_model=TrailReviews)
def trail_reviews(
    trail_id: str, limit: int = 100, skip: int = 0, viewer_id: str | None = Depends(auth.current_user_id_optional)
):
    _require_trail(trail_id)
    docs = reviews.list_for_trail(trail_id, limit=min(max(limit, 1), 200), skip=max(skip, 0))
    return TrailReviews(
        summary=reviews.summarize(trail_id).get(trail_id, ReviewSummary()),
        reviews=reviews.to_out_many(docs, viewer_id),
    )


@router.get("/reviews/feed", response_model=list[ReviewOut])
def community_feed(
    sort: Literal["recent", "top"] = "recent", limit: int = 20, skip: int = 0, trail_id: str | None = None,
    viewer_id: str | None = Depends(auth.current_user_id_optional),
):
    """Hikers' reviews across all trails for the Community page, newest or most hearted first."""
    if trail_id:
        _require_trail(trail_id)
    return community.feed(viewer_id, sort, limit=min(max(limit, 1), 50), skip=max(skip, 0), trail_id=trail_id)


@router.get("/reviews/highlights", response_model=dict[str, list[ReviewOut]])
def comment_highlights(per_trail: int = 2, viewer_id: str | None = Depends(auth.current_user_id_optional)):
    """The top comments for every trail, keyed by trail id (shown on trail cards)."""
    return community.highlights(viewer_id, per_trail=min(max(per_trail, 1), 5))


@router.put("/reviews/{comment_id}/like", response_model=LikeState)
def like_comment(comment_id: str, user_id: str = Depends(auth.current_user_id)):
    return _set_like(user_id, comment_id, True)


@router.delete("/reviews/{comment_id}/like", response_model=LikeState)
def unlike_comment(comment_id: str, user_id: str = Depends(auth.current_user_id)):
    return _set_like(user_id, comment_id, False)


def _set_like(user_id: str, comment_id: str, liked: bool) -> LikeState:
    if not community.exists(comment_id):
        raise HTTPException(404, "comment not found")
    likes, liked = community.set_like(user_id, comment_id, liked)
    return LikeState(likes=likes, liked=liked)


@router.put("/trails/{trail_id}/reviews/me", response_model=ReviewOut)
def put_my_review(trail_id: str, body: ReviewIn, user: dict = Depends(auth.current_user)):
    """Create the caller's review of this trail, or replace it if they already left one."""
    _require_trail(trail_id)
    doc = reviews.upsert(user, trail_id, body.model_dump())
    return reviews.to_out(doc, str(user["_id"]), author_handle=user.get("handle"))


@router.delete("/trails/{trail_id}/reviews/me", status_code=204)
def delete_my_review(trail_id: str, user_id: str = Depends(auth.current_user_id)):
    if not reviews.delete(user_id, trail_id):
        raise HTTPException(404, "review not found")
    return Response(status_code=204)
