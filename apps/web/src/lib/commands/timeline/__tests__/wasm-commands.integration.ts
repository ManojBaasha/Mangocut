/**
 * Integration test: not picked up by the default `bun test` (no `.test.`
 * in the name). Run it with `bun run test:integration`, which builds the
 * Node wasm package first and runs this file in its own bun process.
 *
 * WARNING: this file installs process-global bun module mocks (`@/core`,
 * `mangocut-wasm`, `@/lib/wasm/timeline`). They stay active for every test
 * file bun runs after it in the same process, so it gets a process alone.
 *
 * Drives the ported timeline commands (which mutate through the Rust engine
 * via wasm) with the real CommandManager, including ripple and undo/redo.
 *
 * The real EditorCore cannot be constructed under bun (the browser wasm build
 * and the DOM/storage services do not load), so `@/core` is a minimal stub
 * holding the scene tracks, and `mangocut-wasm` is the Node build of the same
 * crate (also bound directly into `@/lib/wasm/timeline`). These are bun
 * module mocks, which are process-global: they are set up before the
 * commands are imported.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ElementRef, SceneTracks } from "@/lib/timeline/types";

const nodePkg = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../../../../../../rust/wasm/pkg-node/mangocut_wasm.js",
);
if (!existsSync(nodePkg)) {
	throw new Error(`${nodePkg} is missing; run \`bun run build:wasm:node\``);
}
// The node wasm build is CommonJS.
const nodeWasm = require(nodePkg);
const gpuOnly = [
	"applyEffectPasses",
	"applyMaskFeather",
	"getCompositorCanvas",
	"initCompositor",
	"initializeGpu",
	"releaseTexture",
	"renderFrame",
	"resizeCompositor",
	"uploadTexture",
];
const wasmModule: Record<string, unknown> = { ...nodeWasm };
for (const name of gpuOnly) {
	wasmModule[name] ??= () => {
		throw new Error(`${name} is GPU-only and unavailable in tests`);
	};
}
mock.module("mangocut-wasm", () => wasmModule);
// Other test files mock `mangocut-wasm` too (process-global, last one wins),
// so bind the timeline wrapper the commands use straight to the node build.
const timelineCore = await import("@/lib/wasm/timeline-core");
mock.module("@/lib/wasm/timeline", () => ({
	TimelineOpError: timelineCore.TimelineOpError,
	...timelineCore.createTimelineApi(nodeWasm),
}));

const state: { tracks: SceneTracks; selection: ElementRef[] } = {
	tracks: undefined as unknown as SceneTracks,
	selection: [],
};
const editorStub: Record<string, unknown> = {
	scenes: {
		getActiveScene: () => ({ id: "scene-1", tracks: state.tracks }),
		getActiveSceneOrNull: () => ({ id: "scene-1", tracks: state.tracks }),
	},
	timeline: {
		updateTracks: (tracks: SceneTracks) => {
			state.tracks = tracks;
		},
	},
	media: { getAssets: () => [] },
	project: {
		getActive: () => ({ settings: { fps: { numerator: 30, denominator: 1 } } }),
		updateSettings: () => {},
	},
	selection: {
		getSelectedElements: () => state.selection,
		setSelectedElements: ({ elements }: { elements: ElementRef[] }) => {
			state.selection = elements;
		},
	},
};
mock.module("@/core", () => ({
	EditorCore: { getInstance: () => editorStub },
}));

const { CommandManager } = await import("@/core/managers/commands");
const commands = await import("@/lib/commands/timeline");
const { BatchCommand } = await import("@/lib/commands/batch-command");
const { withStrictTimelineValidation } = await import(
	"@/lib/commands/timeline/validation-context"
);
const manager = new CommandManager(editorStub as never);
editorStub.command = manager;

const transform = { scaleX: 1, scaleY: 1, position: { x: 0, y: 0 }, rotate: 0 };

function video(id: string, startTime: number, duration: number) {
	return {
		type: "video" as const,
		id,
		mediaId: "media-1",
		name: id,
		startTime,
		duration,
		trimStart: 0,
		trimEnd: 0,
		sourceDuration: 10_000,
		muted: false,
		isSourceAudioEnabled: true,
		hidden: false,
		transform,
		opacity: 1,
		blendMode: "normal",
		volume: 0,
	};
}

function emptyScene(): SceneTracks {
	return {
		overlay: [],
		main: {
			id: "main",
			name: "Main Track",
			type: "video",
			muted: false,
			hidden: false,
			elements: [],
		},
		audio: [],
	} as SceneTracks;
}

function snapshot(): SceneTracks {
	return structuredClone(state.tracks);
}

function element(trackId: string, elementId: string) {
	const tracks = [...state.tracks.overlay, state.tracks.main, ...state.tracks.audio];
	return tracks
		.find((track) => track.id === trackId)
		?.elements.find((candidate) => candidate.id === elementId);
}

beforeEach(() => {
	state.tracks = emptyScene();
	state.selection = [];
	manager.clear();
	manager.isRippleEnabled = false;
});

describe("ported track commands", () => {
	test("add, mute, hide and remove a track, then undo and redo", () => {
		const add = new commands.AddTrackCommand("audio");
		manager.execute({ command: add });
		const trackId = add.getTrackId();
		expect(state.tracks.audio.map((track) => track.id)).toEqual([trackId]);

		manager.execute({ command: new commands.ToggleTrackMuteCommand(trackId) });
		expect(state.tracks.audio[0].muted).toBe(true);

		manager.execute({ command: new commands.ToggleTrackVisibilityCommand("main") });
		expect(state.tracks.main.hidden).toBe(true);

		manager.execute({ command: new commands.RemoveTrackCommand(trackId) });
		expect(state.tracks.audio).toEqual([]);

		for (let i = 0; i < 4; i++) manager.undo();
		expect(state.tracks).toEqual(emptyScene());
		for (let i = 0; i < 4; i++) manager.redo();
		expect(state.tracks.audio).toEqual([]);
		expect(state.tracks.main.hidden).toBe(true);
	});

	test("unknown track ids are a silent no-op", () => {
		const before = snapshot();
		manager.execute({ command: new commands.RemoveTrackCommand("nope") });
		manager.execute({ command: new commands.ToggleTrackMuteCommand("nope") });
		expect(state.tracks).toEqual(before);
	});
});

function createVideo(startTime: number, duration: number) {
	const { id: _id, ...rest } = video("unused", startTime, duration);
	return { ...rest, name: "clip" };
}

describe("ported element commands", () => {
	test("insert, split, trim, move to a new track, ripple delete; undo all, redo all", () => {
		const states: SceneTracks[] = [snapshot()];

		// 1. insert a 4s video at 0 on the main track.
		const insert = new commands.InsertElementCommand({
			element: createVideo(0, 4000) as never,
			placement: { mode: "auto" },
		});
		manager.execute({ command: insert });
		const clipId = insert.getElementId();
		expect(insert.getTrackId()).toBe("main");
		expect(state.selection).toEqual([{ trackId: "main", elementId: clipId }]);
		expect(state.tracks.main.elements.map((e) => [e.id, e.startTime, e.duration])).toEqual([
			[clipId, 0, 4000],
		]);
		states.push(snapshot());

		// 2. split at 2s.
		const split = new commands.SplitElementsCommand({
			elements: [{ trackId: "main", elementId: clipId }],
			splitTime: 2000,
		});
		manager.execute({ command: split });
		const [right] = split.getRightSideElements();
		expect(right.trackId).toBe("main");
		expect(state.selection).toEqual([right]);
		expect(
			state.tracks.main.elements.map((e) => [e.id, e.startTime, e.duration, e.trimStart, e.trimEnd]),
		).toEqual([
			[clipId, 0, 2000, 0, 2000],
			[right.elementId, 2000, 2000, 2000, 0],
		]);
		states.push(snapshot());

		// 3. trim both halves (left loses its tail, right loses its head).
		manager.execute({
			command: new commands.UpdateElementsCommand({
				updates: [
					{ trackId: "main", elementId: clipId, patch: { trimEnd: 2500, duration: 1500 } },
					{
						trackId: "main",
						elementId: right.elementId,
						patch: { trimStart: 2500, startTime: 2500, duration: 1500 },
					},
				],
			}),
		});
		expect(element("main", clipId)).toMatchObject({ duration: 1500, trimEnd: 2500 });
		expect(element("main", right.elementId)).toMatchObject({
			startTime: 2500,
			duration: 1500,
			trimStart: 2500,
		});
		states.push(snapshot());

		// 4. move the right half onto a new overlay video track at 6s.
		const move = new commands.MoveElementCommand({
			sourceTrackId: "main",
			targetTrackId: "new-track",
			elementId: right.elementId,
			newStartTime: 6000,
			createTrack: { type: "video", index: 0 },
		});
		manager.execute({ command: move });
		expect(move.getError()).toBeNull();
		expect(state.tracks.overlay.map((t) => t.id)).toEqual(["new-track"]);
		expect(element("new-track", right.elementId)).toMatchObject({ startTime: 6000 });
		expect(state.tracks.main.elements.map((e) => e.id)).toEqual([clipId]);
		states.push(snapshot());

		// 5. ripple on: add a clip after the left half, then delete the left half.
		manager.isRippleEnabled = true;
		const second = new commands.InsertElementCommand({
			element: createVideo(1500, 1000) as never,
			placement: { mode: "explicit", trackId: "main" },
		});
		manager.execute({ command: second });
		states.push(snapshot());
		manager.execute({
			command: new commands.DeleteElementsCommand({
				elements: [{ trackId: "main", elementId: clipId }],
			}),
		});
		expect(state.selection).toEqual([]);
		// Ripple closes the gap once: the second clip slides from 1.5s to 0.
		expect(state.tracks.main.elements.map((e) => [e.id, e.startTime])).toEqual([
			[second.getElementId(), 0],
		]);
		// Ripple is per track: the overlay clip stays at 6s.
		expect(element("new-track", right.elementId)).toMatchObject({ startTime: 6000 });
		states.push(snapshot());

		// Undo everything, checking each intermediate state exactly.
		for (let index = states.length - 2; index >= 0; index--) {
			manager.undo();
			expect(state.tracks).toEqual(states[index]);
		}
		// Redo everything: ids are stable across redo, so states match exactly.
		// Redo ripples with the current setting (as before), so match the
		// setting each step originally ran with.
		for (let index = 1; index < states.length; index++) {
			manager.isRippleEnabled = index >= 5;
			manager.redo();
			expect(state.tracks).toEqual(states[index]);
		}
	});

	test("duplicate selects copies on a new track and redoes identically", () => {
		state.tracks.main.elements = [video("a", 0, 1000)] as never;
		const duplicate = new commands.DuplicateElementsCommand({
			elements: [{ trackId: "main", elementId: "a" }],
		});
		manager.execute({ command: duplicate });
		const copies = duplicate.getDuplicatedElements();
		expect(copies).toHaveLength(1);
		expect(state.selection).toEqual(copies);
		expect(element(copies[0].trackId, copies[0].elementId)).toMatchObject({
			name: "a (copy)",
			startTime: 0,
		});
		const after = snapshot();
		manager.undo();
		manager.redo();
		expect(state.tracks).toEqual(after);
	});

	test("an undefined patch value clears the field (retime)", () => {
		state.tracks.main.elements = [video("a", 0, 1000)] as never;
		const update = (patch: Record<string, unknown>) =>
			manager.execute({
				command: new commands.UpdateElementsCommand({
					updates: [{ trackId: "main", elementId: "a", patch: patch as never }],
				}),
			});
		update({ retime: { rate: 2 } });
		expect(element("main", "a")).toMatchObject({ retime: { rate: 2 }, duration: 5000 });
		update({ retime: undefined });
		expect(element("main", "a")).not.toHaveProperty("retime");
		expect(element("main", "a")).toMatchObject({ duration: 10_000 });
	});

	test("updates skip unknown refs and apply the rest", () => {
		state.tracks.main.elements = [video("a", 0, 1000)] as never;
		manager.execute({
			command: new commands.UpdateElementsCommand({
				updates: [
					{ trackId: "main", elementId: "gone", patch: { opacity: 0.1 } as never },
					{ trackId: "main", elementId: "a", patch: { opacity: 0.5 } as never },
				],
			}),
		});
		expect(element("main", "a")).toMatchObject({ opacity: 0.5 });
	});

	test("direct execute (live preview, no history) never ripples", () => {
		manager.isRippleEnabled = true;
		state.tracks.main.elements = [video("a", 0, 1000), video("b", 1000, 1000)] as never;
		new commands.UpdateElementsCommand({
			updates: [{ trackId: "main", elementId: "a", patch: { duration: 500 } as never }],
		}).execute();
		expect(element("main", "b")).toMatchObject({ startTime: 1000 });
	});

	test("unknown ids are a silent no-op", () => {
		state.tracks.main.elements = [video("a", 0, 1000)] as never;
		const before = snapshot();
		const errors: unknown[] = [];
		const originalError = console.error;
		console.error = (...args: unknown[]) => errors.push(args);
		try {
			manager.execute({
				command: new commands.DeleteElementsCommand({
					elements: [{ trackId: "main", elementId: "nope" }],
				}),
			});
			manager.execute({
				command: new commands.SplitElementsCommand({
					elements: [{ trackId: "nope", elementId: "a" }],
					splitTime: 500,
				}),
			});
			const move = new commands.MoveElementCommand({
				sourceTrackId: "main",
				targetTrackId: "main",
				elementId: "nope",
				newStartTime: 0,
			});
			manager.execute({ command: move });
			expect((move.getError() as { code?: string } | null)?.code).toBe("element_not_found");
		} finally {
			console.error = originalError;
		}
		expect(errors).toEqual([]);
		expect(state.tracks).toEqual(before);
	});

	test("a move onto an occupied span: strict (agent) fails, editor allows it", () => {
		state.tracks.main.elements = [video("a", 0, 1000)] as never;
		state.tracks.overlay = [
			{
				id: "ov",
				name: "Video",
				type: "video",
				muted: false,
				hidden: false,
				elements: [video("b", 0, 1000)],
			},
		] as never;
		const before = snapshot();
		const makeMove = () =>
			new commands.MoveElementCommand({
				sourceTrackId: "ov",
				targetTrackId: "main",
				elementId: "b",
				newStartTime: 500,
			});
		const strictMove = makeMove();
		const originalError = console.error;
		console.error = () => {};
		try {
			withStrictTimelineValidation(() => manager.execute({ command: strictMove }));
		} finally {
			console.error = originalError;
		}
		expect((strictMove.getError() as { code?: string } | null)?.code).toBe("invalid_result");
		expect(state.tracks).toEqual(before);

		// The editor stays as permissive as the pre-port TS command.
		const editorMove = makeMove();
		manager.execute({ command: editorMove });
		expect(editorMove.getError()).toBeNull();
		expect(state.tracks.main.elements.map((e) => [e.id, e.startTime])).toEqual([
			["a", 0],
			["b", 500],
		]);
	});

	test("slowing a clip followed by an adjacent clip applies the retime (overlap allowed); undo restores", () => {
		state.tracks.main.elements = [video("a", 0, 1000), video("b", 1000, 1000)] as never;
		// sourceDuration 10_000 with trimEnd 9_000 → 1s visible source span.
		(state.tracks.main.elements[0] as { trimEnd: number }).trimEnd = 9000;
		const before = snapshot();
		manager.execute({
			command: new commands.UpdateElementsCommand({
				updates: [
					{ trackId: "main", elementId: "a", patch: { retime: { rate: 0.5 } } as never },
				],
			}),
		});
		expect(element("main", "a")).toMatchObject({ retime: { rate: 0.5 }, duration: 2000 });
		expect(element("main", "b")).toMatchObject({ startTime: 1000 });
		manager.undo();
		expect(state.tracks).toEqual(before);
	});

	test("batch add-track + insert onto it, with a mixed batch rippling once", () => {
		const addTrack = new commands.AddTrackCommand("text", 0);
		const insert = new commands.InsertElementCommand({
			element: {
				type: "text",
				name: "Title",
				content: "Hello",
				startTime: 0,
				duration: 1000,
				trimStart: 0,
				trimEnd: 0,
				fontSize: 48,
				fontFamily: "Arial",
				color: "#fff",
				background: { enabled: false, color: "#000" },
				textAlign: "center",
				fontWeight: "normal",
				fontStyle: "normal",
				textDecoration: "none",
				hidden: false,
				transform,
				opacity: 1,
				blendMode: "normal",
			} as never,
			placement: { mode: "explicit", trackId: addTrack.getTrackId() },
		});
		const batch = new BatchCommand([addTrack, insert]);
		expect(batch.handlesRipple).toBe(true);
		manager.execute({ command: batch });
		expect(state.tracks.overlay.map((t) => t.id)).toEqual([addTrack.getTrackId()]);
		expect(element(addTrack.getTrackId(), insert.getElementId())).toBeDefined();
		expect(state.selection).toEqual([
			{ trackId: addTrack.getTrackId(), elementId: insert.getElementId() },
		]);
	});

	test("a mixed batch ripples once, in CommandManager, not per child", () => {
		manager.isRippleEnabled = true;
		state.tracks.main.elements = [
			video("a", 0, 1000),
			video("b", 1000, 1000),
			video("c", 2000, 1000),
		] as never;
		const current = snapshot();
		const batch = new BatchCommand([
			// Not ported (handlesRipple false): a no-op snapshot restore.
			new commands.TracksSnapshotCommand(current, current),
			new commands.DeleteElementsCommand({
				elements: [{ trackId: "main", elementId: "a" }],
			}),
		]);
		expect(batch.handlesRipple).toBe(false);
		manager.execute({ command: batch });
		expect(state.tracks.main.elements.map((e) => [e.id, e.startTime])).toEqual([
			["b", 0],
			["c", 1000],
		]);
		manager.undo();
		expect(state.tracks).toEqual(current);
	});
});

describe("runtime-only fields (AudioBuffer)", () => {
	// Stands in for AudioBuffer (a class instance with prototype getters,
	// which serde-wasm-bindgen would read back as `{}`).
	class FakeAudioBuffer {
		get duration() {
			return 10;
		}
	}

	function audio(
		id: string,
		startTime: number,
		source: { sourceType: "upload"; mediaId: string } | { sourceType: "library"; sourceUrl: string },
		buffer?: FakeAudioBuffer,
	) {
		return {
			type: "audio" as const,
			id,
			name: id,
			startTime,
			duration: 1000,
			trimStart: 0,
			trimEnd: 0,
			sourceDuration: 10_000,
			volume: 1,
			...source,
			...(buffer ? { buffer } : {}),
		};
	}

	function audioScene(buffers: { upload: FakeAudioBuffer; library: FakeAudioBuffer }) {
		state.tracks.audio = [
			{
				id: "au",
				name: "Audio",
				type: "audio",
				muted: false,
				elements: [
					audio("a", 0, { sourceType: "upload", mediaId: "m-a" }, buffers.upload),
					audio("c", 2000, { sourceType: "library", sourceUrl: "https://x/c.mp3" }, buffers.library),
				],
			},
		] as never;
	}

	test("split and track mute keep the same buffer reference on every element", () => {
		const buffers = { upload: new FakeAudioBuffer(), library: new FakeAudioBuffer() };
		audioScene(buffers);
		const split = new commands.SplitElementsCommand({
			elements: [{ trackId: "au", elementId: "a" }],
			splitTime: 500,
		});
		manager.execute({ command: split });
		const [right] = split.getRightSideElements();
		expect(right).toBeDefined();
		expect((element("au", "a") as { buffer?: unknown }).buffer).toBe(buffers.upload);
		expect((element("au", right.elementId) as { buffer?: unknown }).buffer).toBe(buffers.upload);
		expect((element("au", "c") as { buffer?: unknown }).buffer).toBe(buffers.library);

		manager.execute({ command: new commands.ToggleTrackMuteCommand("au") });
		expect(state.tracks.audio[0].muted).toBe(true);
		expect((element("au", "a") as { buffer?: unknown }).buffer).toBe(buffers.upload);
		expect((element("au", right.elementId) as { buffer?: unknown }).buffer).toBe(buffers.upload);
		expect((element("au", "c") as { buffer?: unknown }).buffer).toBe(buffers.library);
	});

	test("an inserted element keeps its buffer", () => {
		const buffer = new FakeAudioBuffer();
		const { id: _id, ...rest } = audio(
			"unused",
			0,
			{ sourceType: "library", sourceUrl: "https://x/new.mp3" },
			buffer,
		);
		const insert = new commands.InsertElementCommand({
			element: rest as never,
			placement: { mode: "auto" },
		});
		manager.execute({ command: insert });
		const inserted = element(insert.getTrackId() ?? "", insert.getElementId()) as { buffer?: unknown };
		expect(inserted.buffer).toBe(buffer);
	});
});

type AgentResult = {
	ok: boolean;
	error?: { code: string; message: string; hint?: string };
};

async function agentCommands() {
	const { TimelineManager } = await import("@/core/managers/timeline-manager");
	const { registerEditorCommands } = await import(
		"@/lib/commands-api/register-editor-commands"
	);
	const { executeCommand, clearCommandRegistry } = await import(
		"@/lib/commands-api/registry"
	);
	const timeline = new TimelineManager(editorStub as never);
	const agentEditor = {
		...editorStub,
		timeline: Object.assign(Object.create(timeline), editorStub.timeline),
	};
	clearCommandRegistry();
	registerEditorCommands({ editor: agentEditor as never });
	return {
		run: (name: string, args: Record<string, unknown>) =>
			executeCommand<AgentResult>({ name, args }),
		clear: clearCommandRegistry,
	};
}

/** Runs `body` with console.error silenced (failed edits log). */
async function quietly(body: () => Promise<void>) {
	const originalError = console.error;
	console.error = () => {};
	try {
		await body();
	} finally {
		console.error = originalError;
	}
}

describe("agent edit handlers report engine rejections", () => {
	const SECOND = 120_000;
	function clip(id: string, startSeconds: number) {
		return { ...video(id, startSeconds * SECOND, SECOND), sourceDuration: 10 * SECOND };
	}

	test("trim into the next clip returns invalid_result and changes nothing", async () => {
		const agent = await agentCommands();
		state.tracks.main.elements = [clip("a", 0), clip("b", 1)] as never;
		const before = snapshot();
		await quietly(async () => {
			const result = await agent.run("trim_element", {
				elementId: "a",
				durationSeconds: 1.5,
			});
			expect(result.ok).toBe(false);
			expect(result.error?.code).toBe("invalid_result");
			expect(typeof result.error?.hint).toBe("string");
		});
		expect(state.tracks).toEqual(before);
		agent.clear();
	});

	test("a valid trim still returns ok: true and applies", async () => {
		const agent = await agentCommands();
		state.tracks.main.elements = [clip("a", 0), clip("b", 1)] as never;
		const result = await agent.run("trim_element", {
			elementId: "a",
			durationSeconds: 0.5,
		});
		expect(result).toMatchObject({
			ok: true,
			durationSeconds: 0.5,
			sourceStartSeconds: 0,
			sourceEndSeconds: 0.5,
		});
		expect(element("main", "a")).toMatchObject({ duration: SECOND / 2, trimEnd: 9.5 * SECOND });
		agent.clear();
	});

	test("trim keeps a middle section of the source", async () => {
		const agent = await agentCommands();
		state.tracks.main.elements = [clip("a", 0)] as never;
		const result = await agent.run("trim_element", {
			elementId: "a",
			sourceStartSeconds: 2,
			durationSeconds: 3,
		});
		expect(result).toMatchObject({ ok: true, sourceStartSeconds: 2, sourceEndSeconds: 5 });
		expect(element("main", "a")).toMatchObject({
			startTime: 0,
			duration: 3 * SECOND,
			trimStart: 2 * SECOND,
			trimEnd: 5 * SECOND,
		});
		agent.clear();
	});

	test("trim longer than the source keeps the whole source and says so", async () => {
		const agent = await agentCommands();
		state.tracks.main.elements = [clip("a", 0)] as never;
		const result = await agent.run("trim_element", { elementId: "a", durationSeconds: 20 });
		expect(result).toMatchObject({ ok: true, durationSeconds: 10 });
		expect(typeof result.note).toBe("string");
		agent.clear();
	});

	test("close_gaps packs the main track back to back", async () => {
		const agent = await agentCommands();
		state.tracks.main.elements = [clip("a", 0), clip("b", 5), clip("c", 9)] as never;
		const result = await agent.run("close_gaps", {});
		expect(result).toMatchObject({ ok: true, moved: 2, trackDurationSeconds: 3 });
		expect(element("main", "b")).toMatchObject({ startTime: SECOND });
		expect(element("main", "c")).toMatchObject({ startTime: 2 * SECOND });
		agent.clear();
	});

	test("unknown ids are reported, not ok: true", async () => {
		const agent = await agentCommands();
		state.tracks.main.elements = [clip("a", 0)] as never;
		const before = snapshot();
		await quietly(async () => {
			expect(await agent.run("trim_element", {
				elementId: "nope",
				durationSeconds: 1,
			})).toMatchObject({ ok: false, error: { code: "element_not_found" } });
			expect(await agent.run("delete_elements", {
				elements: [{ trackId: "main", elementId: "nope" }],
			})).toMatchObject({ ok: false, error: { code: "element_not_found" } });
			expect(await agent.run("update_text", {
				trackId: "nope",
				elementId: "a",
				opacity: 0.5,
			})).toMatchObject({ ok: false, error: { code: "track_not_found" } });
		});
		expect(state.tracks).toEqual(before);
		agent.clear();
	});

	test("successful split, update and delete return ok: true", async () => {
		const agent = await agentCommands();
		state.tracks.main.elements = [clip("a", 0)] as never;
		expect(await agent.run("split_at", { seconds: 0.5 })).toEqual({ ok: true, splitCount: 1 });
		expect(state.tracks.main.elements).toHaveLength(2);
		expect(await agent.run("update_text", {
			trackId: "main",
			elementId: "a",
			opacity: 0.5,
		})).toEqual({ ok: true });
		expect(element("main", "a")).toMatchObject({ opacity: 0.5 });
		expect(await agent.run("delete_elements", {
			elements: [{ trackId: "main", elementId: "a" }],
		})).toEqual({ ok: true });
		expect(state.tracks.main.elements).toHaveLength(1);
		agent.clear();
	});
});

describe("agent move_element", () => {
	test("reports Rust move failures instead of ok: true", async () => {
		const { TimelineManager } = await import("@/core/managers/timeline-manager");
		const { registerEditorCommands } = await import(
			"@/lib/commands-api/register-editor-commands"
		);
		const { executeCommand, clearCommandRegistry } = await import(
			"@/lib/commands-api/registry"
		);
		const timeline = new TimelineManager(editorStub as never);
		const agentEditor = {
			...editorStub,
			timeline: Object.assign(Object.create(timeline), editorStub.timeline),
		};
		clearCommandRegistry();
		registerEditorCommands({ editor: agentEditor as never });

		state.tracks.main.elements = [video("a", 0, 1_000_000)] as never;
		state.tracks.overlay = [
			{
				id: "ov",
				name: "Video",
				type: "video",
				muted: false,
				hidden: false,
				elements: [video("b", 0, 1_000_000)],
			},
		] as never;
		const originalError = console.error;
		console.error = () => {};
		try {
			const failed = await executeCommand<{ ok: boolean; error?: { code: string } }>({
				name: "move_element",
				args: {
					sourceTrackId: "ov",
					targetTrackId: "main",
					elementId: "b",
					newStartTimeSeconds: 0.5,
				},
			});
			expect(failed.ok).toBe(false);
			expect(failed.error?.code).toBe("invalid_result");

			const missing = await executeCommand<{ ok: boolean; error?: { code: string } }>({
				name: "move_element",
				args: { sourceTrackId: "main", elementId: "nope", newStartTimeSeconds: 0 },
			});
			expect(missing).toMatchObject({ ok: false, error: { code: "element_not_found" } });

			const moved = await executeCommand<{ ok: boolean }>({
				name: "move_element",
				args: { sourceTrackId: "ov", elementId: "b", newStartTimeSeconds: 2 },
			});
			expect(moved).toEqual({ ok: true });
		} finally {
			console.error = originalError;
			clearCommandRegistry();
		}
	});
});
