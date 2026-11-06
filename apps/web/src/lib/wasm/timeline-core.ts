import type {
	ApplyOpOptions,
	OpOutput,
	SceneTracks,
	TimelineError,
	TimelineOp,
	ValidateOptions,
} from "mangocut-wasm";
import { generateUUID } from "@/utils/id";

export type { OpOutput, SceneTracks, TimelineOp };

/** A typed error thrown by the Rust timeline engine. */
export class TimelineOpError extends Error {
	code: string;
	hint?: string;

	constructor({ code, message, hint }: TimelineError) {
		super(message);
		this.name = "TimelineOpError";
		this.code = code;
		this.hint = hint;
	}
}

/** The slice of the wasm module this wrapper needs (injectable for tests). */
export interface TimelineWasm {
	applyOp(options: ApplyOpOptions): OpOutput;
	validateTracks(options: ValidateOptions): TimelineError[];
}

export interface ApplyTimelineOpOptions {
	tracks: SceneTracks;
	op: TimelineOp;
	/**
	 * Explicit ids for what the op creates, consumed in order. Omit to let the
	 * wrapper generate a pool (unused ids are harmless).
	 */
	newIds?: string[];
	ripple?: boolean;
}

const MIN_ID_POOL = 32;
const IDS_PER_REFERENCE = 8;

function isTimelineError(value: unknown): value is TimelineError {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { code?: unknown }).code === "string" &&
		typeof (value as { message?: unknown }).message === "string"
	);
}

/**
 * serde-wasm-bindgen turns `undefined` into `null`, which the Rust model
 * reads as a present value. Drop undefined-valued keys before crossing.
 */
export function stripUndefined<T>(value: T): T {
	if (Array.isArray(value)) {
		return value.map((item) => stripUndefined(item)) as T;
	}
	if (typeof value === "object" && value !== null) {
		const proto = Object.getPrototypeOf(value);
		if (proto !== Object.prototype && proto !== null) return value;
		const out: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value)) {
			if (entry !== undefined) out[key] = stripUndefined(entry);
		}
		return out as T;
	}
	return value;
}

/** Elements, tracks and refs an op mentions; sizes the generated id pool. */
function countReferences(op: TimelineOp): number {
	switch (op.type) {
		case "splitElements":
		case "deleteElements":
		case "duplicateElements":
			return op.elements.length;
		case "updateElements":
			return op.updates.length;
		case "batch":
			return op.ops.reduce((sum, inner) => sum + countReferences(inner), 0);
		default:
			return 1;
	}
}

function generateIds(count: number): string[] {
	return Array.from({ length: count }, () => generateUUID());
}

export function createTimelineApi(wasm: TimelineWasm) {
	function call(options: ApplyOpOptions): OpOutput {
		try {
			return wasm.applyOp(options);
		} catch (error) {
			if (isTimelineError(error)) throw new TimelineOpError(error);
			throw error;
		}
	}

	function applyTimelineOp({
		tracks,
		op,
		newIds,
		ripple = false,
	}: ApplyTimelineOpOptions): OpOutput {
		const cleanTracks = stripUndefined(tracks);
		const cleanOp = stripUndefined(op);
		if (newIds) {
			return call({
				tracks: cleanTracks,
				op: cleanOp,
				newIds: [...newIds],
				ripple,
			});
		}
		let poolSize = Math.max(
			MIN_ID_POOL,
			IDS_PER_REFERENCE * countReferences(cleanOp),
		);
		try {
			return call({
				tracks: cleanTracks,
				op: cleanOp,
				newIds: generateIds(poolSize),
				ripple,
			});
		} catch (error) {
			if (!(error instanceof TimelineOpError) || error.code !== "missing_ids") {
				throw error;
			}
			poolSize *= 2;
			return call({
				tracks: cleanTracks,
				op: cleanOp,
				newIds: generateIds(poolSize),
				ripple,
			});
		}
	}

	function validateTimelineTracks(tracks: SceneTracks): TimelineError[] {
		return wasm.validateTracks({ tracks: stripUndefined(tracks) });
	}

	return { applyTimelineOp, validateTimelineTracks };
}
