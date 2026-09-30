import fs from "node:fs";
import path from "node:path";

export interface AiUsageRecord {
	turns: number;
	updatedAt: string;
}

function resolveUsagePath(): string {
	const dir =
		process.env.MANGOCUT_DATA_DIR || path.join(process.cwd(), ".data");
	fs.mkdirSync(dir, { recursive: true });
	return path.join(dir, "ai-usage.json");
}

function readAll(): Record<string, AiUsageRecord> {
	const filePath = resolveUsagePath();
	if (!fs.existsSync(filePath)) return {};
	try {
		const raw = fs.readFileSync(filePath, "utf8");
		const parsed = JSON.parse(raw) as Record<string, AiUsageRecord>;
		return parsed && typeof parsed === "object" ? parsed : {};
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

export function incrementAiUsageTurns({ key }: { key: string }): number {
	const data = readAll();
	const nextTurns = (data[key]?.turns ?? 0) + 1;
	data[key] = { turns: nextTurns, updatedAt: new Date().toISOString() };
	writeAll({ data });
	return nextTurns;
}
