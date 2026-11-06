/**
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
// biome-ignore lint/style/noCommonJs: the node wasm build is CommonJS
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
