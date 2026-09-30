import { betterAuth } from "better-auth";
import { dash } from "@better-auth/infra";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

function resolveDataDir(): string {
	const configured = process.env.MANGOCUT_DATA_DIR;
	if (configured) return configured;
	return path.join(process.cwd(), ".data");
}

function ensureDataDir({ dir }: { dir: string }): void {
	fs.mkdirSync(dir, { recursive: true });
}

function ensureAuthSchema({ db }: { db: Database.Database }): void {
	db.exec(`
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
`);
}

const dataDir = resolveDataDir();
ensureDataDir({ dir: dataDir });

const dbPath = path.join(dataDir, "mangocut-auth.sqlite");
const sqlite = new Database(dbPath);
ensureAuthSchema({ db: sqlite });

const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim() || "";
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || "";
const infraApiKey = process.env.BETTER_AUTH_API_KEY?.trim() || "";

export const isGoogleAuthConfigured = Boolean(
	googleClientId && googleClientSecret,
);

export const isBetterAuthInfraConfigured = Boolean(infraApiKey);

/**
 * Mangocut Better Auth instance.
 * Exported as `auth` for the Better Auth CLI (`src/lib/auth.ts` re-exports).
 */
export const auth = betterAuth({
	appName: "Mangocut",
	database: sqlite,
	baseURL:
		process.env.BETTER_AUTH_URL ||
		process.env.NEXT_PUBLIC_SITE_URL ||
		"http://127.0.0.1:3045",
	secret:
		process.env.BETTER_AUTH_SECRET ||
		"mangocut-dev-secret-change-me-in-production",
	trustedOrigins: [
		process.env.BETTER_AUTH_URL || "http://127.0.0.1:3045",
		process.env.NEXT_PUBLIC_SITE_URL || "",
		"http://127.0.0.1:3045",
		"http://localhost:3045",
		"http://127.0.0.1:47823",
		"http://localhost:47823",
	].filter(Boolean),
	...(isGoogleAuthConfigured
		? {
				socialProviders: {
					google: {
						clientId: googleClientId,
						clientSecret: googleClientSecret,
					},
				},
			}
		: {}),
	plugins: [
		...(isBetterAuthInfraConfigured
			? [
					dash({
						apiKey: infraApiKey,
					}),
				]
			: []),
	],
});

export type AuthSession = typeof auth.$Infer.Session;
