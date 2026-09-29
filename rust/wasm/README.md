# mangocut-wasm

Shared video editor logic compiled to WebAssembly. Used by the Mangocut web app.

## Install

```bash
npm install mangocut-wasm
```

## Usage

```ts
import { formatTimecode, mediaTimeFromSeconds } from "mangocut-wasm";
```

All exports are documented in the TypeScript definitions shipped with the package.

## Local development

The web app depends on `mangocut-wasm` by default. If you are editing the WASM source in this repo and want `apps/web` to use your local build instead:

1. `bun run build:wasm` from the repo root
2. `cd rust/wasm/pkg && bun link`
3. `cd apps/web && bun link mangocut-wasm`
4. `bun dev:wasm` to rebuild on changes
