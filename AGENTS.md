# Agents.md

## Architecture

An ongoing migration is moving all business logic into `rust/`. Each app under `apps/` is a UI shell — it owns rendering, interaction, and platform-specific concerns, but never owns logic. The UI framework for any given app is a replaceable detail.

### `rust/`

The single source of truth for all non-UI code. Everything platform-agnostic belongs here: no components, no hooks, no framework imports.

### `apps/`

Each app is a frontend that calls into Rust. Logic is never duplicated between apps — only UI is, because each platform may use an entirely different framework and language to build it.

- `web/` — Next.js
- `desktop/` — GPUI

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
- Keep Mangocut AI-first but manually editable; expose edits through a shared Command API used by both UI and the agent.
- Stage AI timeline changes in an AI Preview (Accept/Reject) before they hit the final timeline.
- Keep privileged AI tools (filesystem, ffmpeg) on Electron; web AI chat is fine for signed-in users with session gating.
- Prefer Mangocut-proxied OpenRouter for models (Google sign-in / free-trial limits later).
- When implementing an agreed roadmap, proceed autonomously without unnecessary confirmation prompts; favor long-term architecture over quick fixes.

## Learned Workspace Facts

- This repo is a fork of OpenCut-app/OpenCut; the product baseline is classic `v0.3.0`, not the later rewrite tip alone.
- Desktop distribution for local downloadable use is Electron under `apps/electron`.
- Intended public web host/domain for the project is `mangocut.jonam.dev`.
- Editor AI chat opens from the top-right AI button into a right sidebar (Electron).
- The AI agent runs in Electron main with filesystem access to import media from arbitrary local folders.
- AI Preview is a shadow timeline that Accept commits onto the real timeline.
- Reference for AI local ffmpeg/tool patterns: `https://github.com/ManojBaasha/ai-video-dev`.
- Local AI iteration: prefer `bun run dev:ai:request` after one-time `bun run dev:ai:install-watcher` (LaunchAgent outside the agent sandbox). Direct `bun run dev:ai` needs Shell `required_permissions: ["all"]`. Default port `3045`.
- Better Auth powers Google sign-in and AI trial entitlements that gate `/api/ai/*`.
- Local Transformers Whisper backs transcription / cut-on-speech Command API tools.
- Phase 6 AI: `search_media` + tags memory, plan/verify tools, edit skills, filler removal, highlight Shorts packaging.

