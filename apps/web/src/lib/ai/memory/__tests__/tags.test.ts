import { describe, expect, test } from "bun:test";
import { deriveMediaTags } from "@/lib/ai/memory/tags";

describe("deriveMediaTags", () => {
	test("extracts distinctive tokens from vision and transcript", () => {
		const tags = deriveMediaTags({
			name: "clip.mp4",
			visionSummary: "Ocean waves at sunset with orange sky",
			transcriptText: "Welcome to the podcast about startups",
		});
		expect(tags).toContain("ocean");
		expect(tags).toContain("sunset");
		expect(tags).toContain("podcast");
		expect(tags).not.toContain("the");
		expect(tags).not.toContain("with");
	});

	test("caps tag count", () => {
		const tags = deriveMediaTags({
			name: "a",
			visionSummary:
				"alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike",
		});
		expect(tags.length).toBeLessThanOrEqual(12);
	});
});
