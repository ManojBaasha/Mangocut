import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("ai usage store", () => {
	test("increments turns and cost for a key", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mangocut-ai-usage-"));
		process.env.MANGOCUT_DATA_DIR = dir;
		const {
			getAiUsageTurns,
			getAiUsageCostUsd,
			incrementAiUsageTurns,
		} = await import("../usage-store");
		expect(getAiUsageTurns({ key: "user:test" })).toBe(0);
		expect(getAiUsageCostUsd({ key: "user:test" })).toBe(0);
		expect(incrementAiUsageTurns({ key: "user:test", costUsd: 0.0123 })).toEqual(
			{ turns: 1, costUsd: 0.0123 },
		);
		expect(incrementAiUsageTurns({ key: "user:test", costUsd: 0.004 })).toEqual(
			{ turns: 2, costUsd: 0.0163 },
		);
		expect(getAiUsageTurns({ key: "user:test" })).toBe(2);
		expect(getAiUsageCostUsd({ key: "user:test" })).toBe(0.0163);
	});
});
