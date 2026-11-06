// Copies rust/wasm/pkg into every installed `mangocut-wasm` (bun copies `file:`
// deps, so a rebuild would otherwise stay stale until the next install, and an
// install after a build would otherwise leave the stub in place).
//
//   node script/sync-wasm.mjs               fail if rust/wasm/pkg is missing
//   node script/sync-wasm.mjs --if-present  skip quietly instead (postinstall:
//                                           a fresh checkout has no pkg yet)
import { cpSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = join(root, "rust", "wasm", "pkg");
const ifPresent = process.argv.includes("--if-present");

// Check before touching any destination, so a missing build never leaves an
// install with no mangocut-wasm at all.
if (!existsSync(join(pkg, "package.json"))) {
	if (ifPresent) {
		process.exit(0);
	}
	console.error(
		"sync-wasm: rust/wasm/pkg is missing; build it first with `bun run build:wasm`.",
	);
	process.exit(1);
}

for (const base of ["apps/web/node_modules", "node_modules"]) {
	const dest = join(root, base, "mangocut-wasm");
	if (!existsSync(dest)) continue;
	rmSync(dest, { recursive: true, force: true });
	cpSync(pkg, dest, { recursive: true });
	console.log(`synced wasm pkg -> ${base}/mangocut-wasm`);
}
