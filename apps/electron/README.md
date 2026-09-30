# Mangocut Electron

Desktop shell that packages the Next.js editor for local use.

## How it works

- **Dev:** `bun dev:web`, then `bun run dev:electron` (loads `http://127.0.0.1:3000/projects`).
- **Production:** builds Next standalone, copies into `resources/next`, Electron serves it on `127.0.0.1:3045` (same origin as local AI desktop / Google OAuth redirects).

Projects and media stay in IndexedDB inside the Electron profile.

```sh
bun run build:electron
```
