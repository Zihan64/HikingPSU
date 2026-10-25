"""Which LLM the app talks to. LLM_PROVIDER=gemini (default) or claude; both paths share the same tools and rules.

Gemini reads GEMINI_API_KEY (or GOOGLE_API_KEY); Claude reads ANTHROPIC_API_KEY. Without a working key every
AI feature falls back to its offline version, so switching never takes the app down.
"""
from __future__ import annotations

import os

from google import genai
from google.genai import types

PROVIDERS = ("gemini", "claude")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
# HIKINGPSU_MODEL is preferred; TRAILHEAD_MODEL kept so existing .env files still work.
CLAUDE_MODEL = os.getenv("HIKINGPSU_MODEL") or os.getenv("TRAILHEAD_MODEL", "claude-sonnet-5-5")

# The SDK's defaults are no timeout and 5 retries with backoff on 429/5xx, so one quota error or slow
# reply left the chat spinning for minutes. Fail fast instead; callers then answer offline.
GEMINI_TIMEOUT_S = float(os.getenv("GEMINI_TIMEOUT_S", "20"))  # per API call
CHAT_DEADLINE_S = float(os.getenv("CHAT_DEADLINE_S", "40"))    # whole tool-use loop
# How long Gemini thinks before answering: minimal | low | medium | high, or "" for the model's default
# (medium on 3.8 Flash). Low keeps chat responsive; 3.8 Flash rejects minimal (Flash-Lite allows it).
GEMINI_THINKING_LEVEL = os.getenv("GEMINI_THINKING_LEVEL", "low").strip().lower()


def provider() -> str:
    """Read per call so a changed environment (or a test) takes effect without a restart of this module."""
    p = os.getenv("LLM_PROVIDER", "gemini").strip().lower()
    return p if p in PROVIDERS else "gemini"


def model() -> str:
    return GEMINI_MODEL if provider() == "gemini" else CLAUDE_MODEL


def gemini_thinking() -> types.ThinkingConfig | None:
    return types.ThinkingConfig(thinking_level=GEMINI_THINKING_LEVEL.upper()) if GEMINI_THINKING_LEVEL else None


def gemini_client() -> genai.Client:
    """Reads GEMINI_API_KEY / GOOGLE_API_KEY. One attempt per call, bounded by GEMINI_TIMEOUT_S."""
    return genai.Client(http_options=types.HttpOptions(
        timeout=int(GEMINI_TIMEOUT_S * 1000),  # milliseconds
        retry_options=types.HttpRetryOptions(attempts=1),
    ))
