import { describe, expect, test } from "bun:test";

describe("shadow generation diverge", () => {
	test("diverges when finalGeneration advances past base", () => {
		const base = 3;
		let finalGeneration = 3;
		const isDiverged = () => finalGeneration !== base;
		expect(isDiverged()).toBe(false);
		finalGeneration += 1;
		expect(isDiverged()).toBe(true);
	});
});
