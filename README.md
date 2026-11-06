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

The Vercel project's Root Directory is `apps/web`. `apps/web/vercel.json`
sets the build command to build the Rust wasm package first
(`bun run build:wasm` from the repo root: `script/ensure-wasm-toolchain.sh`
installs rustup, the wasm32 target and the pinned wasm-pack when `VERCEL` is
set, then the package is synced over the `mangocut-wasm` stub) and then runs
`next build`.

Required dashboard setting: **Settings → Build and Deployment → Root
Directory → "Include source files outside of the Root Directory in the Build
Step"** must be enabled. `apps/web` depends on `file:../../rust/wasm/stub`
and the build compiles `rust/`, both outside the Root Directory; without it
the build fails (or ships the stub).

## License

[MIT LICENSE](LICENSE)
