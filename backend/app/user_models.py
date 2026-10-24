"""Pydantic models for accounts, profiles, preferences, hike logs and saved chats."""
from __future__ import annotations

import datetime as dt
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from .models import TrailWithDifficulty

Gender = Literal["male", "female", "custom"]
Transport = Literal["car", "bus", "bike_walk"]  # car / bus or public transit / bike or walk

PHONE_PATTERN = r"^\+?[0-9 ().-]{7,20}$"
EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


class Profile(BaseModel):
    display_name: Optional[str] = Field(None, max_length=60)
    home_area: Optional[str] = Field(None, max_length=80)
    has_car: Optional[bool] = None
    age: Optional[int] = Field(None, ge=10, le=110)
    fitness: Optional[int] = Field(None, ge=1, le=5, description="1 (new) … 5 (strong)")
    group_type: Optional[Literal["solo", "friends", "family", "club"]] = None
    bio: Optional[str] = Field(None, max_length=500)
    # Filled in by the sign-up form (Registration). Private: never shown on reviews or sent to the model.
    full_name: Optional[str] = Field(None, max_length=60)
    gender: Optional[Gender] = None
    gender_custom: Optional[str] = Field(None, max_length=40)
    birthday: Optional[dt.date] = None
    phone: Optional[str] = Field(None, pattern=PHONE_PATTERN)
    # Also from the sign-up form; the model sees these.
    hiking_experience: Optional[int] = Field(None, ge=0, le=5, description="0 (never hiked) … 5 (expert)")
    transport: Optional[Transport] = Field(None, description="How they said they usually get to a hike")


TransitMode = Literal["walk", "bus", "bike", "car"]
Season = Literal["spring", "summer", "fall", "winter"]


class Preferences(BaseModel):
    preferred_features: list[str] = Field(default_factory=list, max_length=20)
    avoid: list[str] = Field(default_factory=list, max_length=20, description="Features to rank lower, e.g. mud, crowds")
    transit_modes: list[TransitMode] = Field(default_factory=list, max_length=4)
    preferred_seasons: list[Season] = Field(default_factory=list, max_length=4)
    prefers_loop: Optional[bool] = Field(None, description="True: loops, False: out-and-back, null: no preference")
    max_level: Optional[int] = Field(None, ge=1, le=5)
    max_time_min: Optional[int] = Field(None, ge=1, le=1440)
    max_drive_min: Optional[int] = Field(None, ge=0, le=600)
    notes: Optional[str] = Field(None, max_length=500)


class UserOut(BaseModel):
    id: str  # Auth0 user id
    email: Optional[str] = None
    profile: Profile
    preferences: Preferences
    saved_trail_ids: list[str]
    created_at: dt.datetime
    registered: bool = False  # False until the sign-up form is submitted


class Registration(BaseModel):
    """The form shown once, right after a new account's first login."""

    gender: Gender
    gender_custom: Optional[str] = Field(None, max_length=40)
    full_name: str = Field(min_length=1, max_length=60)
    birthday: dt.date
    hiking_experience: int = Field(ge=0, le=5, description="0 (never hiked) … 5 (expert)")
    transport: Transport
    # optional
    preferences: Optional[str] = Field(None, max_length=500)
    email: Optional[str] = Field(None, max_length=254, pattern=EMAIL_PATTERN)
    phone: Optional[str] = Field(None, pattern=PHONE_PATTERN)

    @field_validator("gender_custom", "full_name", "preferences", "email", "phone", mode="before")
    @classmethod
    def _blank_is_none(cls, v):
        if isinstance(v, str):
            v = v.strip()
            return v or None
        return v

    @field_validator("birthday")
    @classmethod
    def _plausible_birthday(cls, v: dt.date) -> dt.date:
        if v > dt.date.today():
            raise ValueError("birthday cannot be in the future")
        if v.year < 1900:
            raise ValueError("birthday must be after 1900")
        return v

    @model_validator(mode="after")
    def _custom_gender_needs_text(self):
        if self.gender == "custom" and not self.gender_custom:
            raise ValueError("describe your gender, or pick male or female")
        if self.gender != "custom":
            self.gender_custom = None
        return self


class MePatch(BaseModel):
    """Only fields the client actually sends are changed; an explicit null clears a field."""

    profile: Optional[Profile] = None
    preferences: Optional[Preferences] = None


class HikeCreate(BaseModel):
    trail_id: str
    completed_on: dt.date
    duration_min: Optional[int] = Field(None, ge=1, le=1440)
    rating: Optional[int] = Field(None, ge=1, le=5)
    felt_difficulty: Optional[int] = Field(None, ge=1, le=5)
    notes: Optional[str] = Field(None, max_length=1000)


class HikeUpdate(BaseModel):
    completed_on: Optional[dt.date] = None
    duration_min: Optional[int] = Field(None, ge=1, le=1440)
    rating: Optional[int] = Field(None, ge=1, le=5)
    felt_difficulty: Optional[int] = Field(None, ge=1, le=5)
    notes: Optional[str] = Field(None, max_length=1000)


class HikeOut(BaseModel):
    id: str
    trail_id: str
    trail_name: str
    completed_on: dt.date
    duration_min: Optional[int] = None
    rating: Optional[int] = None
    felt_difficulty: Optional[int] = None
    notes: Optional[str] = None
    created_at: dt.datetime


class HikeStats(BaseModel):
    total_hikes: int
    unique_trails: int
    total_distance_mi: float
    total_elevation_gain_ft: int


class Count(BaseModel):
    key: str
    count: int


class Insights(BaseModel):
    """Taste signals derived from the hike log. Intended as input to the recommender."""

    profile_completeness: int = Field(description="0-100, share of profile/preference fields filled in")
    stats: HikeStats
    level_counts: dict[int, int] = Field(description="official difficulty level -> hikes completed")
    avg_rating: Optional[float] = None
    felt_vs_official: Optional[float] = Field(None, description="mean(felt - official level); >0 means you find trails harder than rated")
    comfortable_level: Optional[int] = Field(None, description="highest level hiked and rated >= 4, else highest hiked")
    top_features: list[Count]
    top_areas: list[Count]
    access_counts: dict[str, int] = Field(description="how the hiked trails can be reached: car_free / drive_only")
    loop_share: Optional[float] = None
    season_counts: dict[str, int]
    feature_affinity: dict[str, float] = Field(description="feature -> score in [-1, 1] from ratings (rating 3 = neutral)")
    recent_hikes: list[HikeOut]


class RecommendedTrail(BaseModel):
    trail_id: str
    score: float
    breakdown: dict[str, float] = Field(description="score term -> contribution; the score is their sum")
    reasons: list[str]
    reachable_by: list[str]
    personal_time_min: int = Field(description="estimated hiking time at this user's pace")
    trail: TrailWithDifficulty


class Recommendations(BaseModel):
    comfort_level: int = Field(ge=1, le=5)
    felt_drift: float = Field(description="mean felt-vs-rated over recent hikes: -1 easier ... +1 harder")
    pace_multiplier: float
    trails: list[RecommendedTrail]


class PreferenceText(BaseModel):
    text: str = Field(min_length=1, max_length=500)


class ParsedPreferences(BaseModel):
    """A suggestion for the user to confirm; nothing is saved until they PATCH /me."""

    max_level: Optional[int] = Field(None, ge=1, le=5)
    preferred_features: list[str] = Field(default_factory=list, max_length=20)
    avoid: list[str] = Field(default_factory=list, max_length=20)
    transit_modes: list[TransitMode] = Field(default_factory=list, max_length=4)
    max_time_min: Optional[int] = Field(None, ge=1, le=1440)
    prefers_loop: Optional[bool] = None
    source: Literal["ai", "offline"]


class ReviewIn(BaseModel):
    """What a hiker rates after finishing a trail; each score is out of 5."""

    accuracy: int = Field(ge=1, le=5, description="How accurate our trail info was")
    difficulty: int = Field(ge=1, le=5, description="How hard the trail actually felt")
    enjoyment: int = Field(ge=1, le=5, description="Overall enjoyment / views")
    comment: Optional[str] = Field(None, max_length=1000)


class ReviewOut(BaseModel):
    id: str
    trail_id: str
    trail_name: Optional[str] = Field(None, description="Set in the community feed, which mixes trails")
    author: str
    accuracy: Optional[int] = None  # starter tips carry no scores
    difficulty: Optional[int] = None
    enjoyment: Optional[int] = None
    comment: Optional[str] = None
    created_at: dt.datetime
    updated_at: dt.datetime
    mine: bool = False
    likes: int = 0
    liked: bool = Field(False, description="The viewer has hearted this comment")
    tip: bool = Field(False, description="A HikingPSU starter tip rather than a hiker's review")


class LikeState(BaseModel):
    likes: int
    liked: bool


class ReviewSummary(BaseModel):
    count: int = 0
    accuracy: Optional[float] = None
    difficulty: Optional[float] = None
    enjoyment: Optional[float] = None


class TrailReviews(BaseModel):
    summary: ReviewSummary
    reviews: list[ReviewOut]


class StoredMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str
    ts: dt.datetime
    recommended_ids: list[str] = []


class ChatSessionSummary(BaseModel):
    id: str
    title: str
    message_count: int
    created_at: dt.datetime
    updated_at: dt.datetime


class ChatSessionOut(ChatSessionSummary):
    messages: list[StoredMessage]
