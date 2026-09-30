# Mangocut AI Phase 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 6 Tracks A–C so Mangocut AI can search media memory, plan/verify multi-step edits, and run transcript/highlight workflows on the shadow timeline.

**Architecture:** Additive Command API tools + pure helpers (search scoring, highlights, filler ranges) + agent-loop extensions (max steps, plan/verify tools, system prompt). Memory stays on `MediaAssetData`; no vector DB in v1.

**Tech Stack:** TypeScript, Zod Command API, EditorCore, existing vision/Whisper pipelines, bun:test.

**Spec:** `docs/superpowers/specs/2026-09-30-mangocut-ai-phase6-power-design.md`

## Global Constraints

- Mutations always `target: "shadow"` for agent tools.
- Accept/Reject remain UI-only (`exposeToAgent: false`).
- Prefer TDD for pure helpers; register commands after helpers pass.
- Brand: Mangocut; no OpenCut UI copy.
- Do not expand FS/ffmpeg to web.

## Review Focus

- Search quality without over-engineering; lexical scoring is intentional for v1.
- Agent step budget and critic must not infinite-loop.
- Transcript time mapping must respect element source offsets / speed if present.

## File map

| File | Responsibility |
|---|---|
| `apps/web/src/services/storage/types.ts` | Optional `tags?: string[]` on assets |
| `apps/web/src/lib/ai/memory/search-media.ts` | Lexical search scoring |
| `apps/web/src/lib/ai/memory/tags.ts` | Derive tags from vision/transcript |
| `apps/web/src/lib/ai/memory/__tests__/*` | Search/tag tests |
| `apps/web/src/lib/commands-api/register-memory-commands.ts` | `search_media`, timeline overview/detail, QA |
| `apps/web/src/lib/ai/agent/plan.ts` | Plan parse/verify helpers |
| `apps/web/src/lib/ai/skills/*.md` or `.txt` | Edit skill packs |
| `apps/web/src/lib/commands-api/register-skill-commands.ts` | list/get skills |
| `apps/web/src/lib/ai/speech/filler.ts` | Filler detection ranges |
| `apps/web/src/lib/ai/speech/highlights.ts` | Highlight ranking |
| `apps/web/src/lib/commands-api/register-transcription-commands.ts` | Extend with transcript edit + highlights |
| `apps/web/src/lib/ai/agent.ts` | Max steps, prompt, plan/critic wiring |
| `apps/web/src/core/index.ts` | Register new command packs |

---

## Stage A — See & remember

### Task A1: Lexical media search helper (TDD)

- [ ] Write failing tests in `apps/web/src/lib/ai/memory/__tests__/search-media.test.ts` for name/vision/transcript/tag scoring and limit.
- [ ] Implement `searchMediaAssets` in `apps/web/src/lib/ai/memory/search-media.ts`.
- [ ] Implement `deriveMediaTags` in `apps/web/src/lib/ai/memory/tags.ts` + tests.
- [ ] Add optional `tags?: string[]` to `MediaAssetData`; persist via existing `updateAssetMemory` path (extend if needed).
- [ ] Run `bun test apps/web/src/lib/ai/memory`.

### Task A2: Memory + timeline context + QA commands

- [ ] Add `register-memory-commands.ts` with:
  - `search_media`
  - `get_timeline_overview`
  - `get_timeline_detail`
  - `inspect_playhead` (reuse capture + optional vision describe; don’t force persist)
  - `assert_edit_quality` (lightweight checklist using overview + optional inspect)
- [ ] Wire registration in `core/index.ts`.
- [ ] On `describe_media` / `transcribe_media` success, refresh `tags`.
- [ ] Extend commands-api tests for `search_media`.
- [ ] Run `bun test apps/web/src/lib/commands-api`.

### Task A3: Agent prompt prefers search + hierarchy

- [ ] Update `SYSTEM_PROMPT` in `agent.ts` for `search_media`, overview/detail, QA.
- [ ] Manual smoke: ask agent for a clip by description in desktop/web with vision-filled assets.

---

## Stage B — Think then cut

### Task B1: Plan helpers + tools (TDD)

- [ ] Tests for parse/validate plan JSON and unmet criteria diff in `apps/web/src/lib/ai/agent/__tests__/plan.test.ts`.
- [ ] Implement helpers in `apps/web/src/lib/ai/agent/plan.ts`.
- [ ] Commands `propose_edit_plan`, `verify_edit_plan` (verify calls overview + optional inspect stub).
- [ ] Register in memory or new `register-agent-meta-commands.ts`.

### Task B2: Longer runs + checkpoints + skills

- [ ] `AI_AGENT_MAX_STEPS` env (default 24) in `agent.ts`; inject checkpoint notes every 6 tool rounds.
- [ ] Soft-stop after repeated verify failures (counter in loop state).
- [ ] Add 2–3 skill text files under `apps/web/src/lib/ai/skills/`.
- [ ] Commands `list_edit_skills`, `get_edit_skill`.
- [ ] Update system prompt for plan → act → verify and skills.
- [ ] Run unit tests.

---

## Stage C — Creator workflows

### Task C1: Filler + transcript delete ranges (TDD)

- [ ] Tests for filler range detection in `apps/web/src/lib/ai/speech/__tests__/filler.test.ts`.
- [ ] Implement `findFillerRanges` in `filler.ts`.
- [ ] Commands `get_transcript`, `delete_transcript_ranges`, `remove_filler_words` on shadow elements (map times → split/trim/delete via existing editor ops).
- [ ] Run speech + commands tests.

### Task C2: Highlights packager (TDD)

- [ ] Tests for `rankHighlights` in `apps/web/src/lib/ai/speech/__tests__/highlights.test.ts`.
- [ ] Implement ranking in `highlights.ts`.
- [ ] Commands `find_highlights`, `package_highlights` (place clips on shadow; optional captions).
- [ ] System prompt: interview → highlights / filler cleanup.
- [ ] Run full `bun test` for touched packages.

---

## Docs / AGENTS

- [ ] Note Phase 6 in `AGENTS.md` Learned Workspace Facts (memory search, plan/verify, transcript highlights).
- [ ] Keep Cursor plan file untouched per user rule.

## Demo checklist

1. Describe media → `search_media("…")` returns it.
2. “Clean up this talking head” → plan chip → filler/speech cuts → verify.
3. “Make 3 shorts” → `find_highlights` + `package_highlights` on shadow → Accept.
