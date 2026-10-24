"""Claude tool-use loop. The model plans, calls tools, and explains. It cannot invent trails."""
from __future__ import annotations

import datetime as dt
import json
import logging
import os
import re

import anthropic

from . import store
from .models import ChatMessage, ChatResponse
from .tools import REGISTRY, TOOLS

log = logging.getLogger("hikingpsu.agent")

# HIKINGPSU_MODEL is preferred; TRAILHEAD_MODEL kept so existing .env files still work.
MODEL = os.getenv("HIKINGPSU_MODEL") or os.getenv("TRAILHEAD_MODEL", "claude-sonnet-4-5")
MAX_TURNS = 6

SYSTEM = """You are HikingPSU, a hiking guide for the Penn State / State College community.

Rules:
- ALWAYS call search_trails before recommending anything. Recommend only trail ids it returned.
- If search_trails returns 0 trails, call it again with fewer filters (drop features first, then loosen max_level or max_time_min). If the database truly has nothing, say so; never name a trail that was not returned.
- Use the difficulty_level and difficulty_reasons from the tool; never make up your own difficulty.
- If the user has no car, set car_free=true. Say how to get there (bus, walk, bike).
- Convert the user's time budget into max_time_min, leaving ~20% buffer.
- Call hunting_season_note when the date is Oct–Jan and a trail has hunting_zone=true; remind about blaze orange.
- Call get_weather when the user mentions a day, sunset, or rain.
- If the profile lists completed_trail_ids, prefer trails not in that list unless the user asks to repeat one. Honor profile preferences (features, max level, time, drive) as defaults the user's message can override.
- Recommend 2–3 trails. For each: one line on why it fits, the difficulty level with its reasons, estimated time, and how to get there.
- Be concise and warm. No markdown headers. Use short bullets.
- Finish with a line exactly like: RECOMMENDED: id1, id2, id3

Today is {today}. User profile: {profile}.
"""


def _client() -> anthropic.Anthropic:
    return anthropic.Anthropic()  # reads ANTHROPIC_API_KEY


def run(messages: list[ChatMessage], profile: dict | None = None) -> ChatResponse:
    if os.getenv("DEMO_MODE") == "1":
        return _demo(messages, profile)

    try:
        return _run_live(messages, profile)
    except Exception:
        # Missing/invalid API key, network or model error: never 500 in front of judges.
        log.exception("live agent failed; falling back to offline demo mode")
        res = _demo(messages, profile)
        res.reply = "(Live AI is unavailable right now, showing a simple offline match.)\n" + res.reply
        return res


def _call_tool(name: str, args: dict) -> tuple[dict, bool]:
    """Run one tool. Returns (output, is_error). Errors go back to the model, not to the user."""
    fn = REGISTRY.get(name)
    if fn is None:
        return {"error": f"unknown tool '{name}'"}, True
    try:
        return fn(**(args or {})), False
    except Exception as e:
        log.warning("tool %s failed: %r (input=%s)", name, e, args)
        return {"error": f"{e.__class__.__name__}: {e}"}, True


def _run_live(messages: list[ChatMessage], profile: dict | None) -> ChatResponse:
    client = _client()
    system = SYSTEM.format(today=dt.date.today().isoformat(), profile=json.dumps(profile or {}))
    convo = [{"role": m.role, "content": m.content} for m in messages]
    tool_log: list[dict] = []

    for _ in range(MAX_TURNS):
        resp = client.messages.create(
            model=MODEL, max_tokens=1200, system=system, tools=TOOLS, messages=convo
        )
        if resp.stop_reason != "tool_use":
            text = "".join(b.text for b in resp.content if b.type == "text")
            return _finalize(text, tool_log)

        convo.append({"role": "assistant", "content": resp.content})
        results = []
        for block in resp.content:
            if block.type != "tool_use":
                continue
            out, is_error = _call_tool(block.name, block.input)
            tool_log.append({"tool": block.name, "input": block.input, "output": out})
            result = {"type": "tool_result", "tool_use_id": block.id, "content": json.dumps(out)}
            if is_error:
                result["is_error"] = True
            results.append(result)
        convo.append({"role": "user", "content": results})

    return _finalize("I couldn't finish planning — try rephrasing your request.", tool_log)


def _finalize(text: str, tool_log: list[dict]) -> ChatResponse:
    ids: list[str] = []
    m = re.search(r"RECOMMENDED:\s*(.+)", text)
    if m:
        ids = [s.strip() for s in m.group(1).split(",") if s.strip()]
        text = text[: m.start()].rstrip()
    # Guardrail: only ids that exist AND were returned by a search this turn
    seen: dict[str, str] = {}  # id -> name, in the order the search returned them
    for entry in tool_log:
        if entry["tool"] == "search_trails":
            for t in entry["output"].get("trails", []):  # .get: a failed search has no "trails"
                seen[t["id"]] = t["name"]
    if not ids:
        # Model forgot the RECOMMENDED line: fall back to searched trails it named in the text.
        ids = [i for i, name in seen.items() if name in text]
    ids = [i for i in dict.fromkeys(ids) if i in seen and store.get(i)]
    return ChatResponse(reply=text, recommended_ids=ids, trails=[store.get(i) for i in ids], tool_log=tool_log)


def _demo(messages: list[ChatMessage], profile: dict | None = None) -> ChatResponse:
    """Offline fallback so the demo never dies. Picks by crude keyword match."""
    last = messages[-1].content.lower()
    car_free = (profile or {}).get("has_car") is False
    # Preserve transport preferences through follow-up questions. Explicit text wins.
    for message in messages:
        if message.role != "user":
            continue
        content = message.content.lower()
        if any(w in content for w in ["no car", "without a car", "没车", "没有车", "bus"]):
            car_free = True
        elif any(w in content for w in ["have a car", "有车"]):
            car_free = False
    easy = any(w in last for w in ["easy", "beginner", "轻松", "easier", "first-time", "hasn't hiked", "简单"])
    hard = not easy and any(w in last for w in ["hard", "challenging", "rocks", "rocky", "难", "挑战"])
    wanted = [k for k, words in {
        "view": ["view", "overlook", "风景"],
        "sunset": ["sunset", "日落"],
        "lake": ["lake", "swim", "湖"],
        "stream": ["stream", "creek"],
    }.items() if any(w in last for w in words)]
    kw = dict(car_free=car_free or None, limit=3)
    if hard:
        kw["min_level"] = 4
    else:
        kw["max_level"] = 2 if easy else 3
    res = store.search(features=wanted or None, **kw) if wanted else []
    if not res:  # nothing matched the wish: relax it rather than show an empty page
        res = store.search(**kw)
    lines = ["Here's what I'd pick (offline demo mode):"]
    if not res:
        lines.append("No trails match these transport and difficulty preferences. Try an easier hike or change your transport preference.")
    for t in res:
        lines.append(f"• {t.name} — Level {t.difficulty.level} ({t.difficulty.label}): " + "; ".join(t.difficulty.reasons))
        access = t.access.bus or (f"{t.access.walk_from_campus_min} min walk from campus"
                                 if t.access.walk_from_campus_min is not None else f"{t.access.drive_min} min drive")
        lines.append(f"  About {t.difficulty.est_time_min} min hiking; access: {access}.")
    lines.append("Offline mode matches transport, difficulty and feature keywords only; dates, time budgets, weather and hunting season are not evaluated.")
    return ChatResponse(reply="\n".join(lines), recommended_ids=[t.id for t in res], trails=res, tool_log=[{"tool": "demo", "input": {}, "output": {}}])
