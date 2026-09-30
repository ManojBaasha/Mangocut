import { describe, expect, test } from "bun:test";
import { findFillerRanges } from "@/lib/ai/speech/filler";

describe("findFillerRanges", () => {
	test("finds um/uh fillers", () => {
		const ranges = findFillerRanges({
			segments: [
				{ start: 0, end: 0.4, text: "Um" },
				{ start: 0.5, end: 1.2, text: "hello there" },
				{ start: 1.3, end: 1.6, text: "uh" },
				{ start: 1.7, end: 2.5, text: "friends" },
			],
		});
		expect(ranges).toEqual([
			{ start: 0, end: 0.4, text: "Um" },
			{ start: 1.3, end: 1.6, text: "uh" },
		]);
	});

	test("ignores non-fillers", () => {
		expect(
			findFillerRanges({
				segments: [{ start: 0, end: 1, text: "completely fine speech" }],
			}),
		).toEqual([]);
	});
});
