import { describe, expect, test } from "bun:test";
import {
	buildKeepRanges,
	buildSilenceCutPoints,
	mediaTimeToTimelineTime,
} from "../speech-ranges";

describe("buildKeepRanges", () => {
	test("merges segments closer than minGap", () => {
		expect(
			buildKeepRanges({
				segments: [
					{ start: 0, end: 1, text: "a" },
					{ start: 1.2, end: 2, text: "b" },
					{ start: 5, end: 6, text: "c" },
				],
				minGapSeconds: 0.5,
			}),
		).toEqual([
			{ start: 0, end: 2 },
			{ start: 5, end: 6 },
		]);
	});
});

describe("buildSilenceCutPoints", () => {
	test("returns midpoints of long gaps", () => {
		expect(
			buildSilenceCutPoints({
				segments: [
					{ start: 0, end: 1, text: "a" },
					{ start: 4, end: 5, text: "b" },
				],
				minGapSeconds: 1,
				mediaDurationSeconds: 10,
			}),
		).toEqual([2.5]);
	});
});

describe("mediaTimeToTimelineTime", () => {
	test("maps using element start and trimStart", () => {
		expect(
			mediaTimeToTimelineTime({
				mediaTimeSeconds: 3,
				elementStartSeconds: 10,
				trimStartSeconds: 1,
			}),
		).toBe(12);
	});
});
