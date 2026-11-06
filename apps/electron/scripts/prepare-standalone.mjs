import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const electronRoot = path.join(__dirname, "..");
const repoRoot = path.join(electronRoot, "../..");
const webRoot = path.join(repoRoot, "apps/web");
const standaloneRoot = path.join(webRoot, ".next/standalone");
const staticDir = path.join(webRoot, ".next/static");
const publicDir = path.join(webRoot, "public");
const outDir = path.join(electronRoot, "resources/next");

function findServerJs(dir) {
	const entries = readdirSync(dir);
	for (const entry of entries) {
		const full = path.join(dir, entry);
		const stats = statSync(full);
		if (stats.isDirectory()) {
			if (entry === "node_modules") continue;
			const nested = findServerJs(full);
			if (nested) return nested;
		} else if (entry === "server.js" && full.includes(`${path.sep}apps${path.sep}web${path.sep}`)) {
			return full;
		}
	}
	// Fallback: any server.js that isn't inside next's own package
	for (const entry of entries) {
		const full = path.join(dir, entry);
		const stats = statSync(full);
		if (stats.isDirectory() && entry !== "node_modules") {
			const nested = findServerJs(full);
			if (nested) return nested;
		} else if (entry === "server.js" && !full.includes(`${path.sep}node_modules${path.sep}`)) {
			return full;
		}
	}
	return null;
}

if (!existsSync(standaloneRoot)) {
	console.error(`Missing ${standaloneRoot}. Run bun run build:web first.`);
	process.exit(1);
}

if (!existsSync(staticDir)) {
	console.error(`Missing ${staticDir}. Run bun run build:web first.`);
	process.exit(1);
}

const serverJs = findServerJs(standaloneRoot);
if (!serverJs) {
	console.error("Could not locate apps/web/server.js inside .next/standalone");
	process.exit(1);
}

// Prefer copying the traced monorepo root that contains apps/web/server.js
let copyFrom = path.dirname(serverJs); // .../apps/web
copyFrom = path.dirname(copyFrom); // .../apps
copyFrom = path.dirname(copyFrom); // monorepo-ish root inside standalone

console.log(`Using standalone root: ${copyFrom}`);
console.log(`Server entry: ${serverJs}`);

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
cpSync(copyFrom, outDir, { recursive: true });

const outWeb = path.join(outDir, "apps/web");
mkdirSync(path.join(outWeb, ".next"), { recursive: true });
cpSync(staticDir, path.join(outWeb, ".next/static"), { recursive: true });

if (existsSync(publicDir)) {
	cpSync(publicDir, path.join(outWeb, "public"), { recursive: true });
}

// Local secrets for packaged desktop — strip OpenRouter when cloud AI is configured
const envLocal = path.join(webRoot, ".env.local");
const outEnv = path.join(outWeb, ".env.local");

function readEnvValue(text, key) {
	const match = text.match(new RegExp(`^${key}=(.*)$`, "m"));
	if (!match) return "";
	return match[1].trim().replace(/^['"]|['"]$/g, "");
}

let sourceEnvText = existsSync(envLocal) ? readFileSync(envLocal, "utf8") : "";
const cloudOrigin = (
	process.env.NEXT_PUBLIC_MANGOCUT_CLOUD_ORIGIN ||
	process.env.MANGOCUT_CLOUD_ORIGIN ||
	readEnvValue(sourceEnvText, "NEXT_PUBLIC_MANGOCUT_CLOUD_ORIGIN") ||
	readEnvValue(sourceEnvText, "MANGOCUT_CLOUD_ORIGIN") ||
	""
).replace(/\/$/, "");

if (existsSync(envLocal)) {
	cpSync(envLocal, outEnv);
	console.log("Copied apps/web/.env.local into Electron Next resources");
}

if (cloudOrigin || existsSync(outEnv)) {
	let text = existsSync(outEnv) ? readFileSync(outEnv, "utf8") : "";
	const setKey = (key, value) => {
		const line = `${key}=${value}`;
		const re = new RegExp(`^${key}=.*$`, "m");
		if (re.test(text)) text = text.replace(re, line);
		else text = `${text.trimEnd()}\n${line}\n`;
	};
	if (cloudOrigin) {
		setKey("NEXT_PUBLIC_MANGOCUT_CLOUD_ORIGIN", cloudOrigin);
		setKey("MANGOCUT_CLOUD_ORIGIN", cloudOrigin);
		setKey("OPENROUTER_API_KEY", "");
		setKey("GOOGLE_CLIENT_SECRET", "");
		setKey("BETTER_AUTH_SECRET", "");
		console.log(
			`Cloud AI mode: ${cloudOrigin} (OpenRouter + local auth secrets cleared from DMG env)`,
		);
	}
	writeFileSync(outEnv, text.endsWith("\n") ? text : `${text}\n`);
}

const preparedServer = path.join(outWeb, "server.js");
if (!existsSync(preparedServer)) {
	console.error(`Expected ${preparedServer} after copy`);
	process.exit(1);
}

console.log(`Prepared Electron Next resources at ${outDir}`);
