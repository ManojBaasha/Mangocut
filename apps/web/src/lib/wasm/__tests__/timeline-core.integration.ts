// Integration test (needs rust/wasm/pkg-node): run via `bun run test:integration`.
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ApplyOpOptions, OpOutput, TimelineOp } from "mangocut-wasm";
import {
	createTimelineApi,
	stripUndefined,
	type TimelineWasm,
	TimelineOpError,
} from "../timeline-core";

const nodePkg = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../../../../../rust/wasm/pkg-node/mangocut_wasm.js",
);
if (!existsSync(nodePkg)) {
	throw new Error(`${nodePkg} is missing; run \`bun run build:wasm:node\``);
}
// biome-ignore lint/style/noCommonJs: the node wasm build is CommonJS
const realWasm = require(nodePkg) as TimelineWasm;

const emptyOutput = { changed: false } as unknown as OpOutput;
const tracks = {
	overlay: [],
	audio: [],
	main: {
		id: "main",
		name: "Main Track",
		type: "video",
		muted: false,
		hidden: false,
		elements: [],
	},
} as unknown as ApplyOpOptions["tracks"];
const split = (count: number): TimelineOp => ({
	type: "splitElements",
	elements: Array.from({ length: count }, (_, i) => ({
		trackId: "main",
		elementId: `e${i}`,
	})),
	splitTime: 1 as never,
});

function fakeWasm(
	handler: (options: ApplyOpOptions, call: number) => OpOutput,
) {
	const calls: ApplyOpOptions[] = [];
	const wasm: TimelineWasm = {
		applyOp: (options) => {
			calls.push(options);
			return handler(options, calls.length);
		},
		validateTracks: () => [],
	};
	return { wasm, calls };
}

describe("stripUndefined", () => {
	test("deep-removes undefined keys, keeps null and falsy values", () => {
		expect(
			stripUndefined({ a: undefined, b: null, c: 0, d: [{ e: undefined, f: 1 }] }),
		).toEqual({ b: null, c: 0, d: [{ f: 1 }] });
		expect("a" in (stripUndefined({ a: undefined }) as object)).toBe(false);
	});
});

describe("applyTimelineOp", () => {
	test("strips undefined keys from the op before calling wasm", () => {
		const { wasm, calls } = fakeWasm(() => emptyOutput);
		const { applyTimelineOp } = createTimelineApi(wasm);
		applyTimelineOp({
			tracks,
			op: { type: "addTrack", trackType: "audio", index: undefined },
			newIds: ["t"],
		});
		expect("index" in (calls[0].op as object)).toBe(false);
		expect(calls[0].newIds).toEqual(["t"]);
		expect(calls[0].ripple).toBe(false);
	});

	test("generates a pool of max(32, 8 x references) ids when none are given", () => {
		const { wasm, calls } = fakeWasm(() => emptyOutput);
		const { applyTimelineOp } = createTimelineApi(wasm);
		applyTimelineOp({ tracks, op: split(1) });
		applyTimelineOp({ tracks, op: split(10) });
		expect(calls[0].newIds).toHaveLength(32);
		expect(calls[1].newIds).toHaveLength(80);
		expect(new Set(calls[1].newIds).size).toBe(80);
	});

	test("rethrows wasm errors as TimelineOpError with code and hint", () => {
		const { wasm } = fakeWasm(() => {
			throw { code: "element_not_found", message: "nope", hint: "list first" };
		});
		const { applyTimelineOp } = createTimelineApi(wasm);
		let thrown: unknown;
		try {
			applyTimelineOp({ tracks, op: split(1) });
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(TimelineOpError);
		expect(thrown).toBeInstanceOf(Error);
		const error = thrown as TimelineOpError;
		expect(error.code).toBe("element_not_found");
		expect(error.hint).toBe("list first");
		expect(error.message).toBe("nope");
	});

	test("retries once with a doubled pool on missing_ids", () => {
		const { wasm, calls } = fakeWasm((_, call) => {
			if (call === 1) throw { code: "missing_ids", message: "need more" };
			return emptyOutput;
		});
		const { applyTimelineOp } = createTimelineApi(wasm);
		applyTimelineOp({ tracks, op: split(1) });
		expect(calls).toHaveLength(2);
		expect(calls[1].newIds).toHaveLength(64);
	});

	test("does not retry twice, nor when newIds were explicit", () => {
		const always = fakeWasm(() => {
			throw { code: "missing_ids", message: "need more" };
		});
		const api = createTimelineApi(always.wasm);
		expect(() => api.applyTimelineOp({ tracks, op: split(1) })).toThrow(
			TimelineOpError,
		);
		expect(always.calls).toHaveLength(2);

		const explicit = fakeWasm(() => {
			throw { code: "missing_ids", message: "need more" };
		});
		expect(() =>
			createTimelineApi(explicit.wasm).applyTimelineOp({
				tracks,
				op: split(1),
				newIds: [],
			}),
		).toThrow(TimelineOpError);
		expect(explicit.calls).toHaveLength(1);
	});

	test("works against the real node wasm build (generated ids)", () => {
		const { applyTimelineOp, validateTimelineTracks } =
			createTimelineApi(realWasm);
		const output = applyTimelineOp({
			tracks,
			op: { type: "addTrack", trackType: "audio", index: undefined },
		});
		expect(output.changed).toBe(true);
		expect(output.tracks.audio).toHaveLength(1);
		expect(validateTimelineTracks(output.tracks)).toEqual([]);
		expect(() =>
			applyTimelineOp({
				tracks,
				op: { type: "removeTrack", trackId: "ghost" },
			}),
		).toThrow(TimelineOpError);
	});
});
