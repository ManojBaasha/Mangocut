# Mangocut AI Phase 4 — Auth + Trial Entitlements

**Date:** 2026-09-29  
**Status:** Approved (roadmap)

## Goal

Identity-gated AI usage with Better Auth (Google) and configurable free-trial turn limits. OpenRouter key stays server-only.

## Decisions

- Better Auth on Next (`/api/auth/[...all]`) with SQLite at `apps/web/.data/mangocut-auth.sqlite`.
- Google provider when `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are set; otherwise sign-in is disabled but anonymous desktop trial still works unless `AI_REQUIRE_AUTH=true`.
- Entitlements module keys usage by `user:<id>` or `anon:<deviceToken>`.
- All `/api/ai/*` routes call `assertAiEntitled` then optionally `consumeAiTurn`.
