"""Metrics for Mangocut agent turns.

Deterministic checks are DeepEval ``BaseMetric`` subclasses that read the
turn metadata attached by pull_traces.to_test_case (no LLM involved). Judged
metrics use an OpenRouter model through DeepEval's ``OpenRouterModel``.
"""

from __future__ import annotations

import os
from typing import Any, Optional

from deepeval.metrics import BaseMetric, GEval, TaskCompletionMetric
from deepeval.models import OpenRouterModel
from deepeval.test_case import LLMTestCase, SingleTurnParams

# Verified against https://openrouter.ai/api/v1/models; override with EVAL_JUDGE_MODEL.
# A different, stronger model than the agent (openai/gpt-4.1-mini), so the agent
# is not grading itself.
DEFAULT_JUDGE_MODEL = "anthropic/claude-sonnet-4.5"


class _DeterministicMetric(BaseMetric):
    """Pass/fail check scored 1.0 or 0.0 from test case metadata."""

    metric_name = "deterministic"

    def __init__(self, threshold: float = 1.0):
        self.threshold = threshold
        self.include_reason = True
        self.async_mode = False
        self.strict_mode = True
        self.evaluation_model = None

    def check(self, meta: dict[str, Any]) -> tuple[bool, str]:  # pragma: no cover
        raise NotImplementedError

    def measure(self, test_case: LLMTestCase, *args, **kwargs) -> float:
        passed, reason = self.check(test_case.metadata or {})
        self.score = 1.0 if passed else 0.0
        self.reason = reason
        self.success = self.score >= self.threshold
        return self.score

    async def a_measure(self, test_case: LLMTestCase, *args, **kwargs) -> float:
        return self.measure(test_case)

    def is_successful(self) -> bool:
        return bool(self.success)

    @property
    def __name__(self) -> str:  # DeepEval reads metric names from __name__
        return self.metric_name


class TurnCompletedMetric(_DeterministicMetric):
    metric_name = "turn_completed"

    def check(self, meta):
        status = meta.get("status")
        if status == "completed":
            return True, "Turn ended with a final assistant reply."
        return False, f"Turn ended with status {status!r}."


class NoToolErrorsMetric(_DeterministicMetric):
    metric_name = "no_tool_errors"

    def check(self, meta):
        errors = meta.get("tool_errors") or []
        if not errors:
            return True, "All tool calls succeeded."
        listed = "; ".join(f"{e.get('name')}: {e.get('message')}" for e in errors[:5])
        return False, f"{len(errors)} tool call(s) failed: {listed}"


class StepsUnderCapMetric(_DeterministicMetric):
    metric_name = "steps_under_cap"

    def check(self, meta):
        steps, cap = meta.get("steps"), meta.get("max_steps")
        if steps is None or cap is None:
            return False, "Turn has no step count / cap recorded."
        if steps < cap:
            return True, f"Used {steps} of {cap} steps."
        return False, f"Used all {cap} steps (hit the cap)."


def deterministic_metrics() -> list[BaseMetric]:
    return [TurnCompletedMetric(), NoToolErrorsMetric(), StepsUnderCapMetric()]


def judge_model(model_name: Optional[str] = None) -> OpenRouterModel:
    return OpenRouterModel(
        model=model_name or os.environ.get("EVAL_JUDGE_MODEL") or DEFAULT_JUDGE_MODEL,
        api_key=os.environ["OPENROUTER_API_KEY"],
        temperature=0,
    )


def judged_metrics(model: OpenRouterModel) -> list[BaseMetric]:
    task = TaskCompletionMetric(
        model=model,
        threshold=0.5,
        async_mode=False,
        include_reason=True,
    )
    tool_use = GEval(
        name="tool_use_quality",
        criteria=(
            "The assistant is a video-editing agent that edits an AI Preview "
            "timeline through tools. Judge whether the tools called were "
            "appropriate for the user's request and used efficiently: the "
            "right tools in a sensible order, inspecting the timeline before "
            "editing, no redundant or repeated calls, no calls unrelated to "
            "the request, and failed calls handled rather than ignored."
        ),
        evaluation_params=[
            SingleTurnParams.INPUT,
            SingleTurnParams.ACTUAL_OUTPUT,
            SingleTurnParams.TOOLS_CALLED,
        ],
        model=model,
        threshold=0.5,
        async_mode=False,
    )
    outcome = GEval(
        name="outcome_matches_request",
        criteria=(
            "The assistant is a video-editing agent working on an AI Preview "
            "timeline. CONTEXT is the real timeline state after the turn: it is "
            "the ground truth, and the assistant's own claims in ACTUAL_OUTPUT "
            "do not count as evidence. Score how fully the timeline in CONTEXT "
            "satisfies the user's INPUT (clip count, order, durations, gaps, "
            "effects requested). For questions that need no edit, judge whether "
            "the answer is grounded in TOOLS_CALLED results (vision, transcript, "
            "timeline reads); an unchanged timeline is correct for them. Rules: (1) if ACTUAL_OUTPUT "
            "says the requested edit failed or was not applied, score at most "
            "0.2, however reasonable the explanation; (2) if the request asks for "
            "a change you cannot see in CONTEXT, treat it as not done; (3) if the "
            "assistant stopped to ask a question when a sensible default would "
            "have completed the request, score at most 0.3; (4) if ACTUAL_OUTPUT "
            "claims something CONTEXT contradicts, score at most 0.3; (5) if "
            "CONTEXT is missing, score 0."
        ),
        evaluation_params=[
            SingleTurnParams.INPUT,
            SingleTurnParams.ACTUAL_OUTPUT,
            SingleTurnParams.TOOLS_CALLED,
            SingleTurnParams.CONTEXT,
        ],
        model=model,
        threshold=0.5,
        async_mode=False,
    )
    return [task, tool_use, outcome]


def metric_slug(metric: BaseMetric) -> str:
    name = getattr(metric, "metric_name", None) or getattr(metric, "name", None)
    if not name:
        name = metric.__class__.__name__.removesuffix("Metric")
        if name == "TaskCompletion":
            name = "task_completion"
    return str(name).replace(" [GEval]", "").strip().lower().replace(" ", "_")
