import { describe, expect, test } from "bun:test";
import { searchMediaAssets } from "@/lib/ai/memory/search-media";
import type { MediaAssetData } from "@/services/storage/types";

function asset(partial: Partial<MediaAssetData> & Pick<MediaAssetData, "id" | "name">): MediaAssetData {
	return {
		type: "video",
		size: 1,
		lastModified: 0,
		...partial,
	};
}

describe("searchMediaAssets", () => {
	const library = [
		asset({
			id: "a1",
			name: "clip-001.mp4",
			vision: {
				summary: "Ocean waves at sunset with orange sky",
				frames: [{ timeSeconds: 1, description: "blue water", capturedAt: "t" }],
			},
			tags: ["ocean", "sunset"],
		}),
		asset({
			id: "a2",
			name: "interview.mp4",
			transcript: {
				modelId: "whisper",
				updatedAt: "t",
				segments: [{ start: 0, end: 2, text: "Welcome to the podcast about startups" }],
			},
			tags: ["talking-head"],
		}),
		asset({
			id: "a3",
			name: "city-night.mp4",
			vision: { summary: "Neon streets in the city at night" },
		}),
	];

	test("ranks vision match above unrelated assets", () => {
		const hits = searchMediaAssets({ assets: library, query: "ocean sunset", limit: 3 });
		expect(hits[0]?.mediaId).toBe("a1");
		expect(hits[0]?.score).toBeGreaterThan(0);
		expect(hits.some((h) => h.mediaId === "a2" && h.score >= hits[0].score)).toBe(false);
	});

	test("matches transcript text", () => {
		const hits = searchMediaAssets({ assets: library, query: "podcast startups", limit: 2 });
		expect(hits[0]?.mediaId).toBe("a2");
		expect(hits[0]?.snippet.toLowerCase()).toContain("podcast");
	});

	test("respects limit", () => {
		const hits = searchMediaAssets({ assets: library, query: "night city ocean", limit: 1 });
		expect(hits).toHaveLength(1);
	});

	test("returns empty for blank query", () => {
		expect(searchMediaAssets({ assets: library, query: "   " })).toEqual([]);
	});
});
