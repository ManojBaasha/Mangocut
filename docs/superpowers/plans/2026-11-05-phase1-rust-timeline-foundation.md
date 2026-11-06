# Phase 1: Rust Timeline Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the timeline data model and the core edit operations into a new Rust crate, built from source into a browser wasm package and a Node wasm package, at proven parity with today's TypeScript, with the renderer running those operations through wasm.

**Architecture:** `rust/crates/timeline` holds serde types that match the serialized project JSON exactly and one pure entry point, `apply_op(tracks, op, new_ids) -> OpOutput | TimelineError`. A bun script runs today's TS commands on recorded fixtures to produce golden files; cargo tests replay them against Rust. `rust/wasm` gains a `browser` feature (GPU, compositor) so the same crate builds a GPU-free Node package for the agent engine. Renderer commands keep their undo snapshots and call wasm for the mutation.

**Tech Stack:** Rust 2024 edition, serde/serde_json, tsify-next 0.5, wasm-bindgen 0.2, wasm-pack; Bun 1.2 tests; existing `bridge` `#[export]` macro.

**Spec:** `docs/superpowers/specs/2026-11-05-mangocut-agent-engine-design.md` (§4.5, §5.3). Roadmap: `docs/superpowers/plans/2026-11-05-agent-engine-roadmap.md`.

## Global Constraints

- Brand is Mangocut; the npm package `opencut-wasm` alias may remain only as the published fallback name.
- `#[export]` functions take a single options struct (`rust/crates/bridge/src/bridge.rs:29-39` rejects positional args).
- Time values are integer ticks, `TICKS_PER_SECOND = 120_000` (`rust/crates/time/src/media_time.rs:10`). Rust stores them as `i64`; JSON numbers in fixtures are integers.
- Retime rate clamp: default `1`, min `0.01`, max `5` (`apps/web/src/lib/retime/rate.ts`).
- No DOM, React, Zustand, Next or Electron in `rust/crates/timeline`.
- Rust ops never generate IDs. Callers pass `new_ids: Vec<String>`, consumed in order; running out is a `TimelineError` with code `missing_ids`.
- On-disk JSON shape is `SerializedProject` (`apps/web/src/services/storage/types.ts:62-79`): dates are ISO strings.
- Push straight to `main` is the repo norm; this plan's commits land on the working branch and are merged as a unit.

## Review Focus

- **Unknown fields in old projects.** Projects saved by older versions may carry fields the Rust structs don't name. They must survive a load/apply/save round trip unchanged. Pinned in Task 2 (`round_trip_preserves_unknown_fields`).
- **Elements with animations, effects, masks or graphic params.** These stay opaque JSON in Rust, but split must still split keyframes. Pinned in Task 6 (`split_keeps_keyframes_on_correct_side` golden).
- **Edits at exact boundaries.** Split at an element's start or end, trim to zero, move onto an occupied span. TS returns the input unchanged or places on a new track; Rust must match. Pinned in Tasks 5–7 with boundary goldens.
- **Bad op input from the agent.** Unknown element/track IDs, wrong element type for a track, negative durations. Must return a typed `TimelineError` with a hint, never panic across wasm. Pinned in Task 8 (`errors_are_typed_not_panics`).
- **The Node build running without a browser.** The engine loads the Node package in plain Node; any `web-sys` leak crashes at import. Pinned in Task 9 (`node_smoke.test.ts`).

---

### Task 1: Toolchain and local wasm builds

**Files:**
- Modify: `Cargo.toml` (workspace members)
- Create: `rust/crates/timeline/Cargo.toml`, `rust/crates/timeline/src/timeline.rs`
- Modify: `rust/wasm/Cargo.toml`, `rust/wasm/src/wasm.rs`
- Modify: `package.json` (root scripts), `apps/web/package.json` (`mangocut-wasm` dependency)
- Modify: `.github/workflows/bun-ci.yml`
- Create: `rust-toolchain.toml`

**Interfaces:**
- Produces: `bun run build:wasm` → `rust/wasm/pkg` (browser, `--target bundler`, features `browser`); `bun run build:wasm:node` → `rust/wasm/pkg-node` (`--target nodejs`, no default features). `apps/web` depends on `"mangocut-wasm": "file:../../rust/wasm/pkg"`. Crate `timeline` with feature `wasm` (mirrors `rust/crates/time/Cargo.toml`).

- [ ] **Step 1: Install the toolchain.** `rustup` (stable), target `wasm32-unknown-unknown`, `wasm-pack`, `cargo-watch`. Pin in `rust-toolchain.toml`: channel `stable`, targets `["wasm32-unknown-unknown"]`.
  Run: `cargo --version && wasm-pack --version && rustup target list --installed`
  Expected: versions print; `wasm32-unknown-unknown` listed.
- [ ] **Step 2: Gate GPU modules behind a `browser` feature.** In `rust/wasm/Cargo.toml`: `[features] default = ["wasm", "browser"]`, `browser = ["dep:gpu", "dep:compositor", "dep:effects", "dep:masks", "dep:web-sys"]`; make those deps `optional = true`; add `timeline = { path = "../crates/timeline", features = ["wasm"] }`. In `wasm.rs`, change each `#[cfg(target_arch = "wasm32")]` to `#[cfg(all(target_arch = "wasm32", feature = "browser"))]` and add `pub use timeline::*;`.
- [ ] **Step 3: Create the empty `timeline` crate** (`crate-type = ["rlib"]`, deps: `bridge`, `serde` derive, `serde_json`, `time` path dep, optional `wasm-bindgen`, `tsify-next`, `serde-wasm-bindgen`), registered in the workspace `members`.
- [ ] **Step 4: Add scripts.** Root `package.json`: `"build:wasm": "wasm-pack build rust/wasm --target bundler --out-dir pkg"` (unchanged), `"build:wasm:node": "wasm-pack build rust/wasm --target nodejs --out-dir pkg-node -- --no-default-features --features wasm"`, `"build:wasm:all": "bun run build:wasm && bun run build:wasm:node"`. Prefix `build:web`, `build:web:electron` and `dev:web` with `bun run build:wasm:all &&`.
- [ ] **Step 5: Point the web app at the local build.** `apps/web/package.json`: `"mangocut-wasm": "file:../../rust/wasm/pkg"`. Run `bun install`.
- [ ] **Step 6: CI.** In `bun-ci.yml` add `dtolnay/rust-toolchain@stable` with `targets: wasm32-unknown-unknown`, `jetli/wasm-pack-action@v0.4.0`, then `bun run build:wasm:all` and `cargo test --workspace` before the bun steps.
- [ ] **Step 7: Verify nothing regressed.**
  Run: `bun run build:wasm:all && cargo test --workspace && bun test && bun run build:web`
  Expected: both pkgs built; all existing tests pass; web build succeeds; `rust/wasm/pkg-node/mangocut_wasm.js` contains no `web_sys`/`OffscreenCanvas` imports (`grep -c OffscreenCanvas` → 0).
- [ ] **Step 8: Commit** — `chore(rust): build wasm from source with browser and node targets`.

### Task 2: Timeline model types

**Files:**
- Create: `rust/crates/timeline/src/model.rs`
- Create: `rust/crates/timeline/tests/fixtures/projects/*.json`
- Create: `rust/crates/timeline/tests/model_round_trip.rs`
- Create: `apps/web/scripts/timeline-parity/export-fixture-projects.ts`

**Interfaces:**
- Produces (all `#[serde(rename_all = "camelCase")]`, tsify-derived under `wasm`): `Project`, `ProjectMetadata`, `ProjectSettings`, `CanvasSize`, `Background` (tag `type`: `color{color}` | `blur{blurIntensity}`), `Scene`, `Bookmark`, `SceneTracks { overlay: Vec<OverlayTrack>, main: VideoTrack, audio: Vec<AudioTrack> }`, `TimelineTrack` (tag `type`: video|text|audio|graphic|effect), `TimelineElement` (tag `type`: audio|video|image|text|sticker|graphic|effect), `AudioElement` with `sourceType` upload|library, `Transform { scaleX, scaleY, position: {x,y}, rotate }`, `BlendMode` (kebab-case literals from `apps/web/src/lib/rendering.ts:11`), `RetimeConfig { rate: f64, maintainPitch: Option<bool> }`, `ElementRef { trackId, elementId }`.
- Field set and optionality copy `apps/web/src/lib/timeline/types.ts:1-270` and `lib/project/types.ts`. `animations`, `effects`, `masks`, `params`, `background` of text are `serde_json::Value` (opaque). `buffer` on audio elements is runtime-only and never serialized (skip).
- Every struct carries `#[serde(flatten)] extra: serde_json::Map<String, Value>` so unknown fields round-trip.

- [ ] **Step 1: Export fixtures.** `export-fixture-projects.ts` loads ≥3 real projects (one with keyframes, one with effects/masks, one with audio + text) via `storageService.loadProject` in the running app's devtools or from a saved export, and writes `SerializedProject` JSON into `tests/fixtures/projects/`. Add a fourth, hand-written `unknown-fields.json` with an extra top-level and element-level key.
- [ ] **Step 2: Write the failing test.**
  ```rust
  #[test] fn round_trip_is_lossless() {
      for path in fixture_paths("projects") {
          let raw: Value = read_json(&path);
          let project: Project = serde_json::from_value(raw.clone()).unwrap();
          assert_eq!(serde_json::to_value(&project).unwrap(), raw, "{path:?}");
      }
  }
  #[test] fn round_trip_preserves_unknown_fields() {
      let raw = read_json("projects/unknown-fields.json");
      let out = serde_json::to_value(serde_json::from_value::<Project>(raw.clone()).unwrap()).unwrap();
      assert_eq!(out["futureField"], raw["futureField"]);
      assert_eq!(out["scenes"][0]["tracks"]["main"]["elements"][0]["futureElementField"],
                 raw["scenes"][0]["tracks"]["main"]["elements"][0]["futureElementField"]);
  }
  ```
- [ ] **Step 3: Run** `cargo test -p timeline --test model_round_trip` → FAIL (types missing).
- [ ] **Step 4: Implement `model.rs`.** `Option` fields use `skip_serializing_if = "Option::is_none"` so absent stays absent.
- [ ] **Step 5: Run** the same command → PASS.
- [ ] **Step 6: Commit** — `feat(timeline): serde model matching serialized projects`.

### Task 3: Parity harness

**Files:**
- Create: `apps/web/scripts/timeline-parity/harness.ts` (stubbed editor + deterministic IDs)
- Create: `apps/web/scripts/timeline-parity/generate.test.ts` (writes goldens)
- Create: `rust/crates/timeline/tests/fixtures/goldens/` (generated, committed)
- Create: `rust/crates/timeline/tests/parity.rs`

**Interfaces:**
- Produces: golden file format `{ "name": string, "input": SceneTracks, "op": TimelineOp, "newIds": string[], "expected": SceneTracks | null }` (`null` = TS made no change). `harness.ts` exports `runTsOp({ tracks, op, newIds }): SceneTracks | null`, which `mock.module`s `@/core` with an `EditorCore.getInstance()` stub exposing `scenes.getActiveScene().tracks`, `timeline.updateTracks(t)`, `media.getAssets() → []`, `project.getActive()`, `project.updateSettings()` (no-op), and mocks `@/utils/id` `generateUUID` to shift from `newIds`. It maps each `TimelineOp` variant to the TS command class listed in Task 4–7 and calls `execute()`.
- Produces: `parity.rs` helper `fn assert_golden(name_prefix: &str)` that loads every golden whose name starts with the prefix, runs `apply_op`, and asserts `output.tracks == expected` (or `Unchanged` when `null`).
- The `TimelineOp` serde shape is defined in Task 4 Step 3; the harness reads the same JSON.

- [ ] **Step 1: Implement `harness.ts` and a generator test** that, for each case listed in Tasks 4–7 (`cases.ts` grows per task), writes `goldens/<name>.json`. Run: `bun test apps/web/scripts/timeline-parity` → writes files.
- [ ] **Step 2: Write `parity.rs` with `assert_golden`.** No cases yet; the file compiles once Task 4 lands `apply_op`.
- [ ] **Step 3: Commit** — `test(timeline): TS→Rust parity harness`.

### Task 4: Op entry point, retime math and placement

**Files:**
- Create: `rust/crates/timeline/src/ops.rs`, `src/error.rs`, `src/retime.rs`, `src/placement/{mod,compatibility,overlap,insert_index,main_track,track_factory,resolve,apply}.rs`
- Modify: `apps/web/scripts/timeline-parity/cases.ts`
- Test: `rust/crates/timeline/tests/parity.rs`, unit tests inline in `retime.rs`

**Interfaces:**
- Produces:
  ```rust
  #[serde(tag = "type", rename_all = "camelCase")]
  pub enum TimelineOp {
      InsertElement { element: Value /* CreateTimelineElement */, placement: InsertPlacement },
      SplitElements { elements: Vec<ElementRef>, split_time: i64, retain_side: RetainSide },
      TrimElement { element_id: String, trim_start: i64, trim_end: i64, start_time: Option<i64>, duration: Option<i64> },
      RetimeElement { track_id: String, element_id: String, retime: Option<RetimeConfig> },
      MoveElement { source_track_id: String, target_track_id: String, element_id: String, new_start_time: i64, create_track: Option<CreateTrack> },
      DeleteElements { elements: Vec<ElementRef> },
      DuplicateElements { elements: Vec<ElementRef> },
      UpdateElements { updates: Vec<ElementUpdate> }, // { trackId, elementId, patch: Value }
      AddTrack { track_type: TrackType, index: Option<usize> },
      RemoveTrack { track_id: String },
      ToggleTrackMute { track_id: String },
      ToggleTrackVisibility { track_id: String },
      Batch { ops: Vec<TimelineOp> },
  }
  pub enum InsertPlacement { Explicit { track_id: String }, Auto { track_type: Option<TrackType>, insert_index: Option<usize> } } // tag "mode"
  pub enum RetainSide { Both, Left, Right }
  pub struct ApplyOpOptions { pub tracks: SceneTracks, pub op: TimelineOp, pub new_ids: Vec<String>, pub ripple: bool }
  pub struct OpOutput { pub tracks: SceneTracks, pub changed: bool, pub select: Vec<ElementRef>, pub created: Vec<ElementRef>, pub summary: String }
  pub struct TimelineError { pub code: String, pub message: String, pub hint: Option<String> }
  #[export] pub fn apply_op(options: ApplyOpOptions) -> Result<OpOutput, TimelineError>;
  ```
  Field names in JSON are camelCase (`splitTime`, `retainSide`, `newIds`). `retime.rs`: `clamp_retime_rate(f64) -> f64`, `source_time_at_clip_time(clip: i64, retime: Option<&RetimeConfig>) -> i64`, `source_span_at_clip_time`, `timeline_duration_for_source_span` (TS: `lib/retime/{rate,resolve,split}.ts`; round to nearest tick).
  Placement: port each function in `apps/web/src/lib/timeline/placement/*.ts` one-to-one, same names in snake_case.

- [ ] **Step 1: Unit tests for retime** — `clamp(0.0)==1.0`, `clamp(9.0)==5.0`, `clamp(0.001)==0.01`, `source_time_at_clip_time(120_000, rate 2.0)==240_000`.
- [ ] **Step 2: Placement goldens.** Add cases: `add_track_video_default`, `add_track_audio_index_0`, `remove_track_overlay`, `toggle_mute_main`, `toggle_visibility_text`. Generate. Add `parity.rs` test `track_ops_match_ts` → `assert_golden("add_track")` etc.
- [ ] **Step 3: Run** `cargo test -p timeline` → FAIL.
- [ ] **Step 4: Implement** `ops.rs` (dispatch, `Batch` folds ops left-to-right, stopping at the first error and returning it with `message` prefixed `op <index>:`), `error.rs`, `retime.rs`, `placement/*`. Track ops mirror `lib/commands/timeline/track/*.ts`.
- [ ] **Step 5: Run** → PASS.
- [ ] **Step 6: Commit** — `feat(timeline): apply_op entry, retime math, placement and track ops`.

### Task 5: Insert element

**Files:** Modify `rust/crates/timeline/src/ops.rs` (new `src/ops/insert.rs`); `cases.ts`; `parity.rs`.

**Interfaces:** Consumes Task 4 placement. TS source of truth: `apps/web/src/lib/commands/timeline/element/insert-element.ts` (validation `validateElementBasics`, `buildElement` defaults, `applyPlacementResult`). The canvas/fps side effect for the first visual element stays in TS (Task 9); Rust only edits tracks. Validation failures return `TimelineError` codes `missing_media_id`, `missing_source_url`, `missing_sticker_id`, `missing_content`, `missing_effect_type` (graphic `definitionId` registry check stays in TS).

- [ ] **Step 1: Goldens** `insert_video_auto_empty`, `insert_video_auto_after_existing`, `insert_text_auto_new_overlay`, `insert_audio_explicit_track`, `insert_image_on_occupied_span` (TS places on a new track), `insert_video_explicit_incompatible_track` (expected `null`).
- [ ] **Step 2: Run** `cargo test -p timeline insert` → FAIL.
- [ ] **Step 3: Implement** `insert`. Consumes one id from `new_ids`; returns it in `select` and `created`.
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** — `feat(timeline): insert element op`.

### Task 6: Keyframe channel split and split elements

**Files:** Create `rust/crates/timeline/src/animation_split.rs`, `src/ops/split.rs`; `cases.ts`; `parity.rs`.

**Interfaces:** `split_animations_at_time(animations: Option<&Value>, split_time: i64, include_boundary: bool, ids: &mut IdSource) -> (Option<Value>, Option<Value>)` — port of `splitAnimationsAtTime` and its helpers `splitScalarChannelAtTime`, `splitDiscreteChannelAtTime`, `cloneAnimationsState`, `cloneAnimationBinding`, `toAnimation` from `apps/web/src/lib/animation/keyframes.ts` (from line 1198 and the helpers it calls). Works on `serde_json::Value` with the shapes in `lib/animation/types.ts`. Split source of truth: `lib/commands/timeline/element/split-elements.ts`. Id consumption order per split element must match TS: left boundary id, right boundary id per binding, then the right-element id.

- [ ] **Step 1: Goldens** `split_plain_both`, `split_left`, `split_right`, `split_retimed_rate_2`, `split_at_start_unchanged`, `split_at_end_unchanged`, `split_keeps_keyframes_on_correct_side` (fixture element with scalar + discrete channels and a bezier segment straddling the split).
- [ ] **Step 2: Run** `cargo test -p timeline split` → FAIL.
- [ ] **Step 3: Implement.** Bezier segment subdivision follows the TS helper exactly (same handle math); copy its comments.
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** — `feat(timeline): split op with keyframe splitting`.

### Task 7: Trim, retime, move, delete, duplicate, update, ripple

**Files:** Create `src/ops/{trim,retime,move_element,delete,duplicate,update}.rs`, `src/ripple.rs`; `cases.ts`; `parity.rs`.

**Interfaces:** Sources of truth: `core/managers/timeline-manager.ts:84-149` (trim and retime are `UpdateElements` patches), `lib/commands/timeline/element/{move-elements,delete-elements,duplicate-elements,update-elements}.ts`, ripple `lib/ripple/{diff,apply,shift}.ts` (`computeRippleAdjustments(before, after)` then `applyRippleAdjustments`). In Rust, `ripple: true` on `ApplyOpOptions` runs `ripple::compute(before, after)` + `ripple::apply` after the op, matching `CommandManager.applyRippleIfEnabled` (`core/managers/commands.ts:26`). `UpdateElements.patch` is merged shallowly onto the element like the TS spread; patches touching `id` or `type` return `TimelineError` code `immutable_field`.

- [ ] **Step 1: Goldens** `trim_start_end`, `trim_with_start_and_duration`, `retime_rate_half`, `retime_clear`, `move_same_track`, `move_to_other_track`, `move_create_track`, `move_onto_occupied`, `delete_one`, `delete_many_across_tracks`, `delete_ripple` (generated with ripple on), `duplicate_two`, `update_transform`, `update_opacity_and_volume`.
- [ ] **Step 2: Run** `cargo test -p timeline` → new cases FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** — `feat(timeline): trim, retime, move, delete, duplicate, update and ripple ops`.

### Task 8: Validation and error contract

**Files:** Create `src/validate.rs`; modify `src/ops.rs`; test `rust/crates/timeline/tests/errors.rs`.

**Interfaces:** `#[export] pub fn validate_tracks(options: ValidateOptions { tracks: SceneTracks }) -> Vec<TimelineError>` (invariants: element type allowed on its track per `placement::compatibility`; no overlapping elements on one track; `duration > 0`; `trim_start, trim_end >= 0`; `trim_start + trim_end < source_duration` when `source_duration` is set). `apply_op` runs `validate_tracks` on its output and returns the first violation as an error with code `invalid_result` (input that was already invalid is not blamed: only new violations count).

- [ ] **Step 1: Write the failing tests.**
  ```rust
  #[test] fn errors_are_typed_not_panics() {
      let cases = [
        (op_split("missing-el", 10), "element_not_found"),
        (op_move_to_track("el1", "missing-track"), "track_not_found"),
        (op_trim("el1", -5, 0), "invalid_trim"),
        (op_insert_text_on_audio_track(), "incompatible_track"),
        (op_insert_video_without_ids(), "missing_ids"),
      ];
      for (op, code) in cases {
          let err = apply_op(opts(base_tracks(), op)).unwrap_err();
          assert_eq!(err.code, code);
          assert!(err.hint.is_some(), "{code} needs a hint");
      }
  }
  #[test] fn overlap_introduced_by_update_is_rejected() { /* update startTime onto neighbour → "invalid_result" */ }
  ```
- [ ] **Step 2: Run** `cargo test -p timeline --test errors` → FAIL.
- [ ] **Step 3: Implement.** Every error carries a hint naming valid values (e.g. existing track ids of the right type, the max trim).
- [ ] **Step 4: Run** → PASS; re-run all parity goldens → still PASS (TS no-op cases map to `changed: false`, not errors, unless TS also refused). **Step 5: Commit** — `feat(timeline): validation and typed errors`.

### Task 9: Wasm exports, generated TS types, Node smoke test

**Files:** Modify `rust/crates/timeline/src/timeline.rs` (exports, tsify); create `apps/web/src/lib/wasm/timeline.ts`; create `apps/web/src/lib/wasm/__tests__/node_smoke.test.ts`.

**Interfaces:** Produces JS `applyOp(options: ApplyOpOptions): OpOutput` (throws `TimelineError` object on `Err`) and `validateTracks`. `lib/wasm/timeline.ts` exports `applyTimelineOp({ tracks, op, newIds, ripple }): OpOutput` that calls `applyOp`, generating `newIds` with `generateUUID` when the caller passes a count instead (`newIds: number | string[]`), and rethrows wasm errors as `class TimelineOpError extends Error { code; hint }`.

- [ ] **Step 1: Write the failing test** `node_smoke.test.ts`: `const wasm = require("../../../../../../rust/wasm/pkg-node/mangocut_wasm.js")`; build a scene with one video element; `wasm.applyOp({ tracks, op: { type: "splitElements", elements: [ref], splitTime: 60000, retainSide: "both" }, newIds: ["r1"], ripple: false })`; expect two elements, second id `"r1"`. Second test: `expect(() => wasm.applyOp({ ..., op: { type: "splitElements", elements: [{trackId: "x", elementId: "y"}], splitTime: 1, retainSide: "both" } })).toThrow()` and the thrown object has `code === "element_not_found"`.
- [ ] **Step 2: Run** `bun run build:wasm:node && bun test apps/web/src/lib/wasm` → FAIL.
- [ ] **Step 3: Implement** exports and the TS wrapper.
- [ ] **Step 4: Run** → PASS. Also `bun run build:wasm && bun run build:web` succeeds. **Step 5: Commit** — `feat(timeline): wasm exports for browser and node`.

### Task 10: Renderer runs ported ops through wasm

**Files:** Modify `apps/web/src/lib/commands/timeline/element/{insert-element,split-elements,move-elements,delete-elements,duplicate-elements,update-elements}.ts`, `lib/commands/timeline/track/{add-track,remove-track,toggle-track-mute,toggle-track-visibility}.ts`, `core/managers/commands.ts` (ripple); delete superseded TS helpers only when no other importer remains (check with `rg`).

**Interfaces:** Consumes `applyTimelineOp` (Task 9). Each command keeps `savedState` for undo and its public getters (`getElementId`, `getTrackId`, `getRightSideElements`, `getDuplicatedElements`) by reading `OpOutput.created`/`select`. `InsertElementCommand` keeps the first-visual-media canvas/fps logic in TS before calling wasm. `CommandManager.applyRippleIfEnabled` is removed; commands pass `ripple: this.editor.command.isRippleEnabled` to wasm.

- [ ] **Step 1: Run** the existing suite as the baseline: `bun test` → record pass count.
- [ ] **Step 2: Swap each command's mutation to `applyTimelineOp`**, one command per commit-sized change, running `bun test` after each.
- [ ] **Step 3: Manual check in the app** (`bun run dev:web`): insert a video, split it, trim both halves, move one to a new track, toggle ripple and delete, undo all steps, redo all steps. Expected: identical behaviour to before; undo/redo restore exact states.
- [ ] **Step 4: Run** `bun test && cargo test --workspace && bun run build:web` → PASS, same or higher pass count.
- [ ] **Step 5: Commit** — `refactor(web): timeline commands call Rust ops via wasm`.

## Out of scope for Phase 1 (later phases or a follow-up Rust migration plan)

Keyframe edit ops (upsert/remove/retime/curve), effect and mask ops, clipboard paste, source-audio separation, scene/bookmark ops, project settings. They keep running in TS and are ported with the same harness when an agent tool needs them. The preview filter-graph generator is Phase 5.
