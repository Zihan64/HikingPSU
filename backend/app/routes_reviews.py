"""HTTP routes for trail reviews. Reading is public; writing needs an account."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response

from . import auth, reviews, store
from .user_models import ReviewIn, ReviewOut, ReviewSummary, TrailReviews

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
        reviews=[reviews.to_out(d, viewer_id) for d in docs],
    )


@router.put("/trails/{trail_id}/reviews/me", response_model=ReviewOut)
def put_my_review(trail_id: str, body: ReviewIn, user: dict = Depends(auth.current_user)):
    """Create the caller's review of this trail, or replace it if they already left one."""
    _require_trail(trail_id)
    doc = reviews.upsert(user, trail_id, body.model_dump())
    return reviews.to_out(doc, str(user["_id"]))


@router.delete("/trails/{trail_id}/reviews/me", status_code=204)
def delete_my_review(trail_id: str, user_id: str = Depends(auth.current_user_id)):
    if not reviews.delete(user_id, trail_id):
        raise HTTPException(404, "review not found")
    return Response(status_code=204)
