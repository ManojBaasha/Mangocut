#!/usr/bin/env bun
/**
 * Ask the host LaunchAgent to start/restart Mangocut AI desktop.
 * Works from a sandboxed agent (only needs workspace write access).
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const TRIG_DIR = path.join(ROOT, "script/triggers");
const TRIG = path.join(TRIG_DIR, "start-ai-desktop.request");
const INSTALLED = path.join(
	process.env.HOME || "",
	"Library/LaunchAgents/dev.jonam.mangocut.ai-desktop.plist",
);

mkdirSync(TRIG_DIR, { recursive: true });

if (!existsSync(INSTALLED)) {
	console.error(
		"AI desktop watcher is not installed. Run once in Terminal:\n\n  bash script/install-ai-desktop-watcher.sh\n",
	);
	process.exit(2);
}

writeFileSync(TRIG, `${new Date().toISOString()}\n`, "utf8");
console.log(`Triggered AI desktop start via ${TRIG}`);
console.log("Watch logs: tail -f script/triggers/start-ai-desktop.log");
