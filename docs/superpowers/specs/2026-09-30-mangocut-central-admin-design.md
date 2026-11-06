# Mangocut — Central Cloud AI/Auth + Admin Dashboard + Web/Desktop Clarity

**Date:** 2026-09-30  
**Status:** Approved  
**Owner email (admin):** `manoj.elango123@gmail.com`

## Goal

1. **Centralize** Google sign-in, free-trial entitlements, and OpenRouter spend on a single hosted Mangocut server so every signed-in user (web **and** desktop DMG) appears in one place.
2. Give that admin email an **in-app dashboard** (`/admin`) with users, per-user spend, and totals — no payment product.
3. Make **web vs desktop** limits obvious in product UI so users understand local storage and missing desktop-only tools.

## Non-goals

- Cloud project/media sync or multi-device project backup.
- Billing, Stripe, paid plans, or self-serve quota top-ups.
- Replacing Better Auth or OpenRouter.
- Making the DMG fully offline for AI (AI requires network to the cloud host).

## Current problem

- Packaged Electron bakes `apps/web/.env.local` and runs a **local** Next server on `:3045` with its own SQLite (`mangocut-auth.sqlite`) and `ai-usage.json`.
- Friends’ DMG usage never reaches the hosted site; an admin page on web would only see hosted-web sign-ins.
- Electron `ai:chat` IPC fetches local origin **without** session cookies, which can mis-attribute trial usage.

## Decisions

### D1 — Cloud origin is source of truth for identity + AI quota

Introduce `MANGOCUT_CLOUD_ORIGIN` (e.g. `https://mangocut.jonam.dev`).

| Mode | When | Auth DB + AI usage + OpenRouter |
|------|------|----------------------------------|
| **Cloud** | `MANGOCUT_CLOUD_ORIGIN` set (packaged DMG + production web) | Hosted server only |
| **Local** | Unset / empty (`bun run dev:ai` solo) | Local `.data` as today |

Packaged DMG **must not** ship a usable `OPENROUTER_API_KEY` for local AI. Local Next in the DMG serves the editor UI and desktop IPC (FS/ffmpeg); AI chat/vision/entitlements call the cloud origin.

### D2 — Desktop auth against cloud

- Better Auth `baseURL` / client `baseURL` for production desktop = cloud origin.
- Google OAuth authorized redirect for production: `https://mangocut.jonam.dev/api/auth/callback/google` (plus keep `127.0.0.1:3045` for local-only mode).
- Session cookies are first-party on the cloud host. Desktop renderer calls cloud AI with `credentials: "include"` **from requests that hit the cloud origin** (not via cookie-less main-process fetch).
- Prefer **renderer-side** `fetch(cloudOrigin + "/api/ai/chat")` with credentials over Electron main IPC for chat when cloud mode is on. Keep IPC for filesystem/ffmpeg only.
- If a session cookie cannot be shared (strict cross-origin), fall back to a short-lived **session token** issued by cloud after Google sign-in and sent as `Authorization: Bearer …` on AI routes. Prefer cookie-first; document token fallback in implementation if CORS/cookie constraints require it.

### D3 — Admin dashboard (`/admin`)

- Visible only when signed-in email equals `MANGOCUT_ADMIN_EMAIL` (default `manoj.elango123@gmail.com`).
- Non-admins → 404 (do not reveal the route exists).
- Data: join Better Auth `user` rows with `ai-usage.json` keys `user:{id}`.
- Show:
  - Totals: user count, total turns, total OpenRouter `$`, trial-exhausted count
  - Table: email, name, createdAt, last usage `updatedAt`, turns, `costUsd`, remaining turns / spend vs limits, exhausted flag
- Read-only for v1 (no remote wipe / reset buttons unless added later).

### D4 — Web vs desktop product clarity

Web is a **browser-local try editor**, not a cloud NLE:

| Capability | Web | Desktop DMG |
|------------|-----|-------------|
| Projects / media storage | This browser only (IndexedDB/OPFS) | This Mac only |
| Cloud project sync | No | No |
| Google + free AI trial (via cloud) | Yes | Yes |
| AI chat / vision / entitlements | Yes (network) | Yes (network → cloud) |
| Upload media in UI | Yes | Yes |
| Folder pick / disk import / ffmpeg agent tools | No | Yes |
| Manual timeline edit + Merge/Discard | Yes | Yes |

UX:

1. Persistent or dismissible **web capability banner** on editor (and Settings): projects stay in this browser; folder import & full AI tools need desktop.
2. AI chat empty state mentions free trial + desktop-only tools when `!isMangocutDesktop()`.
3. README / Settings short “What works where” section — no “friend beta” framing; free-trial product language.

## Architecture

```text
┌─────────────────────┐     Google OAuth      ┌──────────────────────────┐
│ Browser / Electron  │ ───────────────────► │ mangocut.jonam.dev       │
│ UI (local or hosted)│                      │ Better Auth SQLite       │
│ IndexedDB projects  │   /api/ai/* + cookies │ ai-usage.json            │
│ Desktop IPC: FS/ffmpeg only                │ OpenRouter proxy         │
└─────────────────────┘ ◄─────────────────── │ /admin (owner email)     │
                                             └──────────────────────────┘
```

### Key modules (planned)

| Piece | Responsibility |
|-------|----------------|
| `lib/site/cloud.ts` | Resolve cloud origin vs local; `isCloudAiMode()` |
| `lib/auth/client.ts` | Point Better Auth client at cloud when configured |
| `lib/ai/agent.ts` + chat/vision callers | Hit cloud `/api/ai/*` with credentials in cloud mode |
| Electron IPC | Drop cookie-less AI chat proxy in cloud mode (or forward Cookie/Authorization) |
| `prepare-standalone` / env bake | Strip OpenRouter from DMG; set `MANGOCUT_CLOUD_ORIGIN` |
| `app/admin/page.tsx` + `api/admin/usage/route.ts` | Gated dashboard + JSON API |
| `lib/ai/admin-usage.ts` | Join users ↔ usage records |
| Capability banner component | Web restrictions copy |

## Security

- Admin gate: exact email match (case-insensitive) from server session; never trust client-only checks alone.
- Do not expose OpenRouter key to clients; cloud server only.
- Admin API returns emails/spend to admin only; no public user listing.
- DMG without local OpenRouter key cannot burn quota offline.

## Migration / ops

1. Deploy hosted Mangocut with Google redirect for production URL + existing trial env (`AI_TRIAL_*`, OpenRouter).
2. Set `MANGOCUT_ADMIN_EMAIL=manoj.elango123@gmail.com`.
3. Rebuild DMG with `MANGOCUT_CLOUD_ORIGIN=https://mangocut.jonam.dev` and **without** shipping `OPENROUTER_API_KEY`.
4. Existing local DMG trial counters stay on old machines; new installs use cloud (expected discontinuity for private trial).

## Success criteria

- Admin signs into hosted web → `/admin` shows all Google users who used AI against that host, with per-user and total OpenRouter `$`.
- Desktop DMG sign-in + AI turn increments the **same** usage store as web.
- Web users see clear restrictions; desktop users are not told to use cloud project sync.
- Local `dev:ai` without cloud origin still works for solo development.

## Open implementation notes

- Exact cookie vs Bearer strategy for Electron ↔ cloud may need a short spike during implementation; prefer cookies if `BETTER_AUTH_URL` is the cloud origin and the BrowserWindow navigates auth on that host.
- Optional later: usage event log (per-request rows) for richer admin charts — out of scope for v1 (aggregate map is enough).
