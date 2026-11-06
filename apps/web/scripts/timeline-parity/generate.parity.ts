/**
 * Generates (UPDATE_GOLDENS=1) or verifies the golden files the Rust timeline
 * crate replays (rust/crates/timeline/tests/fixtures/goldens).
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cases } from "./cases";
import { runTsOp } from "./harness";

const here = dirname(fileURLToPath(import.meta.url));
const goldensDir = resolve(
	here,
	"../../../../rust/crates/timeline/tests/fixtures/goldens",
);
const update = process.env.UPDATE_GOLDENS === "1";

describe("timeline parity goldens", () => {
	for (const testCase of cases) {
		test(testCase.name, () => {
			const expected = runTsOp({
				tracks: testCase.input,
				op: testCase.op,
				newIds: testCase.newIds,
				ripple: testCase.ripple,
			});
			const golden: Record<string, unknown> = {
				name: testCase.name,
				input: testCase.input,
				op: testCase.op,
				newIds: testCase.newIds,
				ripple: testCase.ripple ?? false,
				expected,
			};
			if (testCase.expectedError) golden.expectedError = testCase.expectedError;
			const text = `${JSON.stringify(golden, null, 2)}\n`;
			const path = resolve(goldensDir, `${testCase.name}.json`);
			if (update) {
				mkdirSync(goldensDir, { recursive: true });
				writeFileSync(path, text);
				return;
			}
			expect(existsSync(path)).toBe(true);
			expect(readFileSync(path, "utf8")).toBe(text);
		});
	}
});
