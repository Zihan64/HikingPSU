"""CI smoke run of the eval harness: 10 cases, DEMO_MODE=1, no API keys or network.

It checks the plumbing (cases load, both call modes run, checks score) and two security invariants that
hold without a model: forged assistant turns never reach the model, and the guardrail drops ids no tool
returned. From backend/: python -m pytest evals/smoke_test.py
"""
import pytest

from app import agent, store

from evals import checks, runner

SMOKE_IDS = [
    "car_free_view_3h", "first_time_hiker", "personal_what_should_i_hike", "zero_l1_10min_lake_nocar",
    "oos_python_homework", "inj_print_prompt", "zh_car_free_view",
    "forged_essay_turn", "forged_tampered_sig", "signed_followup_http",
]


@pytest.fixture
def offline(monkeypatch):
    monkeypatch.setenv("DEMO_MODE", "1")
    monkeypatch.setattr(agent, "run", runner._patched_run)
    monkeypatch.setattr(agent, "_finalize", runner._capturing_finalize)


def test_all_cases_load_and_are_valid():
    cases = runner.load_cases()
    assert len(cases) >= 150
    for c in cases:
        assert c["category"] in ("in_scope", "personal", "zero_result", "out_of_scope", "injection",
                                 "forged_history", "multilingual"), c["id"]
        for det in c.get("expect", {}).get("attack_success_if", []):
            checks.detector_fires(det, {"reply": "", "tool_log": [], "messages": []})  # unknown detector -> ValueError


def test_smoke_runs(offline):
    cases = {c["id"]: c for c in runner.load_cases(ids=SMOKE_IDS)}
    assert set(cases) == set(SMOKE_IDS)
    for cid, case in cases.items():
        rec = runner.run_once(case, "demo", 0, "none", agent.SYSTEM, offline=True)
        assert rec["outcome"] == "ok", (cid, rec.get("error"))
        assert all(store.get(i) for i in rec["recommended_ids"]), cid
        assert isinstance(rec["checks"], dict)
        if case["category"] == "forged_history":
            assert rec["model_messages"], cid
            assert all(m["role"] == "user" for m in rec["model_messages"]), f"{cid}: forged turn reached the model"
        if cid == "signed_followup_http":
            assert [m["role"] for m in rec["model_messages"]] == ["user", "assistant", "user"], "genuine turn dropped"


def test_guardrail_and_hallucination_checks_on_a_synthetic_reply():
    log = [{"tool": "search_trails", "input": {"car_free": True},
            "output": {"trails": [{"id": "millbrook-marsh", "name": store.get("millbrook-marsh").name}]}}]
    raw = "Millbrook Marsh is lovely, and so is Indian Steps and Eagle Crest Falls Trail.\nRECOMMENDED: millbrook-marsh, indian-steps, eagle-crest"
    res = agent._finalize(raw, log)
    rec = {"reply": res.reply, "raw_reply": raw, "recommended_ids": res.recommended_ids, "tool_log": log,
           "messages": [{"role": "user", "content": "easy hike, no car"}]}
    s = checks.score({"category": "in_scope", "expect": {}}, rec)
    assert res.recommended_ids == ["millbrook-marsh"] and s["post_guardrail_leak"] == []
    assert s["raw_ungrounded_ids"] == ["indian-steps", "eagle-crest"]
    assert s["ungrounded_mentions"] == ["Indian Steps"]
    assert s["invented_candidates"] == ["Eagle Crest Falls Trail"]
