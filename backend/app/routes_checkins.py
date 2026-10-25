"""HTTP routes for trailhead check-ins and badges (see checkins.py and badges.py for the rules)."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response

from . import auth, badges, checkins, hikes, reviews
from .user_models import BadgeBoard, CheckinOut, CheckinStart, FinishResult, ReviewIn

router = APIRouter(prefix="/me", tags=["checkins"])


def _rule(e: checkins.CheckinError) -> HTTPException:
    return HTTPException(e.status, str(e))


@router.post("/checkins", response_model=CheckinOut, status_code=201)
def start_checkin(body: CheckinStart, user_id: str = Depends(auth.current_user_id)):
    """Check in at a trail entrance. The coordinates are used for this check only and never stored."""
    try:
        return checkins.to_out(checkins.start(user_id, body.trail_id, body.lat, body.lon, body.accuracy_m))
    except checkins.CheckinError as e:
        raise _rule(e)


@router.get("/checkins/active", response_model=Optional[CheckinOut])
def active_checkin(user_id: str = Depends(auth.current_user_id)):
    doc = checkins.get_active(user_id)
    return checkins.to_out(doc) if doc else None


@router.post("/checkins/{checkin_id}/finish", response_model=FinishResult)
def finish_checkin(checkin_id: str, body: ReviewIn, user: dict = Depends(auth.current_user)):
    """Finish a hike with a rating: writes the review and a hike-log entry, then awards badges."""
    uid = str(user["_id"])
    try:
        doc, resume = checkins.prepare_finish(uid, checkin_id)
        review = reviews.upsert(user, doc["trail_id"], body.model_dump())  # before completing: an upsert is safe to repeat
        done = doc if resume else checkins.mark_completed(doc)
    except checkins.CheckinError as e:
        raise _rule(e)
    except KeyError:  # the trail left the data after check-in
        raise HTTPException(404, "trail not found")
    # Steps after completing are repeatable: a retry after a crash here resumes them (prepare_finish).
    hike = hikes.for_checkin(uid, str(doc["_id"]))
    if hike is None:
        minutes = (checkins.utc(done["completed_at"]) - checkins.utc(done["started_at"])).total_seconds() / 60
        hike = hikes.add(
            uid, doc["trail_id"], completed_on=checkins.utc(done["completed_at"]).astimezone(checkins.LOCAL_TZ).date(),
            duration_min=max(1, min(1440, round(minutes))), rating=body.enjoyment, felt_difficulty=body.difficulty,
            notes=(body.comment or "").strip() or None, checkin_id=str(doc["_id"]),
        )
    checkins.link(done, review_id=str(review["_id"]), hike_id=str(hike["_id"]))
    new = badges.award(uid)
    return FinishResult(checkin=checkins.to_out(done), review=reviews.to_out(review, uid, author_handle=user.get("handle")),
                        new_badges=[badges.to_out(b) for b in new])


@router.delete("/checkins/{checkin_id}", status_code=204)
def cancel_checkin(checkin_id: str, user_id: str = Depends(auth.current_user_id)):
    try:
        checkins.cancel(user_id, checkin_id)
    except checkins.CheckinError as e:
        raise _rule(e)
    return Response(status_code=204)


@router.get("/badges", response_model=BadgeBoard)
def my_badges(user_id: str = Depends(auth.current_user_id)):
    return badges.board(user_id)
