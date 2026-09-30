# Mangocut AI Phase 6 — Memory, Agentic Planning & Speech Workflows

**Date:** 2026-09-30  
**Status:** Approved (roadmap)  
**Product:** Mangocut (Electron + web AI)

## Goal

Make Mangocut AI reliably powerful: it **finds the right media**, **plans then verifies edits**, and ships **transcript / highlight workflows** creators expect from Descript and CapCut — without abandoning Command API + shadow Accept/Reject + manual editability.

Phase 6 unifies three workstreams that compound:

| Track | Name | Outcome |
|---|---|---|
| **A** | See & remember | Semantic media search, richer memory, hierarchical timeline context, visual QA tools |
| **B** | Think then cut | Plan → Act → Critic agent loop, longer runs with checkpoints |
| **C** | Creator workflows | Transcript-first edits, highlight / Shorts packaging |

## Non-goals (Phase 6)

- Generative multi-shot “make a whole film” (Runway-style gen)
- Automatic multicam / speaker diarization
- Keyframe animation graph, Remotion codegen, paid billing
- Changing Accept/Reject to agent-owned (still UI-only)

## Locked decisions

1. **All new capabilities are Command API tools** (UI + agent), mutations still `target: "shadow"`.
2. **Memory stays on `MediaAssetData`** (vision + transcript already); extend with searchable tags / keywords derived from those fields — no separate vector DB in v1 (lexical + simple scoring is enough).
3. **Agent remains text-primary**; images only via existing `describe_media` / new QA capture that reuses vision API.
4. **Plan/Critic are agent-loop modes**, not separate cloud services.
5. **Highlights create new shadow timeline structure** (clips / optional new scene), user Accepts.
6. **Desktop FS/ffmpeg stay desktop-only**; Tracks A–C work on web for in-project media.

## Track A — See & remember

### A1. Semantic media search

Command: `search_media`

```ts
{
  query: string;
  limit?: number; // default 8
}
```

Score assets by overlap of `query` tokens against:

- asset name
- `vision.summary` + frame descriptions
- transcript segment text
- optional derived `tags[]` (populated when vision/transcript updates)

Return ranked `{ mediaId, name, score, snippet, reasons[] }`.

### A2. Memory enrichment on describe/transcribe

When `describe_media` / `transcribe_media` persist, also refresh lightweight `tags` / `keywords` on the asset (top nouns/phrases — heuristic or model-returned tags in vision summary prompt). Keep schema additive:

```ts
MediaAssetData.memory?: {
  tags?: string[];
  updatedAt?: string;
};
```

(Or fold tags into `vision` / top-level `tags` — prefer top-level `tags?: string[]` for search simplicity.)

### A3. Hierarchical timeline context

Commands:

- `get_timeline_overview` — scenes, track counts, duration, element counts, bookmarks
- `get_timeline_detail` — optional `elementId` / time window → clip-level fields (mediaId, in/out, text)

Extend `get_project_summary` only lightly (keep small); push depth into these drill-down tools so the 12→N step budget isn’t wasted on giant blobs.

### A4. Visual QA

Commands:

- `inspect_playhead` — capture current preview frame(s) at playhead (or `timeSeconds`), optionally run vision with a QA prompt, return description (persist optional)
- `assert_edit_quality` — args: checklist strings; agent uses after cuts; implementation = inspect + structured pass/fail hints (heuristic: black frame / empty timeline / missing media)

## Track B — Think then cut

### B1. Plan → Act → Critic loop

In `runAgentTurn` / agent orchestration:

1. **Plan step** (optional when user intent is multi-edit): model produces a short JSON plan `{ steps: string[], successCriteria: string[] }` without tools — or via tool `propose_edit_plan`.
2. **Act**: existing tool loop.
3. **Critic**: after act (or every K tools), call `inspect_playhead` / re-read summary; if criteria fail, continue acting with repair instructions.

Expose tool `propose_edit_plan` (records plan in chat chips) and `verify_edit_plan` (runs QA + returns unmet criteria).

### B2. Longer runs + checkpoints

- Raise default max steps from **12 → 24** (configurable `AI_AGENT_MAX_STEPS`).
- Every N tools (e.g. 6), inject a compact checkpoint system note: current plan progress + shadow divergence reminder.
- Soft stop: if critic fails twice on same criterion, ask user in assistant text (don’t infinite loop).

### B3. Edit skills (lightweight)

Markdown/JSON skill packs under `apps/web/src/lib/ai/skills/` (like grades):

- `talking-head-cleanup`
- `highlight-reel`
- `broll-pace`

Command: `list_edit_skills`, `get_edit_skill` — returns instructions the agent should follow. No separate runtime; prompt injection via tool result.

## Track C — Creator workflows

### C1. Transcript-first editing

Commands:

- `get_transcript` — `{ mediaId }` or timeline `elementId` → segments
- `delete_transcript_ranges` — `{ elementId, ranges: { start, end }[] }` → ripple-trim/split/delete corresponding media regions on shadow (map transcript time → element source time)
- `remove_filler_words` — heuristic list (um, uh, like) using transcript; emits delete ranges

Build on `speech-ranges.ts` + existing split/trim/delete commands.

### C2. Highlight / Shorts packager

Commands:

- `find_highlights` — `{ mediaId, maxClips?, targetSeconds? }` → ranked `{ start, end, score, quote }` from transcript (+ optional vision energy later)
- `package_highlights` — place top highlights onto shadow timeline (optionally stack captions via `insert_captions`), suggest 9:16 note in result (canvas aspect may be project setting)

Scoring v1: segment length + keyword hits (question marks, “important”, laughter proxies) + gap boundaries; no ML ranker required.

## Agent system prompt updates

- Prefer `search_media` before `place_media` when user describes content.
- Prefer overview → detail drill-down.
- For multi-step asks: `propose_edit_plan` then act then `verify_edit_plan`.
- For talking-head: offer filler removal / cut_on_speech / highlights.

## Success criteria

1. Agent finds a clip by description (“ocean at sunset”) via `search_media` without filename knowledge.
2. Multi-step request produces a plan chip, edits shadow, runs QA, and either passes or reports unmet criteria.
3. User can ask “remove ums” or “make 3 Shorts from this interview” and get shadow timeline changes ready to Accept.
4. Unit tests cover search scoring, highlight ranking, filler ranges, and plan verify helpers.
5. Web + desktop both work for in-project media; FS/ffmpeg unchanged.

## Rollout order

Ship **A → B → C** in one Phase 6 plan so each stage is demoable alone, but one roadmap item.
