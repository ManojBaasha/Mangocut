import type { AiUsageRecord } from "@/lib/ai/usage-store";

export interface AdminAuthUser {
	id: string;
	email: string;
	name: string;
	createdAt: string;
}

export interface AdminUserRow {
	userId: string;
	email: string;
	name: string;
	createdAt: string;
	turns: number;
	costUsd: number;
	usageUpdatedAt: string | null;
	remainingTurns: number;
	trialExhausted: boolean;
}

export interface AdminUsageReport {
	totals: {
		userCount: number;
		totalTurns: number;
		totalCostUsd: number;
		exhaustedCount: number;
	};
	rows: AdminUserRow[];
}

export function buildAdminUsageReport({
	users,
	usageByKey,
	turnLimit,
	spendLimitUsd,
}: {
	users: AdminAuthUser[];
	usageByKey: Record<string, AiUsageRecord>;
	turnLimit: number;
	spendLimitUsd: number | null;
}): AdminUsageReport {
	const rows: AdminUserRow[] = users.map((user) => {
		const usage = usageByKey[`user:${user.id}`];
		const turns = usage?.turns ?? 0;
		const costUsd = usage?.costUsd ?? 0;
		const remainingTurns = Math.max(0, turnLimit - turns);
		const trialExhausted =
			remainingTurns <= 0 ||
			(spendLimitUsd != null && costUsd >= spendLimitUsd);
		return {
			userId: user.id,
			email: user.email,
			name: user.name,
			createdAt: user.createdAt,
			turns,
			costUsd,
			usageUpdatedAt: usage?.updatedAt ?? null,
			remainingTurns: trialExhausted ? 0 : remainingTurns,
			trialExhausted,
		};
	});

	rows.sort((a, b) => b.costUsd - a.costUsd || b.turns - a.turns);

	return {
		totals: {
			userCount: rows.length,
			totalTurns: rows.reduce((n, r) => n + r.turns, 0),
			totalCostUsd:
				Math.round(rows.reduce((n, r) => n + r.costUsd, 0) * 1_000_000) /
				1_000_000,
			exhaustedCount: rows.filter((r) => r.trialExhausted).length,
		},
		rows,
	};
}
