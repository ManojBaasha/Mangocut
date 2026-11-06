<table width="100%">
  <tr>
    <td align="left" width="120">
      <img src="apps/web/public/logos/mangocut/icon.svg" alt="Mangocut Logo" width="100" />
    </td>
    <td align="right">
      <h1>Mangocut</h1>
      <h3 style="margin-top: -10px;">Edit Videos with AI</h3>
    </td>
  </tr>
</table>

## Why?

- **AI-assisted editing**: Cut, polish, and ship video faster with AI in the flow
- **Local-first**: Your media stays on your device
- **Simple**: An editor that feels approachable without giving up power

## Project Structure

- `apps/web/`: Next.js editor
- `apps/electron/`: Downloadable desktop shell
- `rust/`: Shared WASM compositor / time / effects core

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/docs/installation)
- Rust with the `wasm32-unknown-unknown` target and `wasm-pack` (`bash script/setup-rust`); `bun dev:web` builds the timeline engine to wasm first

### Setup

```bash
cp apps/web/.env.example apps/web/.env.local
bun install
bun dev:web
```

Open [http://localhost:3000](http://localhost:3000) (redirects to `/projects`).

### Desktop (Electron)

```bash
bun run build:electron
```

DMG output: `apps/electron/dist/`.

Dev: run `bun dev:web`, then `bun run dev:electron`.

### Local WASM development

Only if you edit `rust/wasm`:

```bash
bun run build:wasm
cd rust/wasm/pkg && bun link
cd apps/web && bun link mangocut-wasm
bun dev:wasm
```

### Tests

```bash
bun test                  # unit tests
bun run test:integration  # builds rust/wasm/pkg-node, runs the wasm-backed tests
bun run test:parity       # Rust engine vs legacy TS goldens
cargo test --workspace
```

## Deploying `apps/web` on Vercel

The `mangocut` Vercel project has no Git connection; deploys are made with
the Vercel CLI from the **repo root** and **built on Vercel**. Building on a
Mac and uploading the output does not work: the auth server uses
`better-sqlite3`, and a macOS build ships a darwin binary that cannot load in
Vercel's Linux functions.

One-time project settings (Settings → Build and Deployment):

- **Root Directory:** `apps/web`
- **Include source files outside of the Root Directory in the Build Step:** on
  (already on). The build compiles `rust/` and installs from the root lockfile.

Or from the repo root with the CLI:

```bash
vercel api "/v9/projects/prj_xtlU4nVs1OxsbjMvhb4N6YVjgeMd?teamId=team_8cZraAGe7X9XTH7SnsAtXvOj" -X PATCH -F rootDirectory=apps/web
```

Then:

```bash
vercel login                      # once
bun run deploy:web                # preview deployment
bun run deploy:web -- --prod      # production
```

`script/deploy-web.mjs` links the repo root to the project, checks those
settings, and runs `vercel deploy`. `.vercelignore` keeps local build output
(`target/`, `node_modules/`, `.next/`, wasm packages, the Electron app, evals)
out of the upload. On Vercel, `apps/web/vercel.json` builds the Rust wasm
package (`script/ensure-wasm-toolchain.sh` installs rustup and the pinned
wasm-pack when `VERCEL` is set) and then runs `next build`.

## License

[MIT LICENSE](LICENSE)
