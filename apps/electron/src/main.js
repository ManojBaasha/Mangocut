const { app, BrowserWindow, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

/** Fixed port so NEXT_PUBLIC_SITE_URL stays valid in packaged builds. */
const PRODUCTION_PORT = 47823;
const DEV_URL = process.env.MANGOCUT_DEV_URL || "http://127.0.0.1:3000";
const START_PATH = "/projects";

let mainWindow = null;
let nextProcess = null;
let isQuitting = false;

function isDev() {
	return !app.isPackaged;
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
	return {
		...process.env,
		ELECTRON_RUN_AS_NODE: "1",
		NODE_ENV: "production",
		MANGOCUT_DESKTOP: "1",
		HOSTNAME: "127.0.0.1",
		PORT: String(port),
		NEXT_PUBLIC_SITE_URL: origin,
		FREESOUND_CLIENT_ID: process.env.FREESOUND_CLIENT_ID || "",
		FREESOUND_API_KEY: process.env.FREESOUND_API_KEY || "",
	};
}

async function startNextServer() {
	const serverEntry = getNextServerEntry();
	const port = PRODUCTION_PORT;
	const origin = `http://127.0.0.1:${port}`;
	const cwd = path.dirname(serverEntry);

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
