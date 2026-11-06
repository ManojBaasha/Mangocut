import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	BasicTracerProvider,
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import {
	ForcedIdGenerator,
	__setTracingStateForTests,
	flushTracing,
	initTracing,
	isTracingEnabled,
	readLangfuseConfig,
	recordScore,
	recordToolSpan,
	recordTurnEnd,
	redactImageData,
	startModelCall,
	traceUserIdFromKey,
} from "../server";
import { rootSpanIdForTrace } from "../shared";

const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const LANGFUSE_KEYS = [
	"LANGFUSE_PUBLIC_KEY",
	"LANGFUSE_SECRET_KEY",
	"LANGFUSE_BASE_URL",
] as const;

const ctx = {
	traceId: TRACE_ID,
	sessionId: "session-1",
	step: 0,
	platform: "web" as const,
};

describe("server tracing without Langfuse env (production default)", () => {
	const saved: Record<string, string | undefined> = {};
	beforeEach(() => {
		for (const key of LANGFUSE_KEYS) {
			saved[key] = process.env[key];
			delete process.env[key];
		}
		__setTracingStateForTests(null);
	});
	afterEach(() => {
		for (const key of LANGFUSE_KEYS) {
			if (saved[key] === undefined) delete process.env[key];
			else process.env[key] = saved[key];
		}
	});

	test("is disabled and every entry point is a silent no-op", async () => {
		expect(readLangfuseConfig()).toBeNull();
		expect(isTracingEnabled()).toBe(false);
		expect(initTracing()).toBeNull();

		const call = startModelCall({
			trace: ctx,
			model: "m",
			messages: [{ role: "user", content: "hi" }],
		});
		expect(() => call.finish({ output: "ok" })).not.toThrow();
		expect(() =>
			recordToolSpan({
				type: "tool",
				...ctx,
				toolCallId: "c",
				name: "t",
				target: "shadow",
				status: "ok",
				startTime: 1,
				endTime: 2,
			}),
		).not.toThrow();
		expect(() =>
			recordTurnEnd({
				type: "turn_end",
				traceId: TRACE_ID,
				sessionId: "s",
				platform: "web",
				model: "m",
				maxSteps: 24,
				input: "i",
				output: "o",
				status: "completed",
				steps: 1,
				toolCount: 0,
				startTime: 1,
				endTime: 2,
			}),
		).not.toThrow();
		expect(() =>
			recordScore({ traceId: TRACE_ID, name: "preview_accepted", value: 1 }),
		).not.toThrow();
		await expect(flushTracing(10)).resolves.toBeUndefined();
		// Nothing was initialised as a side effect.
		expect(initTracing()).toBeNull();
	});

	test("partial config still counts as disabled", () => {
		expect(
			readLangfuseConfig({
				LANGFUSE_PUBLIC_KEY: "pk",
				LANGFUSE_SECRET_KEY: "sk",
			}),
		).toBeNull();
		expect(
			readLangfuseConfig({
				LANGFUSE_PUBLIC_KEY: "pk",
				LANGFUSE_SECRET_KEY: "sk",
				LANGFUSE_BASE_URL: "http://127.0.0.1:3100",
			}),
		).not.toBeNull();
	});
});

describe("server tracing with an in-memory exporter", () => {
	let exporter: InMemorySpanExporter;
	let scores: Array<Record<string, unknown>>;

	beforeEach(() => {
		exporter = new InMemorySpanExporter();
		scores = [];
		const idGenerator = new ForcedIdGenerator();
		const processor = new SimpleSpanProcessor(exporter);
		__setTracingStateForTests({
			provider: new BasicTracerProvider({
				idGenerator,
				spanProcessors: [processor],
			}),
			processor,
			idGenerator,
			client: {
				score: {
					create: (data: Record<string, unknown>) => scores.push(data),
				} as never,
				flush: async () => {},
			},
		});
	});
	afterEach(() => __setTracingStateForTests(null));

	test("model call becomes a generation parented to the turn root", () => {
		const call = startModelCall({
			trace: { ...ctx, step: 3 },
			userId: "user-1",
			model: "openai/gpt-4.1-mini",
			messages: [{ role: "user", content: "trim the intro" }],
			tools: [
				{
					type: "function",
					function: {
						name: "split_clip",
						description: "d",
						parameters: { type: "object" },
					},
				},
			],
		});
		call.finish({
			output: { role: "assistant", content: null, tool_calls: [{ id: "c1" }] },
			usage: {
				prompt_tokens: 10,
				completion_tokens: 5,
				total_tokens: 15,
				cost: 0.0001,
			},
			responseId: "gen-123",
			statusCode: 200,
		});
		const [span] = exporter.getFinishedSpans();
		expect(span.name).toBe("model-call");
		expect(span.spanContext().traceId).toBe(TRACE_ID);
		expect(span.parentSpanContext?.spanId).toBe(rootSpanIdForTrace(TRACE_ID));
		const a = span.attributes;
		expect(a["langfuse.observation.type"]).toBe("generation");
		expect(a["langfuse.trace.name"]).toBe("agent-turn");
		expect(a["session.id"]).toBe("session-1");
		expect(a["user.id"]).toBe("user-1");
		expect(a["langfuse.internal.is_app_root"]).toBe(false);
		expect(String(a["langfuse.observation.input"])).toContain("split_clip");
		expect(String(a["langfuse.observation.usage_details"])).toContain(
			'"total":15',
		);
		expect(String(a["langfuse.observation.cost_details"])).toContain("0.0001");
		expect(String(a["langfuse.observation.metadata.openrouterId"])).toContain(
			"gen-123",
		);
	});

	test("model call without trace context records nothing", () => {
		startModelCall({ trace: undefined, model: "m", messages: [] }).finish({});
		expect(exporter.getFinishedSpans()).toHaveLength(0);
	});

	test("failed model call is an ERROR generation", () => {
		startModelCall({ trace: ctx, model: "m", messages: [] }).finish({
			error: "rate limited",
			statusCode: 429,
		});
		const [span] = exporter.getFinishedSpans();
		expect(span.attributes["langfuse.observation.level"]).toBe("ERROR");
		expect(span.attributes["langfuse.observation.status_message"]).toBe(
			"rate limited",
		);
	});

	test("tool span keeps client timing and truncates payloads", () => {
		recordToolSpan(
			{
				type: "tool",
				...ctx,
				toolCallId: "call_1",
				name: "get_timeline_overview",
				target: "shadow",
				args: {},
				result: "z".repeat(40_000),
				status: "error",
				error: "boom",
				startTime: 1_700_000_000_000,
				endTime: 1_700_000_000_250,
			},
			"device-9",
		);
		const [span] = exporter.getFinishedSpans();
		expect(span.name).toBe("tool:get_timeline_overview");
		expect(span.attributes["langfuse.observation.type"]).toBe("tool");
		expect(span.attributes["langfuse.observation.level"]).toBe("ERROR");
		expect(String(span.attributes["langfuse.observation.output"])).toContain(
			"[truncated:",
		);
		expect(span.duration).toEqual([0, 250_000_000]);
	});

	test("turn end writes the root with the renderer trace id plus a score", () => {
		recordTurnEnd(
			{
				type: "turn_end",
				traceId: TRACE_ID,
				sessionId: "session-1",
				platform: "desktop",
				model: "openai/gpt-4.1-mini",
				maxSteps: 24,
				input: "trim the intro",
				output: "Trimmed.",
				status: "completed",
				steps: 2,
				toolCount: 1,
				startTime: 1_700_000_000_000,
				endTime: 1_700_000_005_000,
			},
			"user-1",
		);
		const [root] = exporter.getFinishedSpans();
		expect(root.name).toBe("agent-turn");
		expect(root.spanContext().traceId).toBe(TRACE_ID);
		expect(root.spanContext().spanId).toBe(rootSpanIdForTrace(TRACE_ID));
		expect(root.parentSpanContext).toBeUndefined();
		expect(root.attributes["langfuse.trace.input"]).toBe('"trim the intro"');
		expect(root.attributes["langfuse.trace.output"]).toBe('"Trimmed."');
		expect(root.attributes["langfuse.trace.tags"]).toEqual(["desktop"]);
		expect(scores).toEqual([
			expect.objectContaining({
				traceId: TRACE_ID,
				name: "turn_completed",
				value: 1,
			}),
		]);

		// The forced ids are released afterwards.
		startModelCall({ trace: undefined, model: "m", messages: [] });
		recordToolSpan({
			type: "tool",
			...ctx,
			traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			toolCallId: "c",
			name: "t",
			target: "shadow",
			status: "ok",
			startTime: 1,
			endTime: 2,
		});
		const tool = exporter.getFinishedSpans()[1];
		expect(tool.spanContext().spanId).not.toBe(rootSpanIdForTrace(TRACE_ID));
	});

	test("invalid trace ids are ignored for scores", () => {
		recordScore({ traceId: "nope", name: "preview_accepted", value: 1 });
		expect(scores).toHaveLength(0);
	});
});

describe("helpers", () => {
	test("traceUserIdFromKey maps entitlement keys", () => {
		expect(traceUserIdFromKey("user:abc")).toBe("abc");
		expect(traceUserIdFromKey("anon:device-1")).toBe("device-1");
		expect(traceUserIdFromKey("unauthenticated")).toBeUndefined();
		expect(traceUserIdFromKey(undefined)).toBeUndefined();
	});

	test("redactImageData replaces inline frames only", () => {
		const out = redactImageData([
			{
				role: "user",
				content: [
					{ type: "text", text: "describe" },
					{
						type: "image_url",
						image_url: { url: "data:image/png;base64,AAAA" },
					},
					{ type: "image_url", image_url: { url: "https://x/y.png" } },
				],
			},
		]);
		const parts = out[0].content as Array<{ image_url?: { url: string } }>;
		expect(parts[1].image_url?.url).toBe("[inline image omitted: 26 chars]");
		expect(parts[2].image_url?.url).toBe("https://x/y.png");
	});
});
