# Mangocut Agent Engine: Roadmap of Phase Plans

**Spec:** `docs/superpowers/specs/2026-11-05-mangocut-agent-engine-design.md`

The spec covers eight subsystems. Each phase below gets its own plan, which produces working, tested software on its own. A phase's plan is written when its dependencies are done, so it can name real interfaces instead of guessed ones.

| # | Phase | Delivers | Depends on | Plan |
|---|---|---|---|---|
| 1 | Rust timeline foundation | Rust toolchain; local browser and Node wasm builds; `rust/crates/timeline` with the model and core edit operations at parity with TS; renderer runs those operations through wasm | — | `2026-11-05-phase1-rust-timeline-foundation.md` |
| 2 | Engine host | Electron `utilityProcess` running `@opencode/sdk` with SQLite sessions; local streaming OpenAI-compatible endpoint on the desktop Next server; per-launch secret; renderer can create a session, prompt it and stream events (no Mangocut tools yet) | — (can run alongside 1) | to write |
| 3 | Projects on disk | Filesystem storage adapter on desktop; `~/Mangocut/Projects/<id>/` layout; one-time IndexedDB/OPFS migration; single-writer rule (renderer owns `project.json`) | 1 (Rust model is the on-disk schema) | to write |
| 4 | Branches and the Mangocut plugin skeleton | `.mangocut/branches/*` with revisions; `session → branch` binding; plugin registered in the engine with read and edit tools calling Rust ops; AI Preview Accept/Reject over branches; `ShadowManager` retired on desktop | 1, 2, 3 | to write |
| 5 | Media, analysis and seeing tools | ffprobe/import/`fetch_reference` (yt-dlp); beats, shots, reference rhythm; Rust preview filter-graph generator; `render_frame`, contact sheet, clip, compare grid, motion check; baked grades; bundled ffmpeg/ffprobe/yt-dlp; preflight | 4 | to write |
| 6 | Agents, skills and the job loop | `director`, `analyst`, `assembler`, `colorist`, `critic`; coding tools denied; `SKILL.md` packs; goal integration with video-evidence prompts; job supervisor (re-arm up to 4, notify done/blocked/stopped); unattended permissions; auto-resume after restart; job-start entitlement check | 4, 5 | to write |
| 7 | Renderer UI | Session list and resume; streaming chat from engine events; subagent tree; goal status and stop; branch list, compare, Accept/Reject; job start form; notifications | 2, 4, 6 | to write |
| 8 | Acceptance suite and cutover | Fixtures and the five end-to-end jobs at 5/5; tool error-path tests; removal of `runAgentTurn` and the desktop `/api/ai/chat` path | all | to write |

Phases 1 and 2 have no shared files and can run in parallel.
