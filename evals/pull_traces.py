"""Fetch recorded Mangocut agent turns from local Langfuse as DeepEval test cases.

Langfuse v4 is observation-centric: a trace is its observations. Each agent
turn is a root observation named ``agent-turn`` (written by
apps/web/src/lib/ai/observability/server.ts) whose children are ``model-call``
/ ``vision-call`` generations and ``tool:<name>`` tool observations.

    uv run python pull_traces.py --hours 24 --limit 5
"""

from __future__ import annotations

import argparse
import json
import os
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from deepeval.test_case import LLMTestCase, ToolCall
from langfuse import Langfuse

REPO_ROOT = Path(__file__).resolve().parent.parent
WEB_ENV_FILE = REPO_ROOT / "apps" / "web" / ".env.local"
ENV_KEYS = (
    "LANGFUSE_PUBLIC_KEY",
    "LANGFUSE_SECRET_KEY",
    "LANGFUSE_BASE_URL",
    "OPENROUTER_API_KEY",
    "EVAL_JUDGE_MODEL",
)
TOOL_OUTPUT_CHARS = 4_000


def load_env() -> None:
    """Fill missing LANGFUSE_* / OPENROUTER_API_KEY / EVAL_JUDGE_MODEL from
    apps/web/.env.local (observability:setup writes the Langfuse keys there).
    Variables already set in the environment win."""
    if not WEB_ENV_FILE.exists():
        return
    for raw in WEB_ENV_FILE.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if key in ENV_KEYS and value and not os.environ.get(key):
            os.environ[key] = value


def langfuse_client() -> Langfuse:
    load_env()
    missing = [k for k in ENV_KEYS[:3] if not os.environ.get(k)]
    if missing:
        raise SystemExit(
            f"Missing {', '.join(missing)}. Run `bun run observability:setup` "
            "or export them (see observability/README.md)."
        )
    # Read/score only: this harness does not emit its own traces.
    return Langfuse(
        public_key=os.environ["LANGFUSE_PUBLIC_KEY"],
        secret_key=os.environ["LANGFUSE_SECRET_KEY"],
        host=os.environ["LANGFUSE_BASE_URL"],
        tracing_enabled=False,
    )


@dataclass
class ToolSpan:
    name: str
    args: Any
    output: Any
    level: str
    status_message: Optional[str]
    step: Optional[int]


@dataclass
class AgentTurn:
    trace_id: str
    session_id: Optional[str]
    user_id: Optional[str]
    start_time: str
    user_message: str
    final_text: str
    status: Optional[str]
    steps: Optional[int]
    max_steps: Optional[int]
    model: Optional[str]
    platform: Optional[str]
    tools: list[ToolSpan] = field(default_factory=list)
    model_calls: int = 0
    total_cost: float = 0.0
    scores: dict[str, float] = field(default_factory=dict)

    @property
    def tool_errors(self) -> list[ToolSpan]:
        return [t for t in self.tools if t.level == "ERROR"]


def _maybe_json(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (ValueError, TypeError):
            return value
    return value


def _as_text(value: Any) -> str:
    value = _maybe_json(value)
    if value is None:
        return ""
    return value if isinstance(value, str) else json.dumps(value)


def _as_int(value: Any) -> Optional[int]:
    try:
        return int(_maybe_json(value))
    except (TypeError, ValueError):
        return None


def _list_observations(lf: Langfuse, **filters: Any) -> list[Any]:
    out: list[Any] = []
    cursor = None
    while True:
        page = lf.api.observations.get_many(cursor=cursor, **filters)
        out.extend(page.data)
        cursor = getattr(page.meta, "cursor", None)
        if not cursor:
            return out


def fetch_turns(
    lf: Langfuse,
    *,
    hours: float = 24,
    limit: int = 20,
    session_id: Optional[str] = None,
    trace_id: Optional[str] = None,
) -> list[AgentTurn]:
    """Most recent agent turns first."""
    filters: dict[str, Any] = {
        "name": "agent-turn",
        "is_root_observation": True,
        "fields": "core,basic,io,metadata,trace_context",
        "limit": min(max(limit, 1), 100),
    }
    if trace_id:
        filters["trace_id"] = trace_id
    else:
        filters["from_start_time"] = datetime.now(timezone.utc) - timedelta(hours=hours)
    if session_id:
        filters["session_id"] = session_id

    roots = lf.api.observations.get_many(**filters).data
    roots = sorted(roots, key=lambda o: o.start_time, reverse=True)[:limit]
    return [_build_turn(lf, root) for root in roots]


def _build_turn(lf: Langfuse, root: Any) -> AgentTurn:
    meta = root.metadata or {}
    children = _list_observations(
        lf,
        trace_id=root.trace_id,
        fields="core,basic,io,metadata,usage",
        limit=1000,
    )
    children.sort(key=lambda o: o.start_time)
    tools = [
        ToolSpan(
            name=o.name[len("tool:"):],
            args=_maybe_json(o.input),
            output=_maybe_json(o.output),
            level=str(getattr(o.level, "value", o.level) or "DEFAULT"),
            status_message=o.status_message or None,
            step=_as_int((o.metadata or {}).get("step")),
        )
        for o in children
        if str(o.type).upper().endswith("TOOL") and (o.name or "").startswith("tool:")
    ]
    generations = [o for o in children if str(o.type).upper().endswith("GENERATION")]
    scores = lf.api.scores_v3.get_many_v3(trace_id=root.trace_id, limit=100).data
    return AgentTurn(
        trace_id=root.trace_id,
        session_id=root.session_id,
        user_id=root.user_id,
        start_time=root.start_time.isoformat(),
        user_message=_as_text(root.input),
        final_text=_as_text(root.output),
        status=_maybe_json(meta.get("status")),
        steps=_as_int(meta.get("steps")),
        max_steps=_as_int(meta.get("maxSteps")),
        model=_maybe_json(meta.get("model")),
        platform=_maybe_json(meta.get("platform")),
        tools=tools,
        model_calls=len(generations),
        total_cost=sum(float(getattr(g, "total_cost", 0) or 0) for g in generations),
        scores={
            s.name: s.value
            for s in scores
            if isinstance(getattr(s, "value", None), (int, float))
        },
    )


def _clip(value: Any) -> Any:
    text = value if isinstance(value, str) else json.dumps(value, default=str)
    if len(text) <= TOOL_OUTPUT_CHARS:
        return value
    return text[:TOOL_OUTPUT_CHARS] + "…[clipped for eval]"


def to_test_case(turn: AgentTurn) -> LLMTestCase:
    return LLMTestCase(
        name=turn.trace_id,
        input=turn.user_message or "(empty)",
        actual_output=turn.final_text or "(empty)",
        tools_called=[
            ToolCall(
                name=t.name,
                input_parameters=t.args if isinstance(t.args, dict) else {"raw": t.args},
                output=_clip(t.output),
            )
            for t in turn.tools
        ],
        metadata={
            "trace_id": turn.trace_id,
            "session_id": turn.session_id,
            "status": turn.status,
            "steps": turn.steps,
            "max_steps": turn.max_steps,
            "tool_errors": [
                {"name": t.name, "message": t.status_message} for t in turn.tool_errors
            ],
            "preview_accepted": turn.scores.get("preview_accepted"),
            "model": turn.model,
            "platform": turn.platform,
        },
        tags=[t for t in (turn.platform, turn.status) if t],
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--hours", type=float, default=24)
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--session")
    parser.add_argument("--trace-id")
    args = parser.parse_args()
    turns = fetch_turns(
        langfuse_client(),
        hours=args.hours,
        limit=args.limit,
        session_id=args.session,
        trace_id=args.trace_id,
    )
    print(json.dumps([asdict(t) for t in turns], indent=2, default=str))


if __name__ == "__main__":
    main()
