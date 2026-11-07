# Mangocut agent evals (DeepEval)

Scores agent turns that were traced into the local Langfuse
(`observability/README.md`) and writes the results back onto the traces.

## Setup

```bash
bun run observability:setup && bun run observability:up   # Langfuse + keys
bun run evals:install                                     # uv sync (Python 3.11, deepeval 4.3.3)
```

Configuration (environment variables; missing ones are read from
`apps/web/.env.local`):

| variable              | needed for                                    |
| --------------------- | --------------------------------------------- |
| `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` / `LANGFUSE_BASE_URL` | reading traces, writing scores |
| `OPENROUTER_API_KEY`  | judged metrics (skipped when unset)           |
| `EVAL_JUDGE_MODEL`    | judge model id on OpenRouter, default `anthropic/claude-sonnet-4.5` (a different model from the agent) |

## Run

```bash
bun run evals:run                                   # last 24h, up to 20 turns
bun run evals:run -- --hours 2 --limit 5
bun run evals:run -- --session <chat-session-id>
bun run evals:run -- --trace-id <trace-id>
bun run evals:run -- --deterministic-only --no-write
cd evals && uv run python pull_traces.py --limit 3  # inspect the raw turns
```

## What it measures

Each `agent-turn` trace becomes an `LLMTestCase`:

- `input`: the user message; `actual_output`: the final assistant text
- `tools_called`: the `tool:<name>` observations (name, args, output)
- `metadata`: turn status, steps, step cap, tool errors, `preview_accepted`

| metric             | kind          | passes when                                                    |
| ------------------ | ------------- | -------------------------------------------------------------- |
| `turn_completed`   | deterministic | turn ended with a final reply (not max_steps / verify_failed / error) |
| `no_tool_errors`   | deterministic | no tool call failed                                            |
| `steps_under_cap`  | deterministic | steps used < `AI_AGENT_MAX_STEPS`                              |
| `task_completion`  | LLM judge     | DeepEval `TaskCompletionMetric`: the turn achieved what was asked |
| `tool_use_quality` | LLM judge     | GEval: tools were appropriate and used efficiently            |

`TaskCompletionMetric` runs from the test case fields (input, output, tools);
it does not need DeepEval's own tracing.

## Output

- Langfuse score per metric on the trace: `eval/<metric>`, value 0..1,
  comment = the metric's reason. Score ids are stable per trace + metric, so
  re-running updates instead of duplicating.
- JSON summary: `evals/results/run-<timestamp>.json` (gitignored).

Compare `eval/*` against the user's own `preview_accepted` score in the
Langfuse UI to see whether the judges agree with real Accept/Reject decisions.

## Golden datasets

See `datasets/README.md`. Replaying those scenarios needs the headless engine
(Phase 2) and is not implemented yet.
