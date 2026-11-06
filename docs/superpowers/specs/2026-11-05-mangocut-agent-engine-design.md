# Mangocut Agent Engine — Design

Date: 2026-11-05
Status: final draft, awaiting user approval
Supersedes the agent loop in `2026-09-29-mangocut-ai-agent-design.md` (the Command API and AI Preview ideas carry over; the loop, prompt and chat plumbing are replaced).

## 1. Intent

Mangocut's agent should take on long, multi-step creative jobs the way a coding agent takes on a feature: the user states the outcome, walks away, and comes back to a finished result staged in the AI Preview, ready to Accept or Reject.

Example jobs the user gave:

- **Beat-matched recreation.** Input: a YouTube URL or a local reference video with music, plus the user's own clips. The agent finds the beats and the reference's cut rhythm, then builds a similar edit from the user's clips on that beat grid. Work splits across parallel subagents (beat/timing analysis, clip selection, assembly).
- **Color grade exploration.** The agent renders several grade variations of the current edit, looks at them side by side, and picks or presents the best.
- Throughout: lots of trimming, frame grabs, looking at its own output, checking smoothness, trying crops, aspect ratios and layouts.

Why now: the current agent (`apps/web/src/lib/ai/agent.ts`) is a 24-step for-loop living in the React chat panel. It forgets tool results between turns, cannot save or resume sessions, has no compaction, no subagents, no permissions, and stops when the step cap hits whether or not the job is done.

The user picked opencode (github.com/anomalyco/opencode) as the reference because it is the strongest agent harness available and coding work maps closely onto video editing: an agent edits a working copy, the human reviews the diff, then accepts.

## 2. Goals, non-goals, anti-goals

### Goals

1. **Walk-away jobs.** User starts a job, leaves; the agent keeps working until the requested outcome is met, then notifies the user. No mid-run questions.
2. **Saved sessions.** Every session, message and tool result is persisted and survives window reload, app restart and crash. Interrupted jobs resume.
3. **Compaction.** Long jobs keep running when history outgrows the model's context window.
4. **Subagents.** A primary agent can spawn specialised child agents, in the foreground or in parallel in the background.
5. **Isolated variations.** Each parallel worker or variation edits its own copy of the timeline; the user compares and accepts one.
6. **The agent sees its own work.** Rendered frames, contact sheets and short clips are fed back to a vision model as first-class tool output.
7. **Everything stages in AI Preview.** The agent never writes the main timeline. The user Accepts or Rejects.
8. **Enterprise-tested core.** Reuse a proven harness rather than hand-rolling one.

### Non-goals (for this project)

- Running the new engine on the website. **Desktop only.** The website keeps today's simple chat and browser-storage projects.
- Output quality tuning. Rough edits are acceptable; quality improves in later iterations.
- Cost caps. Token spend is not a constraint.
- Cloud execution, multi-user collaboration, mobile.

### Anti-goal (the red line)

**A job that does not finish.** A finished edit that looks rough is acceptable. A job that stalls, gives up, loops without progress, crashes silently or ends with "I couldn't do this" when the tools provided could have done it is a failure even if every component works. Every design choice below is weighed against this.

## 3. Decisions made by the user

- Long-running walk-away jobs, as described in §1.
- Edits stage in AI Preview; Accept/Reject like a code diff.
- Desktop only.
- Tech choices delegated to the builder: "most efficient and long-term, enterprise-tested, opencode's method". Rewriting is acceptable.
- No cost limits.
- Completion over quality (anti-goal above).
- Approved the calls in §4 as stated in conversation.
- Timeline logic in Rust, per AGENTS.md (chosen over a TypeScript package after weighing both).

## 4. Architecture (builder's calls, approved by the user in conversation)

### 4.1 Use opencode's engine as a dependency, not a rewrite

`@opencode/sdk` (npm, MIT, v2.2.5 at time of writing) is an in-process opencode host. It runs on Node (core ships `node` export conditions for SQLite, pty, filesystem, image). It provides, already production-hardened:

- Sessions persisted to SQLite (`database: { path }`), with restart recovery (`SessionRestart.resumeSuspendedSessions` runs on host start).
- Streaming step runner with retry, output-limit continuation, context-overflow compaction (`session/compaction.ts`, hidden `compaction` agent).
- Agents (`Agent.Info`: `mode`, `system`, `model`, `steps`, `permissions`), tools, skills (`SKILL.md`), slash commands, permissions (`allow | ask | deny`, last-match-wins wildcard rules, `Permission.Unattended` for nobody-present runs).
- Subagents via the built-in `subagent` tool (child sessions, foreground or background, follow-ups by `sessionID`).
- Goal loop (`core/src/plugin/goal.ts`): kickoff prompt, reviewer "judge" each time the session would go idle (`done | continue | blocked | paused | wait`), continuation with the judge's `next_step`, `MAX_ROUNDS = 50`, `MAX_STALLS = 3`, evidence-only judging.
- Per-step file snapshots (`Snapshot` service), available only when the Location is a git repository. Not relied on here (see §4.4).
- Event bus and typed client (`@opencode/client`) for UIs.

Mangocut integrates as **one opencode plugin** written against the Promise plugin API (`@opencode/plugin`). Plugin code is async/await, not Effect; tool input schemas may be zod v4 (opencode validates any Standard Schema; `core/src/tool/runtime.ts:76`). `effect` becomes a peer dependency at opencode's version.

We pin an exact opencode version and upgrade deliberately. We do not fork unless forced; if a patch is needed, carry it as a `patches/` entry with an upstream PR.

### 4.2 Process layout

```
Electron main (apps/electron/src/main.js)
 ├─ BrowserWindow → Next standalone UI (existing)
 └─ utilityProcess "mangocut-engine"  (new, Node)
       @opencode/sdk host, SQLite at <userData>/engine/sessions.db
       HTTP listener on 127.0.0.1:<random port>, per-launch password
       Mangocut plugin loaded
```

- Mirrors opencode's own desktop app, where the window is a client of a background service.
- The engine outlives window reloads. If the app quits mid-job, the job resumes on next launch via restart recovery (see §6 for goal-loop resume semantics).
- Main passes the port and password to the renderer over the existing preload bridge. The renderer talks to the engine with `@opencode/client` (HTTP + event stream).
- A desktop notification fires (from main, on an engine event) when a goal reaches `done` or `blocked`.

### 4.3 Projects move to disk (desktop)

Today projects live in the renderer's IndexedDB/OPFS (`apps/web/src/services/storage/`), which the engine cannot reach. On desktop they move to the filesystem:

```
~/Mangocut/Projects/<projectId>/
  project.json             # TProject — the MAIN timeline. Written only by the renderer.
  media/<assetId>.<ext>    # original imports (never modified by the agent)
  media/index.json         # MediaAssetData records
  .mangocut/
    branches/<branchId>/project.json   # AI Preview working copies. Written only by the engine.
    branches/<branchId>/meta.json      # parent session, label, base revision, status
    renders/                           # frames, contact sheets, preview clips, grades
    cache/                             # transcripts, beat maps, vision tags, probes
```

- Add a filesystem storage adapter beside the existing IndexedDB/OPFS adapters, selected when running in the desktop app. File IO goes through Electron main IPC (renderer) and plain `fs` (engine).
- One-time migration copies existing desktop IndexedDB/OPFS projects to disk.
- The project directory is the opencode **Location** for that project's sessions. Branch history is kept by Mangocut itself (§4.4), not by opencode snapshots.
- Single-writer rule: the renderer owns `project.json`; the engine owns `.mangocut/**`. No file has two writers. This removes the need for locking or merge on concurrent writes.

### 4.4 Branches replace the in-memory shadow timeline

The current `ShadowManager` (one in-memory clone of `SceneTracks`) is replaced by on-disk **branches**:

- A branch is a full copy of `project.json` plus metadata, created from the main timeline's current revision.
- **Branch binding is plugin-managed** (builder's call). opencode's `subagent` tool creates child sessions in the parent's Location and does not use the worktree driver, so the Mangocut plugin keeps a `session → branchId` map in plugin storage. A session's edit tools always act on its bound branch. The director binds a new branch to each variation subagent with `branch_create` before spawning it (tool input `branchId`, or a `mc_bind_branch` step the subagent runs first). Every edit appends a revision under `branches/<id>/revisions/` so `branch_diff` and per-step undo work without git. The opencode worktree driver is not used.
- The AI Preview panel lists branches for the active session (one per variation), shows each, and offers **Accept** (renderer applies the branch's scenes to main as one undoable `TracksSnapshotCommand`-style command and writes `project.json`) or **Reject** (branch marked discarded, files kept until cleanup).
- Media the agent creates (renders, grades, downloads) lives under `.mangocut/renders/` and is referenced by branch timelines; it only becomes part of the main project's media index on Accept. This fixes today's leak where `apply_grade` and `import_media_paths` persist assets before Accept.
- If main changes after a branch was created, the branch records its `baseRevision`; Accept applies the branch's scene state wholesale and warns that manual edits made to main since the branch was cut will be overwritten (same semantics as today's divergence guard, made explicit). Three-way merge is out of scope.

### 4.5 Timeline logic becomes a Rust crate (user's decision)

The engine must edit timelines without a browser. Timeline operations currently sit in `apps/web/src/lib/timeline`, `lib/commands-api/register-*-commands.ts` and the `EditorCore` managers, mixed with React stores and DOM APIs. Per AGENTS.md and the user's decision, they move into Rust.

- New crate **`rust/crates/timeline`**: the project/scene/track/element model (serde), validation of invariants (no illegal overlaps, trims within source bounds, valid tracks per element type), and pure operations: insert, trim, split, move, delete, ripple, retime, transform/crop, canvas/aspect, text, effects, masks, layout presets, batch apply. Operations take a project (or scene) and return a new one plus a structured change summary; no hidden state.
- The ffmpeg **preview filter-graph generator** (§5.2 seeing tools) also lives in this crate, so engine renders derive from the same model.
- Exposed through the existing `bridge` `#[export]` macro. TypeScript types are generated with `tsify-next` (already used by `rust/crates/time`); hand-written TS timeline types are replaced by the generated ones.
- **Two WebAssembly builds:**
  - Browser: the existing `mangocut-wasm` (`rust/wasm`) adds the timeline exports.
  - Node: a new, GPU-free build (`rust/wasm-node` or a cargo feature that excludes `gpu`/`web-sys`) loaded by the engine utility process. Native napi add-ons are not used.
- **Build from source in this repo.** `apps/web` currently consumes the published `opencut-wasm@^0.2.5` from npm. Both wasm builds switch to local workspace builds (wasm-pack), wired into the dev and Electron packaging scripts, so Rust changes reach the renderer and engine without a publish step.
- **Renderer integration:** `EditorCore` calls wasm operations for every timeline mutation. Undo wraps each call as a before/after snapshot command (the existing `TracksSnapshotCommand` pattern), so the undo system does not need to understand individual operations.
- Migration is incremental per operation, behind the same call sites, with parity tests comparing the old TS operation and the Rust one on recorded fixtures until the TS version is deleted. Agent tools only ever call the Rust operations.

### 4.6 Models

- Provider (builder's call): the desktop app already runs its own local Next server on `127.0.0.1:3045`, which holds `OPENROUTER_API_KEY` from the bundled or userData `.env` and runs Better Auth locally. That local server gains a **streaming, OpenAI-compatible passthrough** (`/api/ai/openai/v1/chat/completions`, SSE). The engine registers it as an opencode provider through `ctx.provider.transform` and authenticates with a per-launch secret that Electron main passes to both processes. No hosted token system is built.
- Metering (builder's call): today's per-chat-turn trial counter (`AI_TRIAL_CHAT_TURNS`) would cut a walk-away job off mid-run, which is the anti-goal. Desktop jobs therefore check entitlement **once at job start**; model calls inside a running job, its subagents and its judge are never refused for quota. Per-job trial accounting is deferred.
- Primary and judge models must accept image input. Default: a strong vision-capable model chosen via `ctx.model.transform`; subagents may use cheaper models per agent definition.

## 5. The Mangocut plugin

### 5.1 Agents

| id | mode | role |
|---|---|---|
| `director` | primary (default) | Owns the user's job. Plans, delegates, assembles, verifies, reports. |
| `analyst` | subagent | Read-only analysis: probe media, beats/tempo, shot boundaries, cut rhythm of a reference, transcripts, vision tags. Writes only to `.mangocut/cache`. |
| `assembler` | subagent | Builds or edits a branch timeline from a spec (beat grid + clip choices). |
| `colorist` | subagent | Produces grade variations on its own branch, renders comparisons. |
| `critic` | subagent | Reviews renders against the objective; returns concrete fix list. Read-only. |
| hidden: `compaction`, `title`, `summary` | opencode built-ins | unchanged |

opencode's coding agents (`build`, `plan`, `explore`, `general`) are removed or hidden via `ctx.agent.transform`.

Each agent's `permissions` ruleset denies opencode's coding tools (`shell`, `edit`, `write`, `patch`, `webfetch`, `websearch`, `read` outside the project) and allows its own Mangocut tool set. Subagent recursion depth is capped at 2.

### 5.2 Tools

Namespace `mc_` (opencode flattens `<namespace>_<tool>`). Every tool takes zod input, returns structured output plus model content, and follows the reliability contract in §6.1.

- **Project & media:** `project_summary`, `timeline_overview`, `timeline_detail`, `media_list`, `media_probe` (ffprobe), `media_import` (local paths into `.mangocut/renders` or media inbox), `fetch_reference` (YouTube/URL via bundled `yt-dlp`, into `.mangocut/cache/refs`).
- **Branches:** `branch_create`, `branch_list`, `branch_diff` (structured diff vs main), `branch_label`. (Each session edits the branch it is bound to; see §4.4.)
- **Timeline edits (on the session's branch):** `place_clip`, `trim`, `split`, `move`, `delete`, `ripple_delete`, `set_speed`, `set_transform` (crop/scale/position), `set_canvas` (aspect ratio/size), `add_text`, `add_effect`, `apply_grade` (bakes the grade with ffmpeg into a new media file under `.mangocut/renders/` and swaps it onto the branch element, so the result plays and exports in the editor unchanged; see §5.4), `arrange_layout` (grid/PiP presets), `batch_edit` (apply a list of ops atomically).
- **Analysis:** `detect_beats` (onsets, tempo, downbeats), `detect_shots` (scene cuts), `reference_rhythm` (cut times and lengths vs beats in a reference), `transcribe` (existing local Whisper), `find_speech_ranges`, `vision_tag` (stored tags, reusing Phase 6 memory), `search_media`.
- **Seeing:** `render_frame` (time → PNG of the branch composite), `render_contact_sheet` (N frames tiled), `render_clip` (low-res preview MP4 of a range), `compare_grid` (same frame across several branches), `motion_check` (frame-difference/jank metrics for smoothness). Image results are returned as image content so the model sees them directly.
- **Output:** `export_preview` (full low-res render of a branch for the judge and the user).
- **Skills:** opencode's `skill` tool over `SKILL.md` packs: `beat-match-recreation`, `grade-exploration`, `talking-head-cleanup`, `highlight-reel`, `broll-pace` (the last three migrated from today's `.txt` packs).

Engine-side rendering uses ffmpeg with a filter graph generated from the branch timeline by the Rust timeline crate. It is a preview renderer for the agent's eyes and the judge; the renderer's GPU compositor stays authoritative for playback and final export. Divergence between the two is acceptable for this project as long as cuts, timing, crops and grades are recognisable.

### 5.3 Rust (AGENTS.md)

Timeline model, operations and preview render-graph generation are Rust (§4.5), per the user's decision. The opencode host, the Mangocut plugin and its tools stay TypeScript because opencode plugins are in-process TypeScript; tools are thin adapters that validate input, call the Rust operation through wasm, persist the branch, and shape the result for the model. Analysis helpers (beat/shot detection) may be Rust or external binaries; left to the builder.

### 5.4 Grades (builder's call)

The editor's effect system has only blur today; GPU compositing lives in `rust/crates/compositor`, `effects`, `gpu` via `mangocut-wasm`. A non-destructive GPU colour-grade effect is out of scope for this project. Grades are baked by ffmpeg into new media files (as today's `apply_grade` does), referenced by the branch, and promoted into the project's media index on Accept. Accepted grades therefore play and export in the real editor with no Rust change. A GPU grade effect is a later project.

## 6. Making jobs finish (the anti-goal)

### 6.1 Tool reliability contract

- Inputs validated at the boundary; validation errors name the field and the allowed values so the model can retry.
- Failures are typed and **actionable**: what failed, why, and what to try next (e.g. "clip m_12 is 3.2s, requested trim end 4.0s exceeds it; max is 3.2s"). No bare exceptions reach the model.
- Idempotent where possible (`batch_edit` atomic; re-running `render_frame` overwrites the same cache key).
- Long work (renders, downloads, transcription, beat detection on long audio) reports progress through opencode tool progress metadata and is resumable from cache.
- Preflight on engine start and on job start: ffmpeg, ffprobe, yt-dlp present; provider reachable; models support images; disk space. A failed preflight blocks the job with a clear message before any work starts, instead of failing mid-run.

### 6.2 Goal loop

- Jobs start as opencode goals (`/goal <objective>` or a "Start job" button). opencode's goal plugin drives kickoff → work → judge → continue.
- Mangocut overrides the kickoff/continuation/judge prompts (or wraps the plugin) so "evidence" means **rendered output the judge can see**: the final `export_preview`, contact sheets, `branch_diff`, beat-alignment reports. A claim without a render is not evidence.
- `blocked` is only legitimate for things no tool can do (missing file the user must supply, unreadable media). The director's prompt and the judge's rules both say so.
- Rounds: opencode default `MAX_ROUNDS = 50`, `MAX_STALLS = 3`. Raised if the acceptance suite shows 50 is too low for the reference jobs.
- Unattended permissions: jobs run with `Permission.Unattended` rules so nothing ever waits on an `ask`. Allowed: Mangocut tools on the project directory and on folders the user picked when starting the job. Denied: everything else.
- opencode's goal plugin ends every non-`done` outcome as `paused` with a reason: restart, round limit, 3 stalls, unusable judge verdict, judge overflow, judge `blocked`/`paused`/`wait`, or background work idle past 30 minutes. A Mangocut **job supervisor** (builder's call) watches goal state and acts on the reason:
  - restart, round limit, stall, unusable/overflowing judge, wait timeout → **re-arm** the goal after a compaction and a `critic` pass that writes a fresh strategy into the continuation. Up to 4 re-arms per job (≈250 rounds), then notify as stopped with the critic's report.
  - judge `blocked` → notify as blocked with the reason (a real missing input). Not re-armed.
  - user pause/stop → stay paused.
  - The supervisor maps these to the notifications `done`, `blocked`, `stopped`. Whether this wraps or forks opencode's goal plugin is left to the builder.

### 6.3 Acceptance suite (definition of done for the project)

Checked-in fixtures (short, license-clean reference track and clips) and scripted end-to-end jobs run headless against the engine:

1. Beat-matched recreation from a local reference video and a folder of clips.
2. Same, from a URL reference (network test, can be skipped offline).
3. Grade exploration producing ≥3 variations with a comparison grid and a pick.
4. A layout job: change aspect ratio to 9:16, reframe clips, arrange a 2-up layout.
5. Kill the engine mid-job; restart; job resumes and finishes.

Pass criterion: each job reaches judge verdict `done` (re-arms by the supervisor allowed, user intervention not) with a branch containing the expected structure (e.g. cut points within ±1 frame of detected beats for job 1; ≥3 branches for job 3), in **5 of 5 consecutive runs** per job. Output quality is not graded.

Plus `cargo test` for the Rust timeline crate operations, TS/Rust parity tests during migration, the filesystem storage adapter, branch Accept/Reject, and every tool's error paths.

## 7. UI changes (renderer)

- Chat panel becomes an opencode client: session list (resume old sessions), live streaming text and tool chips from the event feed, subagent tree, goal status (rounds, last verdict, next step), stop button.
- AI Preview panel: branch list per session, view any branch, side-by-side compare, Accept / Reject.
- Job start: objective text, optional reference (file or URL), optional source folders, model picker.
- Notifications on `done` / `blocked`.
- Today's `runAgentTurn`, `/api/ai/chat` desktop path and `ShadowManager` are removed on desktop. The website keeps them.

## 8. Migration of existing code

- `lib/commands-api` handlers: logic moves into the Rust timeline crate operations and Mangocut tools. The Command API remains for UI actions (keyboard shortcuts etc.) on the renderer.
- Electron `ai/ipc.js` ffmpeg/fs handlers move into the engine (ffmpeg runs in the engine process).
- Phase 2/6 features (Whisper transcription, filler removal, highlights, search_media/tags) are re-exposed as tools; their pure logic moves into the Rust timeline crate or an `engine/analysis` module.

## 9. Constraints

- Electron must ship a Node version that satisfies opencode's Node requirement (`node:sqlite`); bump Electron if 35.7.5 does not.
- Bundle `ffmpeg`, `ffprobe`, `yt-dlp` binaries with the desktop app (today ffmpeg is discovered on PATH).
- Respect existing branding (Mangocut), Better Auth entitlements, and the push-to-`main` workflow.
- Copyright of fetched references is the user's responsibility; no extra gating.

## 10. Left to the builder

- Exact phasing and order of work (suggested: local wasm build pipeline → Rust timeline crate with parity tests → engine host + provider → disk storage → branches + Accept/Reject → tools → goal integration → UI → acceptance suite).
- Beat/shot detection implementation (e.g. aubio/essentia binaries vs JS/WASM onset detection).
- ffmpeg filter-graph generation details and preview resolution.
- Default model ids per agent.
- Branch cleanup policy.
- Whether to wrap or fork opencode's goal plugin to change its prompts.
