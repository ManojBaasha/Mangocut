# Mangocut AI Phase 3 — Shadow Hardening + Editor Pack

**Date:** 2026-09-29  
**Status:** Approved (roadmap)

## Goal

Reliable AI Preview conflict detection and broader editor Command API (text, effects, transform, rectangle mask).

## Decisions

- `finalGeneration` counter bumped on final track mutations while a shadow session exists.
- `isFinalDiverged()` compares generations (works in both view modes).
- Registry `executeCommand` rejects `target: shadow` when diverged via injectable guard.
- `ai_reset_preview` + Reset UI button.
- Crop-like framing via rectangle mask, not a new crop model.
