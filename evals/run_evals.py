"""Score recorded Mangocut agent turns with DeepEval and write results back.

For every `agent-turn` trace in the window it runs:
  - deterministic: turn_completed, no_tool_errors, steps_under_cap
  - judged (needs OPENROUTER_API_KEY): task_completion, tool_use_quality,
    outcome_matches_request (checks the recorded final timeline, not claims)
and records each result on the trace as a Langfuse score `eval/<metric>`
(value 0..1, comment = reason), plus a JSON summary in evals/results/.

    bun run evals:run                      # last 24h, up to 20 turns
    bun run evals:run -- --trace-id <id>   # one turn
    bun run evals:run -- --deterministic-only --no-write
"""

from __future__ import annotations

import os

os.environ.setdefault("DEEPEVAL_TELEMETRY_OPT_OUT", "YES")
os.environ.setdefault("DEEPEVAL_UPDATE_WARNING_OPT_IN", "NO")

import logging  # noqa: E402

# DeepEval's async HTTP client is closed after its event loop at exit, which
# only logs a harmless "Event loop is closed" traceback; keep output readable.
logging.getLogger("asyncio").setLevel(logging.CRITICAL)

import argparse  # noqa: E402
import json  # noqa: E402
from datetime import datetime, timezone  # noqa: E402
from pathlib import Path  # noqa: E402

from metrics import (  # noqa: E402
    DEFAULT_JUDGE_MODEL,
    deterministic_metrics,
    judge_model,
    judged_metrics,
    metric_slug,
)
from pull_traces import fetch_turns, langfuse_client, to_test_case  # noqa: E402

RESULTS_DIR = Path(__file__).resolve().parent / "results"


def main() -> int:
    parser = argparse.ArgumentParser(description="Run DeepEval on Langfuse agent traces")
    parser.add_argument("--hours", type=float, default=24, help="look-back window")
    parser.add_argument("--limit", type=int, default=20, help="max turns to score")
    parser.add_argument("--session", help="only this chat session id")
    parser.add_argument("--trace-id", help="only this trace")
    parser.add_argument(
        "--deterministic-only",
        action="store_true",
        help="skip LLM-judged metrics (automatic without OPENROUTER_API_KEY)",
    )
    parser.add_argument("--judge-model", help=f"default $EVAL_JUDGE_MODEL or {DEFAULT_JUDGE_MODEL}")
    parser.add_argument("--no-write", action="store_true", help="do not write scores to Langfuse")
    args = parser.parse_args()

    lf = langfuse_client()  # also loads apps/web/.env.local fallbacks
    turns = fetch_turns(
        lf,
        hours=args.hours,
        limit=args.limit,
        session_id=args.session,
        trace_id=args.trace_id,
    )
    if not turns:
        print("No agent-turn traces found for that filter.")
        return 1

    judged_enabled = not args.deterministic_only and bool(os.environ.get("OPENROUTER_API_KEY"))
    if not args.deterministic_only and not judged_enabled:
        print("OPENROUTER_API_KEY not set: running deterministic metrics only.")
    model = judge_model(args.judge_model) if judged_enabled else None

    summary: dict = {
        "ran_at": datetime.now(timezone.utc).isoformat(),
        "judge_model": model.get_model_name() if model else None,
        "judged_metrics": judged_enabled,
        "turns": [],
    }

    for turn in turns:
        test_case = to_test_case(turn)
        metrics = deterministic_metrics() + (judged_metrics(model) if model else [])
        results = []
        for metric in metrics:
            slug = metric_slug(metric)
            if slug == "outcome_matches_request" and not test_case.context:
                # Turns recorded before final-state capture: nothing to check against.
                results.append(
                    {
                        "metric": slug,
                        "score": None,
                        "success": None,
                        "reason": "skipped: no final timeline recorded for this turn",
                        "error": None,
                    }
                )
                continue
            try:
                metric.measure(test_case)
                score = float(metric.score or 0.0)
                reason = metric.reason or ""
                error = None
            except Exception as exc:  # a failing judge must not stop the run
                score, reason, error = None, "", f"{type(exc).__name__}: {exc}"
            results.append(
                {
                    "metric": slug,
                    "score": score,
                    "success": None if score is None else bool(metric.is_successful()),
                    "reason": reason,
                    "error": error,
                }
            )
            if score is not None and not args.no_write:
                lf.api.scores.create(
                    # Stable id: re-running updates the score instead of duplicating it.
                    id=f"eval-{turn.trace_id}-{slug}",
                    trace_id=turn.trace_id,
                    name=f"eval/{slug}",
                    value=max(0.0, min(1.0, score)),
                    data_type="NUMERIC",
                    comment=reason[:2000] or None,
                )

        summary["turns"].append(
            {
                "trace_id": turn.trace_id,
                "session_id": turn.session_id,
                "input": turn.user_message,
                "status": turn.status,
                "steps": turn.steps,
                "tools": [t.name for t in turn.tools],
                "preview_accepted": turn.scores.get("preview_accepted"),
                "results": results,
            }
        )
        line = ", ".join(
            "{}={}".format(r["metric"], ("n/a" if r["error"] is None else "ERR") if r["score"] is None else f"{r['score']:.2f}")
            for r in results
        )
        print(f"{turn.trace_id}  {turn.user_message[:50]!r}\n    {line}")

    RESULTS_DIR.mkdir(exist_ok=True)
    out = RESULTS_DIR / f"run-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"
    out.write_text(json.dumps(summary, indent=2, default=str))
    print(f"\nSummary: {out}")
    if not args.no_write:
        print("Scores written to Langfuse as eval/<metric>.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
