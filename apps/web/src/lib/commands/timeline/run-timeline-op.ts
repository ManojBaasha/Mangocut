import type { ElementRef, SceneTracks } from "@/lib/timeline";
import { generateUUID } from "@/utils/id";
import {
	applyTimelineOp,
	type SceneTracks as WasmSceneTracks,
	type TimelineOp,
	TimelineOpError,
} from "@/lib/wasm/timeline";
import { isStrictTimelineValidation } from "./validation-context";

/** A JSON value as the Rust engine takes it (element bodies, patches). */
export type JsonValue = Extract<TimelineOp, { type: "insertElement" }>["element"];

/** Codes the old TS commands treated as a silent no-op (unknown ids). */
const NO_OP_CODES = new Set(["element_not_found", "track_not_found"]);

const MIN_POOL_SIZE = 48;
const IDS_PER_REF = 16;

/**
 * The ids a command hands to Rust for whatever its op creates (element,
 * track and keyframe ids), consumed in order. Kept on the command so redo
 * re-creates the same ids: later commands in history refer to them.
 */
export class StableIdPool {
	private ids: string[] | null = null;
	private readonly first: string | undefined;
	private size: number;

	constructor({ first, refs = 1 }: { first?: string; refs?: number } = {}) {
		this.first = first;
		this.size = Math.max(MIN_POOL_SIZE, IDS_PER_REF * refs);
	}

	get(): string[] {
		this.ids ??= this.generate();
		return this.ids;
	}

	/** Replaces the pool with a larger one (the op needed more ids). */
	grow(): void {
		this.size *= 4;
		this.ids = this.generate();
	}

	private generate(): string[] {
		const fresh = Array.from({ length: this.size }, () => generateUUID());
		return this.first === undefined ? fresh : [this.first, ...fresh];
	}
}

export interface TimelineOpRun {
	tracks: SceneTracks;
	changed: boolean;
	select: ElementRef[];
	created: ElementRef[];
	summary: string;
}

export type TimelineOpResult =
	| { ok: true; output: TimelineOpRun }
	| { ok: false; error: Error };

function apply({
	tracks,
	op,
	ripple,
	ids,
}: {
	tracks: SceneTracks;
	op: TimelineOp;
	ripple: boolean;
	ids?: StableIdPool;
}): TimelineOpRun {
	// The app keeps its own element types; the generated wasm types are
	// structurally the same JSON (AudioElement is looser), so cast here.
	const output = applyTimelineOp({
		tracks: tracks as unknown as WasmSceneTracks,
		op,
		ripple,
		newIds: ids?.get(),
		// Editor edits stay as permissive as the pre-port TS commands; agent
		// paths opt into the engine's result validation.
		validate: isStrictTimelineValidation(),
	});
	return {
		tracks: output.tracks as unknown as SceneTracks,
		changed: output.changed,
		select: output.select,
		created: output.created,
		summary: output.summary,
	};
}

/**
 * Runs a timeline op through the Rust engine. Never throws: unknown
 * track/element ids are a silent no-op (as the old TS commands were), any
 * other failure is logged and the state is left unchanged.
 *
 * Result validation (overlaps etc.) runs only inside
 * `withStrictTimelineValidation` (agent paths); the editor UI stays
 * permissive like the old TS commands.
 *
 * Without `ids` the wrapper generates (and sizes) a throwaway id pool.
 */
export function runTimelineOp({
	tracks,
	op,
	ripple = false,
	ids,
}: {
	tracks: SceneTracks;
	op: TimelineOp;
	ripple?: boolean;
	ids?: StableIdPool;
}): TimelineOpResult {
	try {
		try {
			return { ok: true, output: apply({ tracks, op, ripple, ids }) };
		} catch (error) {
			if (!ids || !(error instanceof TimelineOpError) || error.code !== "missing_ids") {
				throw error;
			}
			ids.grow();
			return { ok: true, output: apply({ tracks, op, ripple, ids }) };
		}
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

/**
 * Keeps only refs whose element exists on the named track. The old TS
 * commands skipped unknown refs and applied the rest, while Rust rejects the
 * whole op, so multi-element UI edits drop stale refs first.
 */
export function keepExistingRefs<T extends ElementRef>(
	tracks: SceneTracks,
	refs: T[],
): T[] {
	const allTracks = [...tracks.overlay, tracks.main, ...tracks.audio];
	return refs.filter(({ trackId, elementId }) =>
		allTracks.some(
			(track) =>
				track.id === trackId &&
				track.elements.some((element) => element.id === elementId),
		),
	);
}
