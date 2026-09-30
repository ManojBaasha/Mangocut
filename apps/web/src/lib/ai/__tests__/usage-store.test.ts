import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("ai usage store", () => {
	test("increments turns for a key", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mangocut-ai-usage-"));
		process.env.MANGOCUT_DATA_DIR = dir;
		const { getAiUsageTurns, incrementAiUsageTurns } = await import(
			"../usage-store"
		);
		expect(getAiUsageTurns({ key: "user:test" })).toBe(0);
		expect(incrementAiUsageTurns({ key: "user:test" })).toBe(1);
		expect(incrementAiUsageTurns({ key: "user:test" })).toBe(2);
		expect(getAiUsageTurns({ key: "user:test" })).toBe(2);
	});
});
