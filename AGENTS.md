# Agents.md

## Architecture

An ongoing migration is moving all business logic into `rust/`. Each app under `apps/` is a UI shell — it owns rendering, interaction, and platform-specific concerns, but never owns logic. The UI framework for any given app is a replaceable detail.

### `rust/`

The single source of truth for all non-UI code. Everything platform-agnostic belongs here: no components, no hooks, no framework imports.

### `apps/`

Each app is a frontend that calls into Rust. Logic is never duplicated between apps — only UI is, because each platform may use an entirely different framework and language to build it.

- `web/` — Next.js
- `desktop/` — GPUI

## Debugging AI agent runs

Every Mangocut agent turn (model calls, tool calls with args/results/errors, accept/reject, eval scores) is recorded in a local Langfuse when `LANGFUSE_*` keys are set. Inspect it from the terminal, not the web UI:

- `bun run observability:up` — start local Langfuse (first time: `bun run observability:setup`).
- `bun run traces failures` — recent turns that did not complete, hit a tool/model error, or scored below 0.5.
- `bun run traces show <traceId>` — step-by-step timeline of one turn (`--full` for untruncated payloads, `--json` for machine-readable output).
- `bun run traces list --limit 20 [--session ID] [--json]` — recent turns with status, steps and tool counts.
- `bun run evals:run -- --deterministic-only` — score recorded turns without calling a judge model (drop the flag to also run LLM-judged metrics via OpenRouter).

## Web

### React

- Read components before using them. They may already apply classes, which affects what you need to pass and how to override them.

## Learned User Preferences

- Brand the product as Mangocut everywhere in UI and most code; the `opencut` package name may stay as the only exception.
- Product positioning/tagline is "Edit Videos with AI".
- Use a simple mango SVG as the logo, and apply its colors only as very subtle UI tints—not loud fills.
- Prefer pushing directly to `main`; pull requests are not required for this fork.
- Rebranding must be thorough: check and update README, installers/DMG, URLs, and copyright assets so OpenCut branding does not linger.
- Prefer a lean local Electron editor; remove unused marketing, cloud, and redundant desktop surface when trimming bloat.
- Stage AI timeline changes as AI changes on the timeline (Main vs AI changes, Merge/Discard); chat can confirm with “yes” but Accept/Reject tabs do not live in chat.
- Keep Mangocut AI-first but manually editable; expose edits through a shared Command API used by both UI and the agent.
- Keep privileged AI tools (filesystem, ffmpeg) on Electron; web AI requires Google sign-in. Tell users the browser editor keeps projects in that browser (no cloud sync) and that folder import and full AI tools are on the desktop app.
- Prefer hosted Mangocut for Google sign-in, trial limits, and OpenRouter spend so desktop and web share one ledger; local dev with no cloud origin keeps local auth and OpenRouter. DMGs do not ship an OpenRouter key.
- When implementing an agreed roadmap, proceed autonomously without unnecessary confirmation prompts; favor long-term architecture over quick fixes.

## Learned Workspace Facts

- This repo is a fork of OpenCut-app/OpenCut; the product baseline is classic `v0.3.0`, not the later rewrite tip alone.
- Desktop distribution for local downloadable use is Electron under `apps/electron`.
- Intended public web host is `mangocut.jonam.dev` (privacy/terms at `/privacy` and `/terms`); Google OAuth authorized domain is `jonam.dev`. Web projects stay in that browser; a capability banner (hidden on desktop) points folder import and privileged AI tools to the desktop app.
- Editor AI chat opens from the top-right AI button into a right sidebar (Electron).
- The AI agent runs in Electron main with filesystem access to import media from arbitrary local folders.
- AI changes stage on a shadow timeline; timeline toolbar toggles Main vs AI changes with Merge/Discard; chat can confirm merge with “yes”.
- Reference for AI local ffmpeg/tool patterns: `https://github.com/ManojBaasha/ai-video-dev`.
- Local AI iteration: prefer `bun run dev:ai:request` after one-time `bun run dev:ai:install-watcher` (LaunchAgent outside the agent sandbox). Direct `bun run dev:ai` needs Shell `required_permissions: ["all"]`. Default port `3045` (dev and packaged DMG share this port).
- Better Auth powers Google sign-in; AI requires sign-in by default (`AI_REQUIRE_AUTH` is on unless set to `false`). With `MANGOCUT_CLOUD_ORIGIN` set, desktop AI and auth use the host via Bearer; empty origin keeps local SQLite and OpenRouter. Local Google OAuth must be a Web client with redirect `http://127.0.0.1:3045/api/auth/callback/google` (Desktop clients cannot set that redirect). Operator-only `/admin` (404 for others; `MANGOCUT_ADMIN_EMAIL`) lists signed-in users and spend.
- Remaining AI free-trial turns and exact OpenRouter USD (`usage.cost`) show in AI chat and `/settings` (theme, projects, per-project spend, feedback, feature requests). AI pauses when the turn and/or optional USD spend cap is exhausted; manual editing continues. No payment in this version.
- Phase 6 AI: `search_media` + tags memory, plan/verify tools, edit skills, filler removal, highlight Shorts packaging.

