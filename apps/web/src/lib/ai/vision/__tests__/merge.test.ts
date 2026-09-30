import { describe, expect, test } from "bun:test";
import {
	DEFAULT_FRAME_TIMES,
	mergeVisionMemory,
	normalizeFrameTimes,
	parseVisionResponse,
} from "../merge";

describe("normalizeFrameTimes", () => {
	test("defaults to start mid end fractions of duration", () => {
		expect(normalizeFrameTimes({ timesSeconds: undefined, durationSeconds: 10 })).toEqual(
			DEFAULT_FRAME_TIMES.map((f) => f * 10),
		);
	});

	test("clamps and dedupes explicit times", () => {
		expect(
			normalizeFrameTimes({
				timesSeconds: [-1, 2, 2, 99],
				durationSeconds: 10,
			}),
		).toEqual([0, 2, 10]);
	});
});

describe("mergeVisionMemory", () => {
	test("merges frames by time and updates summary", () => {
		const merged = mergeVisionMemory({
			existing: {
				summary: "old",
				updatedAt: "2020-01-01T00:00:00.000Z",
				frames: [
					{
						timeSeconds: 0,
						description: "start old",
						capturedAt: "2020-01-01T00:00:00.000Z",
					},
				],
			},
			incoming: {
				summary: "new summary",
				frames: [
					{
						timeSeconds: 0,
						description: "start new",
						capturedAt: "2026-01-01T00:00:00.000Z",
					},
					{
						timeSeconds: 5,
						description: "mid",
						capturedAt: "2026-01-01T00:00:00.000Z",
					},
				],
			},
			now: "2026-01-02T00:00:00.000Z",
		});
		expect(merged.summary).toBe("new summary");
		expect(merged.updatedAt).toBe("2026-01-02T00:00:00.000Z");
		expect(merged.frames).toEqual([
			{
				timeSeconds: 0,
				description: "start new",
				capturedAt: "2026-01-01T00:00:00.000Z",
			},
			{
				timeSeconds: 5,
				description: "mid",
				capturedAt: "2026-01-01T00:00:00.000Z",
			},
		]);
	});
});

describe("parseVisionResponse", () => {
	test("parses JSON block from model text", () => {
		const parsed = parseVisionResponse({
			text: 'Here you go:\n```json\n{"summary":"A beach","frames":[{"timeSeconds":0,"description":"waves"}]}\n```',
		});
		expect(parsed.summary).toBe("A beach");
		expect(parsed.frames[0]?.description).toBe("waves");
	});

	test("falls back to full text as summary", () => {
		const parsed = parseVisionResponse({ text: "Just a blue sky." });
		expect(parsed.summary).toBe("Just a blue sky.");
		expect(parsed.frames).toEqual([]);
	});
});
