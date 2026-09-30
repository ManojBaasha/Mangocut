# Mangocut AI Phase 1 — Vision Memory

**Date:** 2026-09-29  
**Status:** Approved (roadmap)

## Goal

Describe project media frames with a vision model, persist text descriptions on the asset, and surface them to the agent via `get_project_summary` without sending images on every chat turn.

## Decisions

- Persist `vision` on `MediaAssetData` (IndexedDB metadata).
- Dedicated `POST /api/ai/vision` for multimodal calls.
- Commands: `describe_media`, `get_media_vision`.
- Frame capture: in-project via videoCache/canvas; desktop path via extractFrames as fallback.
- Agent remains text-primary; only `describe_media` sends images.
