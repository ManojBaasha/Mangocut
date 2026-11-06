import { expect, test } from "bun:test";
import { cases } from "./cases";
import { runTsOp } from "./harness";

test("toggle_mute_main flips main.muted and nothing else", () => {
	const testCase = cases.find((c) => c.name === "toggle_mute_main");
	if (!testCase) throw new Error("case missing");
	const output = runTsOp({
		tracks: testCase.input,
		op: testCase.op,
		newIds: testCase.newIds,
	});
	const expected = structuredClone(testCase.input);
	expected.main.muted = !expected.main.muted;
	expect(output).toEqual(expected);
});

test("no-op returns null and exhausted ids throw", () => {
	const { input } = cases[0];
	expect(
		runTsOp({ tracks: input, op: { type: "removeTrack", trackId: "nope" }, newIds: [] }),
	).toBeNull();
	expect(() =>
		runTsOp({ tracks: input, op: { type: "addTrack", trackType: "audio" }, newIds: [] }),
	).toThrow(/newIds exhausted/);
});
