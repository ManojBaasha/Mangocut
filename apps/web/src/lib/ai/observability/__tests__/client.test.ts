import { describe, expect, test } from "bun:test";
import {
	TraceEventBatcher,
	TurnTrace,
	createTraceId,
	notePreviewTrace,
	pendingPreviewTraceIds,
	recordPreviewDecision,
	type TraceSender,
} from "../client";
import {
	MAX_TRACE_PAYLOAD_CHARS,
	isValidTraceId,
	rootSpanIdForTrace,
	traceBatchSchema,
	traceContextSchema,
	truncatePayload,
	type TraceEvent,
} from "../shared";

function recordingSender(enabled = true) {
	const batches: TraceEvent[][] = [];
	const send: TraceSender = async (events) => {
		batches.push(events);
		return { enabled };
	};
	return { batches, send };
}

describe("trace ids", () => {
	test("createTraceId returns 32 lowercase hex chars and is unique", () => {
		const ids = new Set(Array.from({ length: 200 }, () => createTraceId()));
		expect(ids.size).toBe(200);
		for (const id of ids) {
			expect(id).toMatch(/^[0-9a-f]{32}$/);
			expect(isValidTraceId(id)).toBe(true);
		}
	});

	test("createTraceId never returns the all-zero (invalid) id", () => {
		const zeros = (bytes: Uint8Array) => bytes.fill(0);
		const id = createTraceId(zeros);
		expect(isValidTraceId(id)).toBe(true);
	});

	test("isValidTraceId rejects malformed ids", () => {
		expect(isValidTraceId("0".repeat(32))).toBe(false);
		expect(isValidTraceId("ABCDEF".padEnd(32, "0"))).toBe(false);
		expect(isValidTraceId("abc")).toBe(false);
		expect(isValidTraceId(42)).toBe(false);
	});

	test("root span id is derived, 16 hex and non-zero", () => {
		const id = createTraceId();
		expect(rootSpanIdForTrace(id)).toMatch(/^[0-9a-f]{16}$/);
		expect(rootSpanIdForTrace(id)).toBe(rootSpanIdForTrace(id));
		expect(rootSpanIdForTrace(`${"a".repeat(16)}${"0".repeat(16)}`)).toBe(
			"0000000000000001",
		);
	});

	test("trace context schema is strict and validates the id", () => {
		const ctx = {
			traceId: createTraceId(),
			sessionId: "s",
			step: 0,
			platform: "web",
		};
		expect(traceContextSchema.safeParse(ctx).success).toBe(true);
		expect(traceContextSchema.safeParse({ ...ctx, extra: 1 }).success).toBe(
			false,
		);
		expect(
			traceContextSchema.safeParse({ ...ctx, traceId: "0".repeat(32) }).success,
		).toBe(false);
	});
});

describe("truncatePayload", () => {
	test("passes small values through unchanged", () => {
		const value = { a: 1, b: ["x"] };
		expect(truncatePayload(value)).toBe(value);
		expect(truncatePayload("short")).toBe("short");
		expect(truncatePayload(undefined)).toBeUndefined();
	});

	test("cuts large payloads to ~20 KB with a marker", () => {
		const big = { data: "x".repeat(50_000) };
		const out = truncatePayload(big);
		expect(typeof out).toBe("string");
		const text = out as string;
		expect(text.startsWith('{"data":"xxx')).toBe(true);
		expect(text).toContain("[truncated: showing 20000 of 50011 chars]");
		expect(text.length).toBeLessThan(MAX_TRACE_PAYLOAD_CHARS + 100);
	});

	test("survives values that cannot be serialized", () => {
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		expect(() => truncatePayload(cyclic, 5)).not.toThrow();
	});
});

describe("TraceEventBatcher", () => {
	const score = (i: number): TraceEvent => ({
		type: "score",
		traceId: createTraceId(),
		name: "preview_accepted",
		value: i % 2,
	});

	test("batches until flush and sends in order", async () => {
		const { batches, send } = recordingSender();
		const batcher = new TraceEventBatcher({ send, flushIntervalMs: 0 });
		batcher.enqueue(score(1));
		batcher.enqueue(score(2));
		expect(batches.length).toBe(0);
		await batcher.flush();
		expect(batches.length).toBe(1);
		expect(batches[0].length).toBe(2);
		expect(batcher.pending).toBe(0);
	});

	test("auto-flushes when the batch is full and splits big queues", async () => {
		const { batches, send } = recordingSender();
		const batcher = new TraceEventBatcher({
			send,
			maxBatch: 3,
			flushIntervalMs: 0,
		});
		for (let i = 0; i < 7; i++) batcher.enqueue(score(i));
		await batcher.flush();
		expect(batches.map((b) => b.length)).toEqual([3, 3, 1]);
		for (const batch of batches) {
			expect(traceBatchSchema.safeParse({ events: batch }).success).toBe(true);
		}
	});

	test("flushes on the interval timer", async () => {
		const { batches, send } = recordingSender();
		const batcher = new TraceEventBatcher({ send, flushIntervalMs: 10 });
		batcher.enqueue(score(1));
		await new Promise((r) => setTimeout(r, 40));
		expect(batches.length).toBe(1);
	});

	test("stops sending once the server reports tracing off", async () => {
		const { batches, send } = recordingSender(false);
		const batcher = new TraceEventBatcher({ send, flushIntervalMs: 0 });
		batcher.enqueue(score(1));
		await batcher.flush();
		batcher.enqueue(score(2));
		await batcher.flush();
		expect(batches.length).toBe(1);
		expect(batcher.isDisabled).toBe(true);
	});

	test("swallows transport errors", async () => {
		const batcher = new TraceEventBatcher({
			send: async () => {
				throw new Error("offline");
			},
			flushIntervalMs: 0,
		});
		batcher.enqueue(score(1));
		await expect(batcher.flush()).resolves.toBeUndefined();
	});
});

describe("TurnTrace", () => {
	test("records tool spans and a turn end that pass the server schema", async () => {
		const { batches, send } = recordingSender();
		const batcher = new TraceEventBatcher({ send, flushIntervalMs: 0 });
		const turn = new TurnTrace({
			sessionId: "session-1",
			platform: "desktop",
			model: "openai/gpt-4.1-mini",
			maxSteps: 24,
			userMessage: "trim the intro",
			batcher,
			now: 1_000,
		});
		expect(turn.context(2)).toEqual({
			traceId: turn.traceId,
			sessionId: "session-1",
			step: 2,
			platform: "desktop",
		});
		turn.recordTool({
			step: 0,
			toolCallId: "call_1",
			name: "get_timeline_overview",
			target: "shadow",
			args: {},
			result: { tracks: 2, blob: "y".repeat(30_000) },
			startTime: 1_100,
			endTime: 1_200,
		});
		turn.recordTool({
			step: 1,
			toolCallId: "call_2",
			name: "split_clip",
			target: "shadow",
			args: { at: 3 },
			result: { error: "no clip" },
			error: "no clip",
			startTime: 1_300,
			endTime: 1_250, // clock skew is clamped
		});
		await turn.end({
			status: "completed",
			output: "Done",
			steps: 3,
			now: 2_000,
		});
		await turn.end({ status: "error", output: "x", steps: 9 }); // ignored

		const events = batches.flat();
		expect(events.map((e) => e.type)).toEqual(["tool", "tool", "turn_end"]);
		expect(traceBatchSchema.safeParse({ events }).success).toBe(true);
		const [first, second, end] = events;
		if (
			first.type !== "tool" ||
			second.type !== "tool" ||
			end.type !== "turn_end"
		) {
			throw new Error("unexpected event types");
		}
		expect(typeof first.result).toBe("string");
		expect(first.result as string).toContain("[truncated:");
		expect(second.status).toBe("error");
		expect(second.endTime).toBe(1_300);
		expect(end.toolCount).toBe(2);
		expect(end.input).toBe("trim the intro");
		expect(end.startTime).toBe(1_000);
		expect(end.endTime).toBe(2_000);
	});

	test("preview decision scores every pending turn once", async () => {
		const { batches, send } = recordingSender();
		const batcher = new TraceEventBatcher({ send, flushIntervalMs: 0 });
		const a = createTraceId();
		const b = createTraceId();
		notePreviewTrace(a);
		notePreviewTrace(b);
		notePreviewTrace(a);
		notePreviewTrace("not-a-trace-id");
		expect(pendingPreviewTraceIds()).toEqual([a, b]);
		recordPreviewDecision(true, batcher);
		await batcher.flush();
		expect(pendingPreviewTraceIds()).toEqual([]);
		const events = batches.flat();
		expect(events).toHaveLength(2);
		for (const event of events) {
			expect(event).toMatchObject({
				type: "score",
				name: "preview_accepted",
				value: 1,
			});
		}
		recordPreviewDecision(false, batcher);
		await batcher.flush();
		expect(batches.flat()).toHaveLength(2);
	});
});
