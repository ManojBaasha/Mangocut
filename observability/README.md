# Agent observability (local Langfuse)

Every Mangocut AI agent turn can be traced into a **self-hosted Langfuse that
runs only on this machine**. Tracing is off unless `LANGFUSE_PUBLIC_KEY`,
`LANGFUSE_SECRET_KEY` and `LANGFUSE_BASE_URL` are all set for the Next server;
production (Vercel) has none, so nothing is recorded or sent there.

Recorded traces can then be scored with the DeepEval harness in
[`evals/`](../evals/README.md).

## Start

```bash
bun run observability:setup   # once: secrets + keys (see below)
bun run observability:up      # docker compose up -d (project "mangocut-langfuse")
curl http://127.0.0.1:3100/api/public/health
```

`observability:setup`:

- generates `observability/langfuse/.env` with random secrets if it is
  missing (never overwrites it; template: `.env.example`)
- appends `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` / `LANGFUSE_BASE_URL`
  to `apps/web/.env.local`, only for keys not already there
- prints the UI URL, the admin login and the three `LANGFUSE_*` values

Other scripts: `observability:logs`, `observability:down` (keeps data;
`docker compose -p mangocut-langfuse down -v` deletes the volumes).

First boot pulls ~3 GB of images and runs ClickHouse/Postgres migrations; the
UI answers after a minute or two. The stack needs about 3-4 GB of RAM.

| service          | host port         | notes                                   |
| ---------------- | ----------------- | --------------------------------------- |
| Langfuse UI/API  | `127.0.0.1:3100`  | `http://localhost:3100`                 |
| MinIO S3 API     | `127.0.0.1:9190`  | media uploads (console not published)   |
| postgres, redis, clickhouse, worker | none | internal compose network only |

Headless init creates organisation **mangocut**, project **mangocut-agent**,
the admin user `admin@mangocut.local` (password in
`observability/langfuse/.env`, `LANGFUSE_INIT_USER_PASSWORD`) and the
project's API key pair. Sign-up is disabled. Restart the Next dev server after
setup so it picks up the new env.

## What is traced

One **trace per agent turn** (name `agent-turn`), grouped into a **session**
per chat conversation (new session when the chat is cleared). User = the
signed-in user id, else the device id. Tags: `web` / `desktop`.

| observation        | type       | recorded by                         | contents |
| ------------------ | ---------- | ----------------------------------- | -------- |
| `agent-turn`       | agent (root) | `/api/ai/trace` at turn end       | input = user message, output = final reply; status (`completed` / `max_steps` / `verify_failed` / `error`), steps, tool count, model, step cap, app version, platform |
| `model-call`       | generation | `/api/ai/chat`                      | full input messages + tool definitions (name + JSON schema), output message incl. tool_calls, model, token usage, cost (OpenRouter `usage.cost`), latency, step, OpenRouter response id, error + HTTP status on failure |
| `vision-call`      | generation | `/api/ai/vision`                    | same, for `describe_media` frames during a turn (inline images replaced by a size placeholder) |
| `tool:<name>`      | tool       | renderer → `/api/ai/trace`          | args, result (each cut to ~20 KB with a marker), ok/error + message, duration, target (shadow/final), step |

Scores on the trace:

- `turn_completed`: 1 when the turn ended with a final reply, else 0
- `preview_accepted`: 1 / 0 when the user clicks Accept / Reject on the AI
  Preview, applied to every turn that changed the preview since the last
  decision
- `eval/<metric>`: written by `bun run evals:run`

How it fits together: the renderer (`apps/web/src/lib/ai/agent.ts`) creates a
W3C trace id per turn and sends it, with the session id and step, on every
`/api/ai/chat` / `/api/ai/vision` request. Tool calls run in the renderer, so
it batches tool spans, the turn end and Accept/Reject scores to
`POST /api/ai/trace`. The server (`apps/web/src/lib/ai/observability/server.ts`,
registered from `src/instrumentation.ts`) records everything under that trace
id with `@langfuse/otel` 6 on an isolated OpenTelemetry provider, and flushes
after the response is sent (`after()`, bounded wait). The renderer never sees
Langfuse keys and does not import Langfuse/OTel. When tracing is off,
`/api/ai/trace` answers `204` with `x-mangocut-tracing: off` and the renderer
stops sending for the session.

## Viewing a session

1. Open http://localhost:3100 and sign in with the admin login.
2. Project **mangocut-agent** → **Tracing**: each row is one `agent-turn`;
   open it for the tree of `model-call` generations and `tool:*` spans, with
   cost and latency per step.
3. **Sessions**: one row per chat conversation; open it to read the turns in
   order. Filter traces by session id, user id, tag (`desktop`/`web`) or by
   score (`preview_accepted = 0` finds rejected edits).

Direct link to one trace: `http://localhost:3100/project/mangocut-agent/traces/<traceId>`.

## Web dev server

`bun run dev:web` (or `bun run dev:ai`) reads `apps/web/.env.local`, so after
`observability:setup` every agent turn in the browser is traced.

## Desktop (Electron)

The renderer talks to a local Next server on the same origin
(`http://127.0.0.1:3045` packaged, `MANGOCUT_DEV_URL` in dev), so the
`/api/ai/trace` posts are same-origin, and the `ai:chat` IPC handler forwards
the request body, including the `trace` field, to that server's
`/api/ai/chat`. Tracing therefore happens in the Next server process, which
needs the three `LANGFUSE_*` variables:

- **Dev (`bun run dev:electron` / `dev:ai`)**: the Next dev server reads
  `apps/web/.env.local`.
- **Packaged app**: `apps/electron/src/main.js` `loadDesktopFileEnv()` merges,
  in order (later wins): `<app>/Contents/Resources/next/apps/web/.env.local`,
  `<app>/Contents/Resources/next/apps/web/.env`, then
  `<userData>/.env.local`, where `<userData>` is Electron's
  `app.getPath("userData")` (on macOS `~/Library/Application Support/<app name>`,
  normally `Mangocut`).
  `desktopEnv()` passes all of these keys (`...merged`) plus `process.env` to
  the spawned Next server, so `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` and
  `LANGFUSE_BASE_URL` need no extra wiring. To trace a packaged build, put the
  three keys in the `userData` `.env.local`.

Note: `apps/electron/scripts/prepare-standalone.mjs` copies
`apps/web/.env.local` into the app bundle for local tryouts, so a build made
after `observability:setup` contains this machine's Langfuse keys. They only
work against `127.0.0.1:3100` on a machine running this stack (elsewhere the
export fails silently), but remove the `LANGFUSE_*` lines from
`apps/web/.env.local` before building an app you intend to share.

## Privacy

Traces contain full prompts and replies, tool arguments and results, local
file paths, media and project names, and transcripts that tools return. They
stay in this local Docker stack (volumes `mangocut-langfuse_*`); nothing
leaves the machine and Langfuse's own telemetry is disabled
(`TELEMETRY_ENABLED=false`). Inline image frames are not stored. With the
`LANGFUSE_*` keys unset, the app records and sends nothing. The only outbound
call the eval harness makes is to OpenRouter for the judged metrics, and only
when `OPENROUTER_API_KEY` is set.

## End-to-end check

With the stack up:

```bash
cd apps/web && bun scripts/observability-e2e.ts                 # server module only
cd apps/web && bun scripts/observability-e2e.ts --app http://127.0.0.1:3000  # through a running Next server
```

It simulates one turn (two model calls with a mocked OpenRouter response,
two tool calls, turn end, Accept), then polls the Langfuse API until the
trace, generations, tool spans and scores are visible.
