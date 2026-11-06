// Integration test (needs rust/wasm/pkg-node): run via `bun run test:integration`.
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Plain Node (CommonJS) build of the same crate; GPU-free. Loaded directly so
// this test needs no process-global mocks.
const nodePkg = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../../../../../rust/wasm/pkg-node/mangocut_wasm.js",
);
if (!existsSync(nodePkg)) {
	throw new Error(`${nodePkg} is missing; run \`bun run build:wasm:node\``);
}
// biome-ignore lint/style/noCommonJs: the node wasm build is CommonJS
const wasm = require(nodePkg);

const transform = {
	scaleX: 1,
	scaleY: 1,
	position: { x: 0, y: 0 },
	rotate: 0,
};

function sceneWithVideo(extra: Record<string, unknown> = {}) {
	return {
		overlay: [],
		audio: [],
		main: {
			id: "main",
			name: "Main Track",
			type: "video",
			muted: false,
			hidden: false,
			elements: [
				{
					type: "video",
					id: "el-1",
					mediaId: "media-1",
					name: "clip.mp4",
					duration: 120000,
					startTime: 0,
					trimStart: 0,
					trimEnd: 0,
					sourceDuration: 120000,
					muted: false,
					isSourceAudioEnabled: true,
					hidden: false,
					transform,
					opacity: 1,
					blendMode: "normal",
					volume: 0,
					...extra,
				},
			],
		},
	};
}

describe("node wasm smoke", () => {
	test("applyOp splits an element and uses the supplied id", () => {
		const output = wasm.applyOp({
			tracks: sceneWithVideo(),
			op: {
				type: "splitElements",
				elements: [{ trackId: "main", elementId: "el-1" }],
				splitTime: 60000,
				retainSide: "both",
			},
			newIds: ["r1"],
			ripple: false,
		});
		expect(output.changed).toBe(true);
		expect(output.tracks.main.elements).toHaveLength(2);
		expect(output.tracks.main.elements[1].id).toBe("r1");
	});

	function thrownBy(ref: { trackId: string; elementId: string }) {
		try {
			wasm.applyOp({
				tracks: sceneWithVideo(),
				op: {
					type: "splitElements",
					elements: [ref],
					splitTime: 1,
					retainSide: "both",
				},
			});
		} catch (error) {
			return error as { code: string; message: string; hint?: string };
		}
		throw new Error("expected applyOp to throw");
	}

	test("applyOp throws a TimelineError object (code, message, hint)", () => {
		const error = thrownBy({ trackId: "main", elementId: "y" });
		expect(typeof error).toBe("object");
		expect(error.code).toBe("element_not_found");
		expect(typeof error.message).toBe("string");
		expect(typeof error.hint).toBe("string");
	});

	test("an unknown track reports track_not_found", () => {
		expect(thrownBy({ trackId: "x", elementId: "y" }).code).toBe(
			"track_not_found",
		);
	});

	function thrownByOptions(options: unknown) {
		try {
			wasm.applyOp(options);
		} catch (error) {
			return error as { code: string; message: string; hint?: string };
		}
		throw new Error("expected applyOp to throw");
	}

	test("a negative index is a typed invalid_op error naming the path", () => {
		const error = thrownByOptions({
			tracks: sceneWithVideo(),
			op: { type: "addTrack", trackType: "video", index: -1 },
			newIds: ["t1"],
		});
		expect(error.code).toBe("invalid_op");
		expect(error.message).toContain("op");
		expect(error.message).toContain("-1");
		expect(error.hint).toBe("check the op against the TimelineOp schema");
	});

	test("wrong types and unknown op types are invalid_op too", () => {
		expect(
			thrownByOptions({
				tracks: sceneWithVideo(),
				op: { type: "insertElement", element: {}, placement: { mode: "auto", insertIndex: -2 } },
			}).code,
		).toBe("invalid_op");
		const unknown = thrownByOptions({ tracks: sceneWithVideo(), op: { type: "bogus" } });
		expect(unknown.code).toBe("invalid_op");
		expect(unknown.message).toContain("op.type");
		expect(thrownByOptions({ tracks: 5, op: { type: "toggleTrackMute", trackId: "main" } }).code).toBe(
			"invalid_op",
		);
	});

	test("validateTracks throws invalid_op for malformed tracks", () => {
		let thrown: { code?: string } | undefined;
		try {
			wasm.validateTracks({ tracks: { main: 5 } });
		} catch (error) {
			thrown = error as { code?: string };
		}
		expect(thrown?.code).toBe("invalid_op");
	});

	test("opaque animations/effects and extra fields come back as plain objects", () => {
		const output = wasm.applyOp({
			tracks: sceneWithVideo({
				animations: { channels: { opacity: { keys: [{ id: "k", time: 0 }] } } },
				effects: [{ id: "fx", params: { amount: 1 } }],
				customField: { nested: { a: 1 } },
			}),
			op: { type: "toggleTrackMute", trackId: "main" },
			newIds: [],
			ripple: false,
		});
		const element = output.tracks.main.elements[0];
		const isPlain = (value: unknown) =>
			Object.getPrototypeOf(value) === Object.prototype;
		expect(element.animations instanceof Map).toBe(false);
		expect(isPlain(element.animations)).toBe(true);
		expect(isPlain(element.animations.channels)).toBe(true);
		expect(isPlain(element.effects[0].params)).toBe(true);
		expect(isPlain(element.customField)).toBe(true);
		expect(isPlain(element.customField.nested)).toBe(true);
		expect(isPlain(output.tracks.main)).toBe(true);
		expect(isPlain(element.transform)).toBe(true);
	});

	test("validateTracks returns an empty list for a valid scene", () => {
		expect(wasm.validateTracks({ tracks: sceneWithVideo() })).toEqual([]);
	});
});
