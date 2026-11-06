// Copies rust/wasm/pkg into every installed `mangocut-wasm` (bun copies `file:`
// deps, so a rebuild would otherwise stay stale until the next install).
import { cpSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = join(root, "rust", "wasm", "pkg");
for (const base of ["apps/web/node_modules", "node_modules"]) {
	const dest = join(root, base, "mangocut-wasm");
	if (!existsSync(dest)) continue;
	rmSync(dest, { recursive: true, force: true });
	cpSync(pkg, dest, { recursive: true });
	console.log(`synced wasm pkg -> ${base}/mangocut-wasm`);
}
