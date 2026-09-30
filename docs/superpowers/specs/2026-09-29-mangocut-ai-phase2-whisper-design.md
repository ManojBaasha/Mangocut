# Mangocut AI Phase 2 — Whisper + Cut on Speech

**Date:** 2026-09-29  
**Status:** Approved (roadmap)

## Goal

Expose existing Transformers.js Whisper as Command API tools and cut timeline elements on speech/silence gaps, staging on shadow.

## Decisions

- Reuse `transcriptionService` + `decodeAudioToFloat32`; no second STT stack.
- Persist `transcript` on `MediaAssetData`.
- Commands: `list_transcription_models`, `transcribe_media`, `insert_captions`, `cut_on_speech`.
- `keep_speech` merges segments then splits/deletes silence on matching timeline elements.
- `split_on_gaps` only inserts split points at long silence gaps.
