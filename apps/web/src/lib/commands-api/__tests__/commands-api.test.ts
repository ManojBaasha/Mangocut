import { describe, expect, mock, test } from "bun:test";
import { findGradePreset, listGradePresets } from "../../ai/grades";
import {
	clearCommandRegistry,
	executeCommand,
	listAgentTools,
	registerCommand,
} from "../registry";
import { findProjectMediaAsset } from "../place-media";
import { z } from "zod";

mock.module("mangocut-wasm", () => ({
	TICKS_PER_SECOND: () => 1_000_000,
	roundToFrame: (ticks: number) => ticks,
	lastFrameTime: () => 0,
}));

describe("grade presets", () => {
	test("lists ported ai-video-dev grades", () => {
		const grades = listGradePresets();
		expect(grades.length).toBeGreaterThanOrEqual(8);
		expect(grades.some((g) => /neon rain/i.test(g.name))).toBe(true);
	});

	test("finds grade by partial name", () => {
		const grade = findGradePreset({ name: "neon rain" });
		expect(grade.filterChain.length).toBeGreaterThan(10);
	});
});

describe("command api", () => {
	test("registers and executes a command", async () => {
		clearCommandRegistry();
		registerCommand({
			definition: {
				name: "ping",
				description: "ping",
				category: "controls",
				argsSchema: z.object({ value: z.string() }),
			},
			handler: ({ value }) => ({ pong: value }),
		});
		const result = await executeCommand<{ pong: string }>({
			name: "ping",
			args: { value: "hi" },
		});
		expect(result.pong).toBe("hi");
		expect(listAgentTools().some((t) => t.function.name === "ping")).toBe(true);
		clearCommandRegistry();
	});
});

describe("findProjectMediaAsset", () => {
	const assets = [
		{
			id: "asset-1",
			name: "IMG_0666.MP4",
			type: "video" as const,
			duration: 4.5,
		},
		{
			id: "asset-2",
			name: "clip-b.mov",
			type: "video" as const,
			duration: 2,
		},
	];

	test("resolves by mediaId", () => {
		expect(
			findProjectMediaAsset({ assets, mediaId: "asset-1" })?.name,
		).toBe("IMG_0666.MP4");
	});

	test("resolves by exact and partial mediaName", () => {
		expect(
			findProjectMediaAsset({ assets, mediaName: "IMG_0666.MP4" })?.id,
		).toBe("asset-1");
		expect(findProjectMediaAsset({ assets, mediaName: "0666" })?.id).toBe(
			"asset-1",
		);
	});

	test("returns null when missing", () => {
		expect(findProjectMediaAsset({ assets, mediaName: "missing" })).toBeNull();
	});
});

describe("place_media command", () => {
	test("places an existing project asset on the timeline by id", async () => {
		clearCommandRegistry();
		const { registerEditorCommands } = await import(
			"../register-editor-commands"
		);
		const inserted: Array<{ element: { mediaId?: string; name: string } }> =
			[];
		const mockEditor = {
			media: {
				getAssets: () => [
					{
						id: "asset-1",
						name: "IMG_0666.MP4",
						type: "video",
						duration: 4.5,
					},
				],
			},
			timeline: {
				getTotalDuration: () => 0,
				insertElement: (args: {
					element: { mediaId?: string; name: string };
				}) => {
					inserted.push(args);
				},
			},
			playback: {
				getCurrentTime: () => 0,
			},
			shadow: {
				runOnShadow: <T>(fn: () => T) => fn(),
			},
		};

		registerEditorCommands({
			editor: mockEditor as never,
		});

		const result = await executeCommand<{
			ok: boolean;
			mediaId: string;
		}>({
			name: "place_media",
			args: { mediaId: "asset-1" },
			target: "shadow",
		});

		expect(result.ok).toBe(true);
		expect(result.mediaId).toBe("asset-1");
		expect(inserted).toHaveLength(1);
		expect(inserted[0]?.element.mediaId).toBe("asset-1");
		expect(inserted[0]?.element.name).toBe("IMG_0666.MP4");
		clearCommandRegistry();
	});

	test("places by mediaName when mediaId is omitted", async () => {
		clearCommandRegistry();
		const { registerEditorCommands } = await import(
			"../register-editor-commands"
		);
		const inserted: unknown[] = [];
		const mockEditor = {
			media: {
				getAssets: () => [
					{
						id: "asset-2",
						name: "IMG_0666.MP4",
						type: "video",
						duration: 2,
					},
				],
			},
			timeline: {
				getTotalDuration: () => 10,
				insertElement: (args: unknown) => {
					inserted.push(args);
				},
			},
			playback: {
				getCurrentTime: () => 0,
			},
			shadow: {
				runOnShadow: <T>(fn: () => T) => fn(),
			},
		};

		registerEditorCommands({
			editor: mockEditor as never,
		});

		const result = await executeCommand<{ ok: boolean; mediaId: string }>({
			name: "place_media",
			args: { mediaName: "IMG_0666.MP4" },
			target: "shadow",
		});

		expect(result.ok).toBe(true);
		expect(result.mediaId).toBe("asset-2");
		expect(inserted).toHaveLength(1);
		clearCommandRegistry();
	});
});

describe("vision commands", () => {
	test("get_media_vision returns stored memory", async () => {
		clearCommandRegistry();
		const { registerVisionCommands } = await import(
			"../register-vision-commands"
		);
		registerVisionCommands({
			editor: {
				media: {
					getAsset: ({ id }: { id: string }) =>
						id === "m1"
							? {
									id: "m1",
									name: "clip.mp4",
									type: "video",
									vision: { summary: "ocean", frames: [] },
								}
							: null,
				},
			} as never,
		});
		const result = await executeCommand<{
			ok: boolean;
			vision: { summary: string } | null;
		}>({
			name: "get_media_vision",
			args: { mediaId: "m1" },
		});
		expect(result.ok).toBe(true);
		expect(result.vision?.summary).toBe("ocean");
		clearCommandRegistry();
	});
});

describe("transcription commands", () => {
	test("whisper model catalog includes small", async () => {
		const { TRANSCRIPTION_MODELS, DEFAULT_TRANSCRIPTION_MODEL } = await import(
			"@/lib/transcription/models"
		);
		expect(DEFAULT_TRANSCRIPTION_MODEL).toBe("whisper-small");
		expect(TRANSCRIPTION_MODELS.some((m) => m.id === "whisper-small")).toBe(
			true,
		);
	});
});
