#!/usr/bin/env bun
/**
 * Mangocut AI desktop launcher for local iteration.
 * Starts Next (web) + Electron against a fixed port.
 *
 * Agents must run this with required_permissions: ["all"]
 * so OpenRouter DNS, process cleanup, and Electron GUI work.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const WEB = path.join(ROOT, "apps/web");
const ELECTRON_DIR = path.join(ROOT, "apps/electron");
const PORT = Number(process.env.MANGOCUT_AI_PORT || 3045);
const HOST = "127.0.0.1";
const ORIGIN = `http://${HOST}:${PORT}`;

const children = [];

function bin(name) {
	const local = path.join(ROOT, "node_modules", ".bin", name);
	return existsSync(local) ? local : name;
}

function run(command, args, { cwd, env = {}, name }) {
	const child = spawn(command, args, {
		cwd,
		env: {
			...process.env,
			...env,
			ELECTRON_RUN_AS_NODE: "",
			PATH: `${path.join(ROOT, "node_modules", ".bin")}:${process.env.PATH || ""}`,
		},
		stdio: "inherit",
		detached: false,
	});
	child.on("exit", (code, signal) => {
		console.log(`[${name}] exited code=${code} signal=${signal}`);
	});
	children.push(child);
	return child;
}

async function portFree(port) {
	return new Promise((resolve) => {
		const server = createServer();
		server.once("error", () => resolve(false));
		server.once("listening", () => {
			server.close(() => resolve(true));
		});
		server.listen(port, HOST);
	});
}

async function waitForHealth(timeoutMs = 90_000) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			const res = await fetch(`${ORIGIN}/api/health`);
			if (res.ok) return;
		} catch {
			// retry
		}
		await Bun.sleep(250);
	}
	throw new Error(`Timed out waiting for ${ORIGIN}/api/health`);
}

async function killPortHolders() {
	if (await portFree(PORT)) return;
	console.log(`Port ${PORT} busy — trying to free it...`);
	try {
		const proc = spawn("lsof", [`-tiTCP:${PORT}`, "-sTCP:LISTEN"], {
			stdio: ["ignore", "pipe", "ignore"],
		});
		const chunks = [];
		for await (const chunk of proc.stdout) chunks.push(chunk);
		const pids = Buffer.concat(chunks)
			.toString("utf8")
			.trim()
			.split(/\s+/)
			.filter(Boolean);
		for (const pid of pids) {
			try {
				process.kill(Number(pid), "SIGKILL");
				console.log(`Killed pid ${pid} on :${PORT}`);
			} catch (err) {
				console.warn(`Could not kill ${pid}:`, err.message);
			}
		}
		await Bun.sleep(500);
	} catch (err) {
		console.warn("Port cleanup failed:", err.message);
	}
}

function shutdown() {
	for (const child of children) {
		try {
			child.kill("SIGTERM");
		} catch {
			// ignore
		}
	}
	setTimeout(() => process.exit(0), 500).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const lock = path.join(WEB, ".next/dev/lock");
if (existsSync(lock)) {
	try {
		rmSync(lock);
	} catch {
		// ignore
	}
}

await killPortHolders();

console.log(`Starting Next on ${ORIGIN}`);
run(bin("next"), ["dev", "--turbopack", "-p", String(PORT), "-H", HOST], {
	cwd: WEB,
	env: {
		NEXT_PUBLIC_SITE_URL: ORIGIN,
	},
	name: "web",
});

await waitForHealth();
console.log("Web ready.");

try {
	const models = await fetch(`${ORIGIN}/api/ai/models`).then((r) => r.json());
	console.log(
		`AI proxy: hasKey=${Boolean(models.hasKey)} models=${(models.models || []).length}`,
	);
} catch (err) {
	console.warn("AI models probe failed:", err.message);
}

const electronBin = bin("electron");
console.log(`Starting Electron → ${ORIGIN}`);
const electron = run(electronBin, ["."], {
	cwd: ELECTRON_DIR,
	env: {
		MANGOCUT_DEV_URL: ORIGIN,
		MANGOCUT_AI_ORIGIN: ORIGIN,
		ELECTRON_RUN_AS_NODE: "",
	},
	name: "electron",
});

electron.on("exit", () => shutdown());
