import type { ElementRef, SceneTracks } from "@/lib/timeline";
import { generateUUID } from "@/utils/id";
import {
	applyTimelineOp,
	type SceneTracks as WasmSceneTracks,
	type TimelineOp,
	TimelineOpError,
} from "@/lib/wasm/timeline";

/** Codes the old TS commands treated as a silent no-op (unknown ids). */
const NO_OP_CODES = new Set(["element_not_found", "track_not_found"]);

/** Extra ids handed to wasm when a command must fix its first id up front. */
const EXTRA_ID_POOL = 48;

export interface TimelineOpRun {
	tracks: SceneTracks;
	changed: boolean;
	select: ElementRef[];
	created: ElementRef[];
}

export type TimelineOpResult =
	| { ok: true; output: TimelineOpRun }
	| { ok: false; error: Error };

/**
 * Runs a timeline op through the Rust engine. Never throws: unknown
 * track/element ids are a silent no-op (as the old TS commands were), any
 * other failure is logged and the state is left unchanged.
 */
export function runTimelineOp({
	tracks,
	op,
	ripple = false,
	newIds,
}: {
	tracks: SceneTracks;
	op: TimelineOp;
	ripple?: boolean;
	newIds?: string[];
}): TimelineOpResult {
	try {
		// The app keeps its own element types; the generated wasm types are
		// structurally the same JSON (AudioElement is looser), so cast here.
		const output = applyTimelineOp({
			tracks: tracks as unknown as WasmSceneTracks,
			op,
			ripple,
			newIds,
		});
		return {
			ok: true,
			output: {
				tracks: output.tracks as unknown as SceneTracks,
				changed: output.changed,
				select: output.select,
				created: output.created,
			},
		};
	} catch (caught) {
		const error = caught instanceof Error ? caught : new Error(String(caught));
		if (!isNoOpError(error)) {
			console.error("Timeline edit failed:", error);
		}
		return { ok: false, error };
	}
}

export function isNoOpError(error: unknown): boolean {
	return error instanceof TimelineOpError && NO_OP_CODES.has(error.code);
}

/** `first`, then a generous pool of fresh ids (wasm does not retry these). */
export function idsStartingWith(first: string): string[] {
	return [first, ...Array.from({ length: EXTRA_ID_POOL }, () => generateUUID())];
}
