/**
 * Creates Better Auth core tables.
 * Prefer `node script/migrate-auth.mjs` (better-sqlite3) when Next runs under Node.
 * Also safe under Bun via bun:sqlite fallback.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const dataDir =
	process.env.MANGOCUT_DATA_DIR || path.join(process.cwd(), ".data");
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, "mangocut-auth.sqlite");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS "user" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "emailVerified" INTEGER NOT NULL,
  "image" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS "session" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "expiresAt" TEXT NOT NULL,
  "token" TEXT NOT NULL UNIQUE,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS "account" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "idToken" TEXT,
  "accessTokenExpiresAt" TEXT,
  "refreshTokenExpiresAt" TEXT,
  "scope" TEXT,
  "password" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS "verification" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expiresAt" TEXT NOT NULL,
  "createdAt" TEXT,
  "updatedAt" TEXT
);
`;

async function main() {
	try {
		const require = createRequire(import.meta.url);
		const Database = require("better-sqlite3");
		const db = new Database(dbPath);
		db.exec(SCHEMA);
		const tables = db
			.prepare(
				`SELECT name from sqlite_master WHERE type='table' ORDER BY name`,
			)
			.all();
		console.log(`Migrated (better-sqlite3) ${dbPath}`);
		console.log(
			"Tables:",
			tables.map((t) => t.name).join(", "),
		);
		db.close();
		return;
	} catch (error) {
		console.warn(
			"better-sqlite3 unavailable, trying bun:sqlite:",
			error instanceof Error ? error.message : error,
		);
	}

	const { Database } = await import("bun:sqlite");
	const db = new Database(dbPath);
	db.exec(SCHEMA);
	const tables = db
		.query(`SELECT name from sqlite_master WHERE type='table' ORDER BY name`)
		.all();
	console.log(`Migrated (bun:sqlite) ${dbPath}`);
	console.log(
		"Tables:",
		tables.map((t) => t.name).join(", "),
	);
	db.close();
}

await main();
