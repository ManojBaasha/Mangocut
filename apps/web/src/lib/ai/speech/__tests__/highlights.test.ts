import { describe, expect, test } from "bun:test";
import { rankHighlights } from "@/lib/ai/speech/highlights";

describe("rankHighlights", () => {
	test("prefers question and longer substantive segments", () => {
		const hits = rankHighlights({
			segments: [
				{ start: 0, end: 0.5, text: "um" },
				{ start: 1, end: 4, text: "Why does this product matter for creators?" },
				{ start: 5, end: 6, text: "ok" },
				{
					start: 7,
					end: 12,
					text: "The important breakthrough was shipping local AI editing.",
				},
			],
			maxClips: 2,
			targetSeconds: 5,
		});
		expect(hits.length).toBe(2);
		expect(hits[0].quote.toLowerCase()).toContain("why");
		expect(hits[0].score).toBeGreaterThan(hits[1].score);
	});
});
