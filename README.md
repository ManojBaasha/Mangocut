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

## License

[MIT LICENSE](LICENSE)
