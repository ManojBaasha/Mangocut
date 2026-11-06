import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { AdminAuthUser } from "@/lib/ai/admin-usage";

function resolveDataDir(): string {
	const configured = process.env.MANGOCUT_DATA_DIR;
	if (configured) return configured;
	return path.join(process.cwd(), ".data");
}

export function listAuthUsers(): AdminAuthUser[] {
	const dbPath = path.join(resolveDataDir(), "mangocut-auth.sqlite");
	if (!fs.existsSync(dbPath)) return [];
	const db = new Database(dbPath, { readonly: true });
	try {
		const rows = db
			.prepare(
				`SELECT id, email, name, createdAt FROM user ORDER BY createdAt DESC`,
			)
			.all() as Array<{
			id: string;
			email: string;
			name: string;
			createdAt: string;
		}>;
		return rows.map((row) => ({
			id: row.id,
			email: row.email,
			name: row.name,
			createdAt: row.createdAt,
		}));
	} finally {
		db.close();
	}
}
