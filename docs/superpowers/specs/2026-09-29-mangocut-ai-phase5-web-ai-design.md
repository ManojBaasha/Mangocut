# Mangocut AI Phase 5 — Web AI Chat

**Date:** 2026-09-29  
**Status:** Approved (roadmap)

## Goal

Signed-in web users get the AI sidebar; desktop keeps FS/ffmpeg tools.

## Decisions

- Show AI button when `isMangocutDesktop() || session authenticated`.
- Agent prompt notes filesystem import is desktop-only on web.
- FS/ffmpeg commands already throw without desktop API.
