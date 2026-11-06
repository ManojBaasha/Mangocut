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
	/**
	 * Reject edits that leave a new invariant violation (`invalid_result`).
	 * Default true; the editor UI passes false to stay permissive.
	 */
	validate?: boolean;
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

/**
 * Element fields that exist only at runtime and are not JSON (an audio
 * element's decoded `buffer: AudioBuffer`). serde-wasm-bindgen reads a class
 * instance as `{}`, which is truthy, so they must never cross into wasm:
 * they are detached before the call and re-attached to the output.
 */
const RUNTIME_ONLY_KEYS = ["buffer"] as const;

type RuntimeFields = Partial<Record<(typeof RUNTIME_ONLY_KEYS)[number], unknown>>;
type ElementLike = Record<string, unknown>;

/**
 * Runtime fields are keyed by audio source, not element id: split and
 * duplicate create new elements that must share the same decoded buffer (as
 * the old TS spreads did).
 */
function runtimeKey(element: ElementLike): string {
	if (element.sourceType === "upload" && typeof element.mediaId === "string") {
		return `upload:${element.mediaId}`;
	}
	if (element.sourceType === "library" && typeof element.sourceUrl === "string") {
		return `library:${element.sourceUrl}`;
	}
	return `element:${String(element.id)}`;
}

function detachElement(element: unknown, store: Map<string, RuntimeFields>): unknown {
	if (typeof element !== "object" || element === null) return element;
	const source = element as ElementLike;
	if (!RUNTIME_ONLY_KEYS.some((key) => key in source)) return element;
	const rest: ElementLike = { ...source };
	const fields: RuntimeFields = {};
	for (const key of RUNTIME_ONLY_KEYS) {
		if (rest[key] !== undefined) fields[key] = rest[key];
		delete rest[key];
	}
	const storeKey = runtimeKey(source);
	if (Object.keys(fields).length > 0 && !store.has(storeKey)) {
		store.set(storeKey, fields);
	}
	return rest;
}

type TrackLike = { elements: unknown[] };

function detachTrack<T>(track: T, store: Map<string, RuntimeFields>): T {
	const { elements } = track as unknown as TrackLike;
	const next = elements.map((element) => detachElement(element, store));
	return next.some((element, index) => element !== elements[index])
		? ({ ...track, elements: next } as T)
		: track;
}

function detachTracks(tracks: SceneTracks, store: Map<string, RuntimeFields>): SceneTracks {
	return {
		...tracks,
		overlay: tracks.overlay.map((track) => detachTrack(track, store)),
		main: detachTrack(tracks.main, store),
		audio: tracks.audio.map((track) => detachTrack(track, store)),
	};
}

function detachOp(op: TimelineOp, store: Map<string, RuntimeFields>): TimelineOp {
	switch (op.type) {
		case "insertElement":
			return { ...op, element: detachElement(op.element, store) as typeof op.element };
		case "batch":
			return { ...op, ops: op.ops.map((inner) => detachOp(inner, store)) };
		default:
			return op;
	}
}

/** Re-attaches detached runtime fields to every matching output element. */
function reattachTracks(tracks: SceneTracks, store: Map<string, RuntimeFields>): void {
	if (store.size === 0) return;
	for (const track of [...tracks.overlay, tracks.main, ...tracks.audio]) {
		for (const element of (track as unknown as TrackLike).elements) {
			const fields = store.get(runtimeKey(element as ElementLike));
			if (fields) Object.assign(element as ElementLike, fields);
		}
	}
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

	/** Calls wasm with the given ids, or a generated (and once grown) pool. */
	function callWithIds({
		tracks,
		op,
		newIds,
		ripple,
		validate,
	}: {
		tracks: SceneTracks;
		op: TimelineOp;
		newIds?: string[];
		ripple: boolean;
		validate: boolean;
	}): OpOutput {
		if (newIds) {
			return call({ tracks, op, newIds: [...newIds], ripple, validate });
		}
		let poolSize = Math.max(MIN_ID_POOL, IDS_PER_REFERENCE * countReferences(op));
		try {
			return call({ tracks, op, newIds: generateIds(poolSize), ripple, validate });
		} catch (error) {
			if (!(error instanceof TimelineOpError) || error.code !== "missing_ids") {
				throw error;
			}
			poolSize *= 2;
			return call({ tracks, op, newIds: generateIds(poolSize), ripple, validate });
		}
	}

	function applyTimelineOp({
		tracks,
		op,
		newIds,
		ripple = false,
		validate = true,
	}: ApplyTimelineOpOptions): OpOutput {
		const runtime = new Map<string, RuntimeFields>();
		const output = callWithIds({
			tracks: stripUndefined(detachTracks(tracks, runtime)),
			op: stripUndefined(detachOp(op, runtime)),
			newIds,
			ripple,
			validate,
		});
		reattachTracks(output.tracks, runtime);
		return output;
	}

	function validateTimelineTracks(tracks: SceneTracks): TimelineError[] {
		return wasm.validateTracks({
			tracks: stripUndefined(detachTracks(tracks, new Map())),
		});
	}

	return { applyTimelineOp, validateTimelineTracks };
}
