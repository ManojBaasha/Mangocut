# Golden datasets

Seed cases for the Phase 8 acceptance jobs. One JSON object per line
(`*.jsonl`):

| field             | type       | meaning                                                         |
| ----------------- | ---------- | --------------------------------------------------------------- |
| `id`              | string     | Stable case id                                                  |
| `input`           | string     | The user message sent to the agent                              |
| `expected_tools`  | string[]   | Tools a good run calls (order is a hint, not a requirement)     |
| `forbidden_tools` | string[]   | Tools a good run must not call                                  |
| `expected_outcome`| string     | What the AI Preview should look like afterwards (judge rubric)  |
| `max_steps`       | number     | Step budget a good run stays under                              |
| `tags`            | string[]   | Grouping for reports                                            |

`golden.seed.jsonl` holds the first few cases. Tool names must match the
Command API (`apps/web/src/lib/commands-api/register-*.ts`).

## What runs today

`run_evals.py` scores **recorded** traces only: real agent turns captured in
local Langfuse. It does not replay these cases.

## Scenario replay (out of scope for now)

Replaying a golden case means running the agent against a fixed project with
no UI and checking the resulting timeline. That needs the editor engine to
run headless, which arrives with the Phase 2 move of timeline logic into
`rust/`. Until then the cases here document intent: when replay lands, each
case maps onto an `LLMTestCase` with `expected_output = expected_outcome` and
`expected_tools = expected_tools`, and the same metrics (plus DeepEval's
`ToolCorrectnessMetric`) apply.
