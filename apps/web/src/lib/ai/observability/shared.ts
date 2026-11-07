/**
 * Agent observability: types, validation and helpers shared by the renderer
 * (client.ts) and the server (server.ts). Must stay free of Langfuse/OTel
 * imports so the renderer bundle never pulls them in.
 */
import { z } from "zod";

/** W3C trace id: 32 lowercase hex chars, not all zeros. */
export const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/;
const ZERO_TRACE_ID = "0".repeat(32);

/** Tool args/results larger than this are cut, with a marker (~20 KB). */
export const MAX_TRACE_PAYLOAD_CHARS = 20_000;

/** Upper bounds for one POST /api/ai/trace call. */
export const MAX_TRACE_BATCH_EVENTS = 50;
export const MAX_TRACE_BODY_BYTES = 2_000_000;

export const TRACE_NAME = "agent-turn";

export function isValidTraceId(value: unknown): value is string {
	return (
		typeof value === "string" &&
		TRACE_ID_PATTERN.test(value) &&
		value !== ZERO_TRACE_ID
	);
}

/**
 * Span id of the `agent-turn` root observation. Derived from the trace id so
 * the renderer only has to carry one id and every server request can parent
 * its observations to the same root.
 */
export function rootSpanIdForTrace(traceId: string): string {
	const half = traceId.slice(16);
	return /^0+$/.test(half) ? "0000000000000001" : half;
}

/**
 * Bounds a value for tracing. Small values pass through unchanged; larger ones
 * become a string prefix of their JSON with a truncation marker.
 */
export function truncatePayload(
	value: unknown,
	maxChars: number = MAX_TRACE_PAYLOAD_CHARS,
): unknown {
	if (value === undefined) return undefined;
	let text: string;
	if (typeof value === "string") {
		text = value;
	} else {
		try {
			text = JSON.stringify(value) ?? String(value);
		} catch {
			text = String(value);
		}
	}
	if (text.length <= maxChars) return value;
	return `${text.slice(0, maxChars)}…[truncated: showing ${maxChars} of ${text.length} chars]`;
}

const traceIdSchema = z
	.string()
	.refine(isValidTraceId, "traceId must be 32 lowercase hex chars");

export const platformSchema = z.enum(["web", "desktop"]);
export type TracePlatform = z.infer<typeof platformSchema>;

/** Correlation info the renderer attaches to /api/ai/chat and /api/ai/vision. */
export const traceContextSchema = z
	.object({
		traceId: traceIdSchema,
		sessionId: z.string().min(1).max(200),
		step: z.number().int().min(0).max(1000),
		platform: platformSchema,
	})
	.strict();
export type TraceContext = z.infer<typeof traceContextSchema>;

const timestampSchema = z.number().int().positive();

export const toolSpanEventSchema = z
	.object({
		type: z.literal("tool"),
		traceId: traceIdSchema,
		sessionId: z.string().min(1).max(200),
		platform: platformSchema,
		step: z.number().int().min(0).max(1000),
		toolCallId: z.string().max(200),
		name: z.string().min(1).max(200),
		target: z.enum(["shadow", "final"]),
		args: z.unknown().optional(),
		result: z.unknown().optional(),
		status: z.enum(["ok", "error"]),
		error: z.string().max(4000).optional(),
		startTime: timestampSchema,
		endTime: timestampSchema,
	})
	.strict();
export type ToolSpanEvent = z.infer<typeof toolSpanEventSchema>;

export const turnStatusSchema = z.enum([
	"completed",
	"max_steps",
	"verify_failed",
	"error",
]);
export type TurnStatus = z.infer<typeof turnStatusSchema>;

export const turnEndEventSchema = z
	.object({
		type: z.literal("turn_end"),
		traceId: traceIdSchema,
		sessionId: z.string().min(1).max(200),
		platform: platformSchema,
		model: z.string().max(200),
		maxSteps: z.number().int().min(0).max(1000),
		input: z.string().max(50_000),
		output: z.string().max(50_000),
		status: turnStatusSchema,
		steps: z.number().int().min(0).max(1000),
		toolCount: z.number().int().min(0).max(100_000),
		/** Tool calls that threw or returned { ok: false }. */
		toolErrors: z.number().int().min(0).max(100_000).optional(),
		error: z.string().max(4000).optional(),
		/** JSON summary of the AI Preview timeline when the turn ended (for judges). */
		finalState: z.string().max(40_000).optional(),
		startTime: timestampSchema,
		endTime: timestampSchema,
	})
	.strict();
export type TurnEndEvent = z.infer<typeof turnEndEventSchema>;

export const scoreEventSchema = z
	.object({
		type: z.literal("score"),
		traceId: traceIdSchema,
		name: z.enum(["preview_accepted"]),
		value: z.number().min(0).max(1),
		comment: z.string().max(1000).optional(),
	})
	.strict();
export type ScoreEvent = z.infer<typeof scoreEventSchema>;

export const traceEventSchema = z.discriminatedUnion("type", [
	toolSpanEventSchema,
	turnEndEventSchema,
	scoreEventSchema,
]);
export type TraceEvent = z.infer<typeof traceEventSchema>;

export const traceBatchSchema = z
	.object({
		events: z.array(traceEventSchema).min(1).max(MAX_TRACE_BATCH_EVENTS),
	})
	.strict();
export type TraceBatch = z.infer<typeof traceBatchSchema>;

/** Response header the server sets when tracing is not configured. */
export const TRACING_DISABLED_HEADER = "x-mangocut-tracing";
