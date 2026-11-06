const STORAGE_KEY = "mangocut-ai-usage-by-project";

export interface ProjectAiUsage {
	turns: number;
	/** Cumulative OpenRouter cost in USD for this project (this browser). */
	costUsd: number;
	updatedAt: string;
}

function readAll(): Record<string, ProjectAiUsage> {
	if (typeof window === "undefined") return {};
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw) as Record<string, Partial<ProjectAiUsage>>;
		if (!parsed || typeof parsed !== "object") return {};
		const normalized: Record<string, ProjectAiUsage> = {};
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

function writeAll({ data }: { data: Record<string, ProjectAiUsage> }): void {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function getProjectAiUsageMap(): Record<string, ProjectAiUsage> {
	return readAll();
}

export function getProjectAiTurns({ projectId }: { projectId: string }): number {
	return readAll()[projectId]?.turns ?? 0;
}

export function recordProjectAiUsage({
	projectId,
	costUsd = 0,
}: {
	projectId: string;
	costUsd?: number;
}): ProjectAiUsage {
	if (!projectId) {
		return { turns: 0, costUsd: 0, updatedAt: new Date().toISOString() };
	}
	const data = readAll();
	const prev = data[projectId];
	const next: ProjectAiUsage = {
		turns: (prev?.turns ?? 0) + 1,
		costUsd:
			Math.round(((prev?.costUsd ?? 0) + Math.max(0, costUsd)) * 1_000_000) /
			1_000_000,
		updatedAt: new Date().toISOString(),
	};
	data[projectId] = next;
	writeAll({ data });
	return next;
}

/** @deprecated Prefer recordProjectAiUsage */
export function recordProjectAiTurn({
	projectId,
}: {
	projectId: string;
}): number {
	return recordProjectAiUsage({ projectId }).turns;
}

export function formatUsd({ amount }: { amount: number }): string {
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		minimumFractionDigits: 2,
		maximumFractionDigits: 4,
	}).format(amount);
}
