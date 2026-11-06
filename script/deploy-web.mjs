#!/usr/bin/env node
// Deploy the web app to Vercel, built remotely from a repo-root upload.
//
// The build must run on Vercel's Linux machines: the auth server uses
// better-sqlite3, and a build made on macOS ships a darwin binary that cannot
// load in Vercel Functions. A repo-root upload gives Vercel rust/ (for the wasm
// build) and the workspace lockfile; .vercelignore keeps local artifacts out.
//
// Requires the Vercel project's Root Directory to be `apps/web` with "Include
// source files outside of the Root Directory" on (see README).
//
// Usage: bun run deploy:web           (preview)
//        bun run deploy:web -- --prod (production)
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prod = process.argv.includes("--prod");
const rootLink = path.join(repoRoot, ".vercel", "project.json");
const appLink = path.join(repoRoot, "apps", "web", ".vercel", "project.json");

function vercel(args, { capture = false } = {}) {
	const result = spawnSync("vercel", args, {
		cwd: repoRoot,
		stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
		encoding: "utf8",
	});
	if (result.status !== 0) process.exit(result.status ?? 1);
	return result.stdout;
}

// Link the repo root (reuse an existing apps/web link if that's all there is).
if (!existsSync(rootLink)) {
	if (!existsSync(appLink)) {
		console.error("No Vercel link found. From the repo root run:\n  vercel link --project mangocut");
		process.exit(1);
	}
	const { projectId, orgId, projectName } = JSON.parse(readFileSync(appLink, "utf8"));
	mkdirSync(path.dirname(rootLink), { recursive: true });
	writeFileSync(rootLink, `${JSON.stringify({ projectId, orgId, projectName }, null, 2)}\n`);
}

const { projectId, orgId } = JSON.parse(readFileSync(rootLink, "utf8"));
const project = JSON.parse(
	vercel(["api", `/v9/projects/${projectId}?teamId=${orgId}`], { capture: true }),
);
if (project.rootDirectory !== "apps/web" || project.sourceFilesOutsideRootDirectory === false) {
	console.error(
		`Vercel project "${project.name}" needs Root Directory = apps/web (currently ${JSON.stringify(project.rootDirectory)})\n` +
			'and "Include source files outside of the Root Directory in the Build Step" enabled.\n' +
			"Set them in the dashboard (Settings → Build and Deployment) or with:\n" +
			`  vercel api "/v9/projects/${projectId}?teamId=${orgId}" -X PATCH -F rootDirectory=apps/web`,
	);
	process.exit(1);
}

vercel(["deploy", ...(prod ? ["--prod"] : [])]);
