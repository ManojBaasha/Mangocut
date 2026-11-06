import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface AiUsageRecord {
	turns: number;
	/** Cumulative OpenRouter cost in USD for this key. */
	costUsd: number;
	updatedAt: string;
}

function resolveUsagePath(): string {
	// Vercel Functions can only write to the temp dir (per-instance, not durable).
	const dir =
		process.env.MANGOCUT_DATA_DIR ||
		(process.env.VERCEL
			? path.join(os.tmpdir(), "mangocut-data")
			: path.join(process.cwd(), ".data"));
	fs.mkdirSync(dir, { recursive: true });
	return path.join(dir, "ai-usage.json");
}

function readAll(): Record<string, AiUsageRecord> {
	const filePath = resolveUsagePath();
	if (!fs.existsSync(filePath)) return {};
	try {
		const raw = fs.readFileSync(filePath, "utf8");
		const parsed = JSON.parse(raw) as Record<string, Partial<AiUsageRecord>>;
		if (!parsed || typeof parsed !== "object") return {};
		const normalized: Record<string, AiUsageRecord> = {};
		for (const [key, value] of Object.entries(parsed)) {
			if (!value || typeof value !== "object") continue;
			normalized[key] = {
				turns: typeof value.turns === "number" ? value.turns : 0,
				costUsd: typeof value.costUsd === "number" ? value.costUsd : 0,
				updatedAt:
					typeof value.updatedAt === "string"
						? value.updatedAt
						: new Date().toISOString(),
			};
		}
		return normalized;
	} catch {
		return {};
	}
}

function writeAll({ data }: { data: Record<string, AiUsageRecord> }): void {
	fs.writeFileSync(resolveUsagePath(), JSON.stringify(data, null, 2), "utf8");
}

export function getAiUsageTurns({ key }: { key: string }): number {
	return readAll()[key]?.turns ?? 0;
}

export function getAiUsageCostUsd({ key }: { key: string }): number {
	return readAll()[key]?.costUsd ?? 0;
}

export function listAllAiUsage(): Record<string, AiUsageRecord> {
	return readAll();
}

export function incrementAiUsageTurns({
	key,
	costUsd = 0,
}: {
	key: string;
	costUsd?: number;
}): { turns: number; costUsd: number } {
	const data = readAll();
	const prev = data[key];
	const nextTurns = (prev?.turns ?? 0) + 1;
	const nextCost =
		Math.round(((prev?.costUsd ?? 0) + Math.max(0, costUsd)) * 1_000_000) /
		1_000_000;
	data[key] = {
		turns: nextTurns,
		costUsd: nextCost,
		updatedAt: new Date().toISOString(),
	};
	writeAll({ data });
	return { turns: nextTurns, costUsd: nextCost };
}
