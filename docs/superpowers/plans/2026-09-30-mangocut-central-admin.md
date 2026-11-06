# Mangocut Central Cloud AI/Auth + Admin Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route production AI/auth to a hosted Mangocut origin, ship an email-gated `/admin` usage dashboard, and surface web-vs-desktop capability limits in the UI.

**Architecture:** `MANGOCUT_CLOUD_ORIGIN` switches clients to cloud Better Auth + `/api/ai/*`. Packaged DMG keeps local UI + FS/ffmpeg IPC but does not ship OpenRouter; AI spend lands in the host’s `ai-usage.json`. Admin joins Better Auth users with usage keys. Web shows a capability banner; local `dev:ai` without cloud origin stays unchanged.

**Tech Stack:** Next.js App Router, Better Auth + SQLite, existing `usage-store`, Electron preload/IPC, bun:test.

**Spec:** `docs/superpowers/specs/2026-09-30-mangocut-central-admin-design.md`

## Global Constraints

- Admin email default: `manoj.elango123@gmail.com` (override via `MANGOCUT_ADMIN_EMAIL`).
- Non-admins hitting `/admin` or `/api/admin/*` get **404** (not 403).
- No payment / billing / quota reset UI in v1.
- Packaged DMG must not ship a usable `OPENROUTER_API_KEY` when cloud mode is on.
- Brand: Mangocut; free-trial copy (no “friend beta”).
- Prefer TDD for pure helpers (`cloud` URL parsing, admin join, admin gate, bearer verify).

## Review Focus

- Cross-origin Electron → cloud without session cookie must still attribute usage to the signed-in user (Bearer fallback).
- Non-admin must not learn that `/admin` exists (404).
- Local `dev:ai` with empty cloud origin must keep working with local SQLite + OpenRouter.
- DMG with cloud origin but no network must fail AI clearly (not silently burn a missing local key).
- Web banner must not appear on desktop (`isMangocutDesktop()`).

## File map

| File | Responsibility |
|------|----------------|
| `apps/web/src/lib/site/cloud.ts` | Resolve public/server cloud origin; `isCloudAiMode()` |
| `apps/web/src/lib/auth/admin.ts` | `isAdminEmail`, `assertAdminSession` |
| `apps/web/src/lib/ai/admin-usage.ts` | Join auth users ↔ `ai-usage.json` |
| `apps/web/src/lib/ai/ai-bearer.ts` | Sign/verify short-lived AI Bearer JWT |
| `apps/web/src/lib/auth/client.ts` | Auth client `baseURL` → cloud when configured |
| `apps/web/src/lib/ai/device-id.ts` / new `lib/ai/cloud-fetch.ts` | Build AI request URL + headers (cookies + optional Bearer) |
| `apps/web/src/lib/ai/entitlements.ts` | Accept Bearer user in addition to cookie session |
| `apps/web/src/lib/ai/agent.ts` | Chat calls go through cloud-aware fetch |
| `apps/web/src/app/api/auth/ai-token/route.ts` | Issue Bearer after cookie session (cloud host) |
| `apps/web/src/app/api/admin/usage/route.ts` | Admin JSON |
| `apps/web/src/app/admin/page.tsx` | Admin UI |
| `apps/web/src/components/editor/web-capability-banner.tsx` | Web restrictions banner |
| `apps/web/src/app/settings/page.tsx` | “What works where” + admin link |
| `apps/web/src/components/editor/panels/ai-chat/index.tsx` | Web-only tool limits copy |
| `apps/electron/scripts/prepare-standalone.mjs` | Strip OpenRouter; inject cloud origin |
| `apps/electron/src/ai/ipc.js` | Skip cookie-less AI chat when cloud mode (renderer owns chat) |
| `apps/web/.env.example` / `README.md` | Document cloud + admin + redirects |

---

### Task 1: Cloud origin helper (TDD)

**Files:**
- Create: `apps/web/src/lib/site/cloud.ts`
- Create: `apps/web/src/lib/site/__tests__/cloud.test.ts`
- Modify: `apps/web/.env.example`
- Modify: `apps/web/src/lib/env/web.ts` (optional zod fields)

**Interfaces:**
- Produces:
  - `getCloudOrigin(): string | null` — trimmed origin without trailing slash, or null if unset
  - `isCloudAiMode(): boolean` — true when `getCloudOrigin()` is non-null
  - `getAiApiBaseUrl(): string` — cloud origin in cloud mode, else `""` (same-origin relative)

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { getCloudOrigin, isCloudAiMode, getAiApiBaseUrl } from "../cloud";

describe("cloud origin", () => {
  const prev = { ...process.env };
  afterEach(() => {
    process.env = { ...prev };
  });

  test("null when unset", () => {
    delete process.env.MANGOCUT_CLOUD_ORIGIN;
    delete process.env.NEXT_PUBLIC_MANGOCUT_CLOUD_ORIGIN;
    expect(getCloudOrigin()).toBeNull();
    expect(isCloudAiMode()).toBe(false);
    expect(getAiApiBaseUrl()).toBe("");
  });

  test("strips trailing slash; prefers NEXT_PUBLIC for client-safe read", () => {
    process.env.NEXT_PUBLIC_MANGOCUT_CLOUD_ORIGIN = "https://mangocut.jonam.dev/";
    expect(getCloudOrigin()).toBe("https://mangocut.jonam.dev");
    expect(getAiApiBaseUrl()).toBe("https://mangocut.jonam.dev");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd apps/web && bun test src/lib/site/__tests__/cloud.test.ts`

- [ ] **Step 3: Implement `cloud.ts`**

Read `NEXT_PUBLIC_MANGOCUT_CLOUD_ORIGIN` first, then `MANGOCUT_CLOUD_ORIGIN`. Reject empty/whitespace. Normalize with `new URL(...).origin`.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Update `.env.example`** with:

```bash
# Production / packaged desktop: point AI + auth at the hosted Mangocut
# Leave empty for local-only `bun run dev:ai`
NEXT_PUBLIC_MANGOCUT_CLOUD_ORIGIN=
MANGOCUT_CLOUD_ORIGIN=
MANGOCUT_ADMIN_EMAIL=manoj.elango123@gmail.com
```

- [ ] **Step 6: Commit** (only if user asked to commit; otherwise skip)

---

### Task 2: Admin gate + usage join (TDD)

**Files:**
- Create: `apps/web/src/lib/auth/admin.ts`
- Create: `apps/web/src/lib/ai/admin-usage.ts`
- Create: `apps/web/src/lib/auth/__tests__/admin.test.ts`
- Create: `apps/web/src/lib/ai/__tests__/admin-usage.test.ts`
- Modify: `apps/web/src/lib/ai/usage-store.ts` — export `listAllAiUsage(): Record<string, AiUsageRecord>`

**Interfaces:**
- Consumes: `AiUsageRecord` from usage-store; trial limit helpers from entitlements (or duplicate turn/spend limit reads for display)
- Produces:
  - `isAdminEmail({ email }: { email: string | null | undefined }): boolean`
  - `getAdminEmail(): string` — env or default `manoj.elango123@gmail.com`
  - `buildAdminUsageReport({ users, usageByKey, turnLimit, spendLimitUsd }): { totals, rows }`

```ts
export interface AdminUserRow {
  userId: string;
  email: string;
  name: string;
  createdAt: string;
  turns: number;
  costUsd: number;
  usageUpdatedAt: string | null;
  remainingTurns: number;
  trialExhausted: boolean;
}

export interface AdminUsageReport {
  totals: {
    userCount: number;
    totalTurns: number;
    totalCostUsd: number;
    exhaustedCount: number;
  };
  rows: AdminUserRow[];
}
```

- [ ] **Step 1: Failing tests for `isAdminEmail`** (case-insensitive; trim; null → false)

- [ ] **Step 2: Implement admin gate helpers**

- [ ] **Step 3: Failing tests for `buildAdminUsageReport`**

```ts
test("joins user ids to user:{id} usage and sums totals", () => {
  const report = buildAdminUsageReport({
    users: [
      { id: "u1", email: "a@x.com", name: "A", createdAt: "2026-01-01" },
      { id: "u2", email: "b@x.com", name: "B", createdAt: "2026-01-02" },
    ],
    usageByKey: {
      "user:u1": { turns: 3, costUsd: 0.05, updatedAt: "2026-01-03" },
    },
    turnLimit: 50,
    spendLimitUsd: 2,
  });
  expect(report.totals.userCount).toBe(2);
  expect(report.totals.totalTurns).toBe(3);
  expect(report.totals.totalCostUsd).toBe(0.05);
  expect(report.rows[0].remainingTurns).toBe(47);
});
```

- [ ] **Step 4: Implement join + export `listAllAiUsage`**

- [ ] **Step 5: Run** `bun test src/lib/auth/__tests__/admin.test.ts src/lib/ai/__tests__/admin-usage.test.ts`

---

### Task 3: Admin API + page

**Files:**
- Create: `apps/web/src/app/api/admin/usage/route.ts`
- Create: `apps/web/src/app/admin/page.tsx`
- Modify: `apps/web/src/lib/auth/server.ts` — export a way to list users from SQLite (small helper `listAuthUsers()` reading `SELECT id, email, name, createdAt FROM user ORDER BY createdAt DESC`)

**Interfaces:**
- Consumes: `assertAdminSession` / session + `isAdminEmail`; `buildAdminUsageReport`; `listAllAiUsage`
- Produces: `GET /api/admin/usage` → `{ totals, rows, turnLimit, spendLimitUsd }` or **404**

- [ ] **Step 1: Implement `listAuthUsers` in auth server module** (or `lib/auth/users.ts` using same DB path)

- [ ] **Step 2: `GET` handler**

```ts
export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!isAdminEmail({ email: session?.user?.email })) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const report = buildAdminUsageReport({ ... });
  return NextResponse.json({ ...report, turnLimit, spendLimitUsd });
}
```

- [ ] **Step 3: Admin page (client)** — BasePage or simple layout; fetch `/api/admin/usage` with credentials; if 404 show not-found UI; else totals cards + table (email, turns, cost, remaining, exhausted, last active)

- [ ] **Step 4: Settings** — if session email is admin, show link “Admin usage dashboard” → `/admin`

- [ ] **Step 5: Manual check** — non-admin session → `/admin` 404; admin → data loads

---

### Task 4: AI Bearer token (cookie fallback for desktop)

**Files:**
- Create: `apps/web/src/lib/ai/ai-bearer.ts`
- Create: `apps/web/src/lib/ai/__tests__/ai-bearer.test.ts`
- Create: `apps/web/src/app/api/auth/ai-token/route.ts`
- Modify: `apps/web/src/lib/ai/entitlements.ts` — resolve user from cookie **or** valid Bearer

**Interfaces:**
- Produces:
  - `signAiBearer({ userId, email, secret, expiresInSeconds? }): string`
  - `verifyAiBearer({ token, secret }): { userId: string; email: string } | null`
- `GET /api/auth/ai-token` (cookie session required) → `{ token, expiresAt }`

Token: HMAC-SHA256 over `userId|email|exp` using `BETTER_AUTH_SECRET` (no new dependency if possible; else use Web Crypto / `node:crypto`).

- [ ] **Step 1: TDD sign/verify + expiry rejection**

- [ ] **Step 2: Issue route** — 401 if no session

- [ ] **Step 3: Update `resolveAiEntitlement`** — if `Authorization: Bearer …` verifies, treat as `user:{userId}` authenticated (same as cookie). Prefer cookie when both present.

- [ ] **Step 4: Run bearer + entitlements-related tests**

---

### Task 5: Cloud-aware AI client + auth client

**Files:**
- Create: `apps/web/src/lib/ai/cloud-fetch.ts`
- Modify: `apps/web/src/lib/auth/client.ts`
- Modify: `apps/web/src/lib/ai/agent.ts`
- Modify: vision callers (`lib/ai/vision/describe.ts` or equivalent fetch sites)
- Modify: `apps/web/src/components/editor/panels/ai-chat/index.tsx` entitlements fetch
- Modify: `apps/web/src/app/settings/page.tsx` entitlements fetch
- Modify: `apps/electron/src/ai/ipc.js` — if `MANGOCUT_CLOUD_ORIGIN` / `NEXT_PUBLIC_…` set, **do not** handle AI chat in main (throw instructing renderer) OR remove chat IPC usage from agent when cloud mode

**Interfaces:**
- Produces: `aiFetch(path: "/api/ai/chat" | ..., init): Promise<Response>`  
  - URL = `getAiApiBaseUrl() + path`  
  - Always `credentials: "include"`  
  - Attach `Authorization: Bearer ${token}` when `sessionStorage`/`localStorage` key `mangocut-ai-bearer` is set  
  - Keep `aiRequestHeaders()` device id

**Auth client:**

```ts
baseURL:
  (typeof window !== "undefined" && getCloudOrigin()) ||
  (typeof window !== "undefined" ? window.location.origin : ...)
```

Note: `getCloudOrigin` must work in browser via `NEXT_PUBLIC_MANGOCUT_CLOUD_ORIGIN` only.

**Desktop sign-in bridge (cloud mode):**
After successful `authClient.signIn.social` / on AI chat mount when authenticated against cloud is ambiguous, call `GET ${cloud}/api/auth/ai-token` with credentials from a **same-origin cloud navigation** if needed. Practical v1 flow:
1. Sign-in `callbackURL` stays on local app.
2. Better Auth on **cloud** host: set `authClient.baseURL` to cloud so Google + session cookies live on cloud.
3. Immediately after sign-in, open a short-lived popup/iframe to `${cloud}/auth/desktop-bridge` (new minimal page) that: reads cookie session → fetches `/api/auth/ai-token` → `postMessage` token to opener → opener stores `mangocut-ai-bearer`.
4. If popup blocked, show “Connect AI session” button that opens the bridge.

- [ ] **Step 1: Implement `aiFetch` + wire agent/chat/entitlements/settings**

- [ ] **Step 2: Implement `/auth/desktop-bridge` page** (cloud-hosted only; simple client page)

- [ ] **Step 3: Agent: when `isCloudAiMode()`, never call `desktop.ai.chat`** — always `aiFetch`

- [ ] **Step 4: Electron IPC: no-op/throw for `ai:chat` when cloud origin env present**

- [ ] **Step 5: Smoke** — local mode still uses relative `/api/ai/chat`

---

### Task 6: DMG env bake — strip OpenRouter, inject cloud origin

**Files:**
- Modify: `apps/electron/scripts/prepare-standalone.mjs`
- Modify: `apps/electron/src/main.js` if it merges env for child Next

**Behavior when building packaged app:**
- Write/merge `.env.local` in resources with:
  - `NEXT_PUBLIC_MANGOCUT_CLOUD_ORIGIN=https://mangocut.jonam.dev` (or from build env)
  - `MANGOCUT_CLOUD_ORIGIN=` same
  - `OPENROUTER_API_KEY=` cleared / omitted
  - Keep Google client id/secret **only on cloud host**, not required in DMG if auth is fully on cloud — if local Next still runs Better Auth unused, omit Google secrets from DMG too when cloud mode
- Document build: `MANGOCUT_CLOUD_ORIGIN=https://mangocut.jonam.dev bun run build:electron`

- [ ] **Step 1: Update prepare script** to redact `OPENROUTER_API_KEY` and set cloud origin from `process.env.MANGOCUT_CLOUD_ORIGIN || process.env.NEXT_PUBLIC_MANGOCUT_CLOUD_ORIGIN`

- [ ] **Step 2: Log clearly** what was redacted / injected

- [ ] **Step 3: Verify** packaged resources `.env.local` has empty OpenRouter and non-empty cloud origin when build env set

---

### Task 7: Web capability UX

**Files:**
- Create: `apps/web/src/components/editor/web-capability-banner.tsx`
- Modify: `apps/web/src/app/editor/[project_id]/page.tsx` (or editor shell) — render banner when `!isMangocutDesktop()`
- Modify: `apps/web/src/app/settings/page.tsx` — “What works where” section
- Modify: `apps/web/src/components/editor/panels/ai-chat/index.tsx` — empty-state note on web
- Modify: `README.md` — short web vs desktop table

**Copy (use verbatim intent):**
- Banner: “Projects and media stay in this browser — nothing syncs to the cloud. Folder import and some AI tools need the Mangocut desktop app.”
- Dismissible via `localStorage` key `mangocut-web-capability-banner-dismissed`

- [ ] **Step 1: Banner component + wire into editor**

- [ ] **Step 2: Settings section + AI chat empty state**

- [ ] **Step 3: README table**

---

### Task 8: Hosted auth CORS / trustedOrigins

**Files:**
- Modify: `apps/web/src/lib/auth/server.ts` — add `http://127.0.0.1:3045` and `http://localhost:3045` already present; ensure cloud deploy `BETTER_AUTH_URL=https://mangocut.jonam.dev`
- Modify: AI routes if needed for CORS preflight when desktop local UI calls cloud (OPTIONS + `Access-Control-Allow-Credentials` + allow origin 127.0.0.1:3045)

- [ ] **Step 1: Add shared `withAiCors(request, response)` helper for `/api/ai/*` and `/api/auth/ai-token` when `Origin` is trusted desktop origin**

- [ ] **Step 2: Document Google Console redirects:** production callback `https://mangocut.jonam.dev/api/auth/callback/google`; local-only mode keeps `http://127.0.0.1:3045/...`

---

### Task 9: End-to-end verification checklist

- [ ] Local: unset cloud origin → `bun run dev:ai` → sign-in + AI turn increments local `.data/ai-usage.json`
- [ ] Hosted: admin email → `/admin` shows users + spend
- [ ] Hosted: non-admin → `/admin` 404
- [ ] Desktop cloud build: no OpenRouter in resources; AI call hits cloud; admin totals increase
- [ ] Web: banner visible; desktop: banner hidden

---

## Spec coverage

| Spec item | Task |
|-----------|------|
| D1 cloud origin / local mode | 1, 5, 6 |
| D2 desktop auth + credentials / Bearer | 4, 5, 8 |
| D3 `/admin` dashboard | 2, 3 |
| D4 web vs desktop clarity | 7 |
| Strip OpenRouter from DMG | 6 |
| Success criteria / ops | 6, 9 |

## Placeholder scan

No TBD steps; Bearer bridge page is specified in Task 5.
