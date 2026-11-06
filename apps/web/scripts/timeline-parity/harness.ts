/**
 * WARNING: this module installs process-global bun mocks (`@/core`,
 * `@/utils/id`) and a `mangocut-wasm` plugin. It must run in its own bun
 * process (`bun run test:parity`); the files are named `*.parity.ts` so the
 * default `bun test` does not pick them up.
 *
 * Parity harness: runs the frozen legacy TypeScript timeline commands on an input scene
 * and records the result, so the Rust `apply_op` can be checked against it.
 *
 * `runTsOp` is deterministic: new ids come from `newIds` (in order) and the
 * EditorCore is a minimal stub holding the current tracks.
 */
import { mock } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SceneTracks } from "../../src/lib/timeline/types";

const here = dirname(fileURLToPath(import.meta.url));

// The browser wasm package cannot initialise under bun; route app imports of
// `mangocut-wasm` to the node build of the same crate (run `build:wasm:node`).
const nodeWasmPath = resolve(here, "../../../../rust/wasm/pkg-node/mangocut_wasm.js");
if (!existsSync(nodeWasmPath)) {
	throw new Error(
		`parity harness: ${nodeWasmPath} is missing; run \`bun run build:wasm:node\` first`,
	);
}
Bun.plugin({
	name: "mangocut-wasm-node",
	setup(build) {
		build.module("mangocut-wasm", async () => ({
			exports: await import(nodeWasmPath),
			loader: "object",
		}));
	},
});

export type ElementRefJson = { trackId: string; elementId: string };
export type TrackTypeJson = "video" | "text" | "audio" | "graphic" | "effect";

export type TimelineOp =
	| {
			type: "insertElement";
			element: Record<string, unknown>;
			placement:
				| { mode: "explicit"; trackId: string }
				| { mode: "auto"; trackType?: TrackTypeJson; insertIndex?: number };
	  }
	| {
			type: "splitElements";
			elements: ElementRefJson[];
			splitTime: number;
			retainSide?: "both" | "left" | "right";
	  }
	| {
			type: "trimElement";
			elementId: string;
			trimStart: number;
			trimEnd: number;
			startTime?: number;
			duration?: number;
	  }
	| {
			type: "retimeElement";
			trackId: string;
			elementId: string;
			retime?: Record<string, unknown> | null;
	  }
	| {
			type: "moveElement";
			sourceTrackId: string;
			targetTrackId: string;
			elementId: string;
			newStartTime: number;
			createTrack?: { type: TrackTypeJson; index: number };
	  }
	| { type: "deleteElements"; elements: ElementRefJson[] }
	| { type: "duplicateElements"; elements: ElementRefJson[] }
	| {
			type: "updateElements";
			updates: { trackId: string; elementId: string; patch: Record<string, unknown> }[];
	  }
	| { type: "addTrack"; trackType: TrackTypeJson; index?: number }
	| { type: "removeTrack"; trackId: string }
	| { type: "toggleTrackMute"; trackId: string }
	| { type: "toggleTrackVisibility"; trackId: string }
	| { type: "batch"; ops: TimelineOp[] };

// bun's mock.module is process-global, so the id mock only intercepts while a
// parity op is running; otherwise it falls through to the real implementation.
const state: { tracks: SceneTracks; newIds: string[]; active: boolean } = {
	tracks: undefined as unknown as SceneTracks,
	newIds: [],
	active: false,
};

const editorStub = {
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
		getSelectedElements: () => [],
		setSelectedElements: () => {},
		clearSelection: () => {},
	},
};

class StubEditorCore {
	static getInstance() {
		return editorStub;
	}
}

const realIdModule = { ...(await import("../../src/utils/id")) };
mock.module("@/core", () => ({ EditorCore: StubEditorCore }));
mock.module("@/utils/id", () => ({
	...realIdModule,
	generateUUID: () => {
		if (!state.active) return realIdModule.generateUUID();
		const next = state.newIds.shift();
		if (next === undefined) {
			throw new Error("parity harness: newIds exhausted (case needs more ids)");
		}
		return next;
	},
}));

// Legacy TS commands: goldens stay generated from the original TS logic.
const commands = await import("./legacy");
const { computeRippleAdjustments, applyRippleAdjustments } = await import(
	"../../src/lib/ripple"
);

type Command = { execute: () => unknown };

function findTrackIdForElement(elementId: string): string | undefined {
	const { overlay, main, audio } = state.tracks;
	return [...overlay, main, ...audio].find((track) =>
		track.elements.some((element) => element.id === elementId),
	)?.id;
}

function buildCommand(op: TimelineOp): Command | null {
	switch (op.type) {
		case "insertElement":
			return new commands.InsertElementCommand({
				element: op.element as never,
				placement: op.placement,
			});
		case "splitElements":
			return new commands.SplitElementsCommand({
				elements: op.elements,
				splitTime: op.splitTime,
				retainSide: op.retainSide,
			});
		case "trimElement": {
			const trackId = findTrackIdForElement(op.elementId);
			if (!trackId) return null;
			const patch: Record<string, number> = {
				trimStart: op.trimStart,
				trimEnd: op.trimEnd,
			};
			if (op.startTime !== undefined) patch.startTime = op.startTime;
			if (op.duration !== undefined) patch.duration = op.duration;
			return new commands.UpdateElementsCommand({
				updates: [{ trackId, elementId: op.elementId, patch: patch as never }],
			});
		}
		case "retimeElement":
			return new commands.UpdateElementsCommand({
				updates: [
					{
						trackId: op.trackId,
						elementId: op.elementId,
						patch: { retime: op.retime ?? undefined } as never,
					},
				],
			});
		case "moveElement":
			return new commands.MoveElementCommand({
				sourceTrackId: op.sourceTrackId,
				targetTrackId: op.targetTrackId,
				elementId: op.elementId,
				newStartTime: op.newStartTime,
				createTrack: op.createTrack,
			});
		case "deleteElements":
			return new commands.DeleteElementsCommand({ elements: op.elements });
		case "duplicateElements":
			return new commands.DuplicateElementsCommand({ elements: op.elements });
		case "updateElements":
			return new commands.UpdateElementsCommand({
				updates: op.updates as never,
			});
		case "addTrack":
			return new commands.AddTrackCommand(op.trackType, op.index);
		case "removeTrack":
			return new commands.RemoveTrackCommand(op.trackId);
		case "toggleTrackMute":
			return new commands.ToggleTrackMuteCommand(op.trackId);
		case "toggleTrackVisibility":
			return new commands.ToggleTrackVisibilityCommand(op.trackId);
		case "batch":
			return null;
	}
}

function runOp(op: TimelineOp): void {
	if (op.type === "batch") {
		for (const sub of op.ops) runOp(sub);
		return;
	}
	buildCommand(op)?.execute();
}

/**
 * Runs `op` on `tracks`. Returns the resulting tracks, or null when the
 * command changed nothing. When `ripple` is set, ripple adjustments are applied
 * afterwards exactly as `CommandManager.execute` does.
 */
export function runTsOp({
	tracks,
	op,
	newIds,
	ripple = false,
}: {
	tracks: SceneTracks;
	op: TimelineOp;
	newIds: string[];
	ripple?: boolean;
}): SceneTracks | null {
	const input = structuredClone(tracks);
	state.tracks = structuredClone(tracks);
	state.newIds = [...newIds];

	state.active = true;
	try {
		runOp(op);
	} finally {
		state.active = false;
	}

	if (ripple) {
		const adjustments = computeRippleAdjustments({
			beforeTracks: input,
			afterTracks: state.tracks,
		});
		if (adjustments.length > 0) {
			state.tracks = applyRippleAdjustments({
				tracks: state.tracks,
				adjustments,
			});
		}
	}

	const output = JSON.parse(JSON.stringify(state.tracks)) as SceneTracks;
	return JSON.stringify(output) === JSON.stringify(input) ? null : output;
}
