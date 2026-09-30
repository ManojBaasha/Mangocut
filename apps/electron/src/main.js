const { app, BrowserWindow, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { registerAiIpc } = require("./ai/ipc");

/** Same port as local AI desktop so Google OAuth redirect URIs stay aligned. */
const PRODUCTION_PORT = Number(process.env.MANGOCUT_DESKTOP_PORT || 3045);
const DEV_URL = process.env.MANGOCUT_DEV_URL || "http://127.0.0.1:3000";
const START_PATH = "/projects";

let mainWindow = null;
let nextProcess = null;
let isQuitting = false;
let fileEnvCache = null;

function isDev() {
	return !app.isPackaged;
}

function parseEnvFile(filePath) {
	if (!fs.existsSync(filePath)) {
		return {};
	}

	const out = {};
	const text = fs.readFileSync(filePath, "utf8");
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const eq = line.indexOf("=");
		if (eq <= 0) continue;
		const key = line.slice(0, eq).trim();
		let value = line.slice(eq + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		out[key] = value;
	}
	return out;
}

function loadDesktopFileEnv() {
	if (fileEnvCache) {
		return fileEnvCache;
	}

	const candidates = [];
	if (isDev()) {
		candidates.push(path.join(__dirname, "../../web/.env.local"));
		candidates.push(path.join(__dirname, "../../web/.env"));
	} else {
		candidates.push(
			path.join(process.resourcesPath, "next", "apps", "web", ".env.local"),
		);
		candidates.push(
			path.join(process.resourcesPath, "next", "apps", "web", ".env"),
		);
		try {
			candidates.push(path.join(app.getPath("userData"), ".env.local"));
		} catch {
			// app may not be ready yet in some call sites
		}
	}

	fileEnvCache = {};
	for (const candidate of candidates) {
		Object.assign(fileEnvCache, parseEnvFile(candidate));
	}
	return fileEnvCache;
}

function getNextServerEntry() {
	if (isDev()) {
		return null;
	}

	const resourceRoot = process.resourcesPath;
	const candidates = [
		path.join(resourceRoot, "next", "apps", "web", "server.js"),
		path.join(resourceRoot, "next", "server.js"),
	];

	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) {
			return candidate;
		}
	}

	throw new Error(
		`Next standalone server.js not found under ${resourceRoot}/next`,
	);
}

function waitForUrl(url, { timeoutMs = 60_000, intervalMs = 250 } = {}) {
	const started = Date.now();

	return new Promise((resolve, reject) => {
		const attempt = () => {
			const req = http.get(url, (res) => {
				res.resume();
				if (res.statusCode && res.statusCode < 500) {
					resolve();
					return;
				}
				retry();
			});

			req.on("error", retry);
			req.setTimeout(2000, () => {
				req.destroy();
				retry();
			});
		};

		const retry = () => {
			if (Date.now() - started > timeoutMs) {
				reject(new Error(`Timed out waiting for ${url}`));
				return;
			}
			setTimeout(attempt, intervalMs);
		};

		attempt();
	});
}

function findFreePort() {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const port = typeof address === "object" && address ? address.port : 0;
			server.close((err) => {
				if (err) {
					reject(err);
					return;
				}
				resolve(port);
			});
		});
		server.on("error", reject);
	});
}

function desktopEnv({ port, origin }) {
	const fileEnv = loadDesktopFileEnv();
	const merged = {
		...fileEnv,
		...process.env,
	};

	return {
		...merged,
		ELECTRON_RUN_AS_NODE: "1",
		NODE_ENV: "production",
		MANGOCUT_DESKTOP: "1",
		HOSTNAME: "127.0.0.1",
		PORT: String(port),
		NEXT_PUBLIC_SITE_URL: origin,
		// Packaged app origin must match Google OAuth redirect + Better Auth baseURL
		BETTER_AUTH_URL: origin,
		FREESOUND_CLIENT_ID:
			merged.FREESOUND_CLIENT_ID || process.env.FREESOUND_CLIENT_ID || "",
		FREESOUND_API_KEY:
			merged.FREESOUND_API_KEY || process.env.FREESOUND_API_KEY || "",
		GOOGLE_CLIENT_ID: merged.GOOGLE_CLIENT_ID || "",
		GOOGLE_CLIENT_SECRET: merged.GOOGLE_CLIENT_SECRET || "",
		BETTER_AUTH_SECRET: merged.BETTER_AUTH_SECRET || "",
		BETTER_AUTH_API_KEY: merged.BETTER_AUTH_API_KEY || "",
		OPENROUTER_API_KEY: merged.OPENROUTER_API_KEY || "",
		OPENROUTER_ALLOWED_MODELS: merged.OPENROUTER_ALLOWED_MODELS || "",
		AI_TRIAL_CHAT_TURNS: merged.AI_TRIAL_CHAT_TURNS || "50",
		AI_REQUIRE_AUTH: merged.AI_REQUIRE_AUTH || "false",
	};
}

async function startNextServer() {
	const serverEntry = getNextServerEntry();
	const port = PRODUCTION_PORT;
	const origin = `http://127.0.0.1:${port}`;
	const cwd = path.dirname(serverEntry);

	const free = await new Promise((resolve) => {
		const server = net.createServer();
		server.once("error", () => resolve(false));
		server.once("listening", () => {
			server.close(() => resolve(true));
		});
		server.listen(port, "127.0.0.1");
	});
	if (!free) {
		throw new Error(
			`Port ${port} is already in use. Quit the other Mangocut / AI desktop instance, then reopen the app. Google sign-in requires http://127.0.0.1:${port}.`,
		);
	}

	nextProcess = spawn(process.execPath, [serverEntry], {
		cwd,
		env: desktopEnv({ port, origin }),
		stdio: ["ignore", "pipe", "pipe"],
	});

	nextProcess.stdout?.on("data", (chunk) => {
		console.log(`[next] ${chunk}`.trimEnd());
	});
	nextProcess.stderr?.on("data", (chunk) => {
		console.error(`[next] ${chunk}`.trimEnd());
	});
	nextProcess.on("exit", (code, signal) => {
		nextProcess = null;
		if (!isQuitting) {
			console.error(
				`Next server exited unexpectedly (code=${code}, signal=${signal})`,
			);
		}
	});

	await waitForUrl(`${origin}/api/health`);
	return origin;
}

async function resolveAppOrigin() {
	if (isDev()) {
		await waitForUrl(`${DEV_URL}/api/health`).catch(async () => {
			await waitForUrl(DEV_URL);
		});
		return DEV_URL;
	}

	return startNextServer();
}

function createWindow(origin) {
	mainWindow = new BrowserWindow({
		width: 1440,
		height: 900,
		minWidth: 1024,
		minHeight: 680,
		title: "Mangocut",
		show: false,
		webPreferences: {
			preload: path.join(__dirname, "preload.js"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});

	mainWindow.once("ready-to-show", () => {
		mainWindow?.show();
	});

	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		shell.openExternal(url);
		return { action: "deny" };
	});

	mainWindow.loadURL(`${origin}${START_PATH}`);

	mainWindow.on("closed", () => {
		mainWindow = null;
	});
}

function stopNextServer() {
	if (!nextProcess) {
		return;
	}

	const child = nextProcess;
	nextProcess = null;
	child.kill("SIGTERM");
	setTimeout(() => {
		if (!child.killed) {
			child.kill("SIGKILL");
		}
	}, 3000).unref?.();
}

app.whenReady().then(async () => {
	registerAiIpc({
		getMainWindow: () => mainWindow,
	});

	try {
		const origin = await resolveAppOrigin();
		createWindow(origin);
	} catch (error) {
		console.error("Failed to start Mangocut desktop:", error);
		app.quit();
	}

	app.on("activate", async () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			try {
				const origin = isDev()
					? DEV_URL
					: `http://127.0.0.1:${PRODUCTION_PORT}`;
				if (!isDev() && !nextProcess) {
					await startNextServer();
				}
				createWindow(origin);
			} catch (error) {
				console.error(error);
			}
		}
	});
});

app.on("before-quit", () => {
	isQuitting = true;
	stopNextServer();
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});
