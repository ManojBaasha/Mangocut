import { describe, expect, test } from "bun:test";
import { buildAdminUsageReport } from "../admin-usage";

describe("buildAdminUsageReport", () => {
	test("joins user ids to user:{id} usage and sums totals", () => {
		const report = buildAdminUsageReport({
			users: [
				{
					id: "u1",
					email: "a@x.com",
					name: "A",
					createdAt: "2026-01-01",
				},
				{
					id: "u2",
					email: "b@x.com",
					name: "B",
					createdAt: "2026-01-02",
				},
			],
			usageByKey: {
				"user:u1": {
					turns: 3,
					costUsd: 0.05,
					updatedAt: "2026-01-03",
				},
			},
			turnLimit: 50,
			spendLimitUsd: 2,
		});
		expect(report.totals.userCount).toBe(2);
		expect(report.totals.totalTurns).toBe(3);
		expect(report.totals.totalCostUsd).toBe(0.05);
		expect(report.totals.exhaustedCount).toBe(0);
		const u1 = report.rows.find((r) => r.userId === "u1");
		expect(u1?.remainingTurns).toBe(47);
		expect(u1?.costUsd).toBe(0.05);
		expect(u1?.trialExhausted).toBe(false);
		const u2 = report.rows.find((r) => r.userId === "u2");
		expect(u2?.turns).toBe(0);
		expect(u2?.remainingTurns).toBe(50);
	});

	test("marks exhausted when turns or spend hit limit", () => {
		const byTurns = buildAdminUsageReport({
			users: [
				{ id: "u1", email: "a@x.com", name: "A", createdAt: "2026-01-01" },
			],
			usageByKey: {
				"user:u1": { turns: 50, costUsd: 0.1, updatedAt: "2026-01-03" },
			},
			turnLimit: 50,
			spendLimitUsd: null,
		});
		expect(byTurns.rows[0]?.trialExhausted).toBe(true);
		expect(byTurns.totals.exhaustedCount).toBe(1);

		const bySpend = buildAdminUsageReport({
			users: [
				{ id: "u1", email: "a@x.com", name: "A", createdAt: "2026-01-01" },
			],
			usageByKey: {
				"user:u1": { turns: 1, costUsd: 2, updatedAt: "2026-01-03" },
			},
			turnLimit: 50,
			spendLimitUsd: 2,
		});
		expect(bySpend.rows[0]?.trialExhausted).toBe(true);
	});
});
