/**
 * Server-only agent tracing into Langfuse (OpenTelemetry, Langfuse JS SDK v6).
 *
 * Everything here is a no-op unless LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY
 * and LANGFUSE_BASE_URL are all set. Nothing throws into callers: tracing must
 * never break or slow an AI request.
 *
 * Trace model (one trace per agent turn, id chosen by the renderer):
 *   agent-turn (agent, root; written at turn end)
 *     model-call  (generation, /api/ai/chat)    x steps
 *     vision-call (generation, /api/ai/vision)  when describe_media runs
 *     tool:<name> (tool, reported by the renderer via /api/ai/trace)
 * Scores: turn_completed (at turn end), preview_accepted (Accept/Reject).
 *
 * Keep this module free of next/* imports so scripts and tests can load it.
 */
import { TraceFlags, type Span, type SpanContext } from "@opentelemetry/api";
import {
	BasicTracerProvider,
	RandomIdGenerator,
	type IdGenerator,
	type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import {
	LangfuseOtelSpanAttributes,
	setLangfuseTracerProvider,
	startObservation,
	type LangfuseAgent,
} from "@langfuse/tracing";
import { LangfuseClient } from "@langfuse/client";
import packageJson from "../../../../package.json";
import {
	TRACE_NAME,
	isValidTraceId,
	rootSpanIdForTrace,
	truncatePayload,
	type ToolSpanEvent,
	type TraceContext,
	type TracePlatform,
	type TurnEndEvent,
} from "./shared";

export const APP_VERSION: string = packageJson.version;

interface LangfuseConfig {
	publicKey: string;
	secretKey: string;
	baseUrl: string;
}

export function readLangfuseConfig(
	env: Record<string, string | undefined> = process.env,
): LangfuseConfig | null {
	const publicKey = env.LANGFUSE_PUBLIC_KEY?.trim();
	const secretKey = env.LANGFUSE_SECRET_KEY?.trim();
	const baseUrl = env.LANGFUSE_BASE_URL?.trim();
	if (!publicKey || !secretKey || !baseUrl) return null;
	return { publicKey, secretKey, baseUrl };
}

export function isTracingEnabled(): boolean {
	return readLangfuseConfig() !== null;
}

/**
 * Lets the root observation take the renderer's trace id and the derived root
 * span id. Only consulted synchronously inside withForcedIds().
 */
class ForcedIdGenerator implements IdGenerator {
	private readonly random = new RandomIdGenerator();
	forced: { traceId: string; spanId: string } | null = null;

	generateTraceId(): string {
		return this.forced?.traceId ?? this.random.generateTraceId();
	}

	generateSpanId(): string {
		return this.forced?.spanId ?? this.random.generateSpanId();
	}
}

interface TracingState {
	provider: BasicTracerProvider;
	processor: SpanProcessor;
	idGenerator: ForcedIdGenerator;
	client: LangfuseClient;
}

const STATE_KEY = Symbol.for("mangocut.observability.tracing");
type GlobalWithTracing = typeof globalThis & {
	[STATE_KEY]?: TracingState | null;
};

let warned = false;
function warnOnce(error: unknown): void {
	if (warned) return;
	warned = true;
	console.warn(
		"[mangocut] Langfuse tracing error (further errors suppressed):",
		error instanceof Error ? error.message : error,
	);
}

/**
 * Initialises tracing once per process (survives dev HMR via globalThis).
 * Returns null when tracing is not configured.
 */
export function initTracing(): TracingState | null {
	const g = globalThis as GlobalWithTracing;
	if (g[STATE_KEY] !== undefined) return g[STATE_KEY] ?? null;
	const config = readLangfuseConfig();
	if (!config) return null; // re-checked on next call; env may load later
	try {
		const processor = new LangfuseSpanProcessor({
			publicKey: config.publicKey,
			secretKey: config.secretKey,
			baseUrl: config.baseUrl,
			// Frames are replaced by placeholders before tracing; no media upload.
			mediaUploadEnabled: false,
			flushInterval: 2,
		});
		const idGenerator = new ForcedIdGenerator();
		const provider = new BasicTracerProvider({
			idGenerator,
			spanProcessors: [processor],
		});
		// Isolated provider: Next's own OTel spans are untouched.
		setLangfuseTracerProvider(provider);
		const client = new LangfuseClient({
			publicKey: config.publicKey,
			secretKey: config.secretKey,
			baseUrl: config.baseUrl,
		});
		g[STATE_KEY] = { provider, processor, idGenerator, client };
	} catch (error) {
		warnOnce(error);
		g[STATE_KEY] = null;
	}
	return g[STATE_KEY] ?? null;
}

/** Test hook: install (or clear with null) a tracing state. */
export function __setTracingStateForTests(
	state: {
		provider: BasicTracerProvider;
		processor: SpanProcessor;
		idGenerator: ForcedIdGenerator;
		client: Pick<LangfuseClient, "score" | "flush">;
	} | null,
): void {
	const g = globalThis as GlobalWithTracing;
	if (state === null) {
		delete g[STATE_KEY];
		return;
	}
	setLangfuseTracerProvider(state.provider);
	g[STATE_KEY] = { ...state, client: state.client as LangfuseClient };
}

export { ForcedIdGenerator };

function rootParent(traceId: string): SpanContext {
	return {
		traceId,
		spanId: rootSpanIdForTrace(traceId),
		traceFlags: TraceFlags.SAMPLED,
		isRemote: true,
	};
}

interface TraceIdentity {
	traceId: string;
	sessionId: string;
	platform: TracePlatform;
	userId?: string;
	model?: string;
	maxSteps?: number;
}

/** Trace-level fields go on every observation: the root is written last. */
function applyTraceAttributes(span: Span, identity: TraceIdentity): void {
	span.setAttribute(LangfuseOtelSpanAttributes.TRACE_NAME, TRACE_NAME);
	span.setAttribute(
		LangfuseOtelSpanAttributes.TRACE_SESSION_ID,
		identity.sessionId,
	);
	if (identity.userId) {
		span.setAttribute(
			LangfuseOtelSpanAttributes.TRACE_USER_ID,
			identity.userId,
		);
	}
	span.setAttribute(LangfuseOtelSpanAttributes.TRACE_TAGS, [identity.platform]);
	const metadata: Record<string, string | number | undefined> = {
		appVersion: APP_VERSION,
		platform: identity.platform,
		model: identity.model,
		maxSteps: identity.maxSteps,
	};
	for (const [key, value] of Object.entries(metadata)) {
		if (value === undefined) continue;
		span.setAttribute(
			`${LangfuseOtelSpanAttributes.TRACE_METADATA}.${key}`,
			String(value),
		);
	}
}

/**
 * Children are parented to a root that is exported later (or never, if the
 * renderer dies mid-turn). Without this the SDK marks each child an app root.
 */
function markNotRoot(span: Span): void {
	span.setAttribute(LangfuseOtelSpanAttributes.IS_APP_ROOT, false);
}

/** `user:<id>` / `anon:<device>` entitlement keys → Langfuse user id. */
export function traceUserIdFromKey(
	key: string | undefined,
): string | undefined {
	if (!key || key === "unauthenticated") return undefined;
	const idx = key.indexOf(":");
	return (idx >= 0 ? key.slice(idx + 1) : key).slice(0, 200) || undefined;
}

type ChatMessageLike = { role: string; content?: unknown };

/** Replaces inline image data URLs with placeholders before tracing. */
export function redactImageData(
	messages: ChatMessageLike[],
): ChatMessageLike[] {
	return messages.map((message) => {
		if (!Array.isArray(message.content)) return message;
		return {
			...message,
			content: message.content.map((part: unknown) => {
				if (
					part &&
					typeof part === "object" &&
					(part as { type?: string }).type === "image_url"
				) {
					const url =
						(part as { image_url?: { url?: string } }).image_url?.url ?? "";
					return {
						type: "image_url",
						image_url: {
							url: url.startsWith("data:")
								? `[inline image omitted: ${url.length} chars]`
								: url,
						},
					};
				}
				return part;
			}),
		};
	});
}

function summarizeTools(tools: unknown[] | undefined): unknown[] | undefined {
	if (!tools?.length) return undefined;
	return tools.map((tool) => {
		const fn = (tool as { function?: { name?: string; parameters?: unknown } })
			.function;
		return fn ? { name: fn.name, parameters: fn.parameters } : tool;
	});
}

export interface OpenRouterUsage {
	prompt_tokens?: number;
	completion_tokens?: number;
	total_tokens?: number;
	cost?: number;
}

export interface ModelCallHandle {
	finish(result: {
		output?: unknown;
		usage?: OpenRouterUsage;
		responseId?: string;
		responseModel?: string;
		error?: string;
		statusCode?: number;
	}): void;
}

const NOOP_MODEL_CALL: ModelCallHandle = { finish: () => {} };

/**
 * Starts a generation for one OpenRouter call. Returns a no-op handle when
 * tracing is off or the request carries no trace context.
 */
export function startModelCall({
	trace,
	userId,
	name = "model-call",
	model,
	messages,
	tools,
	modelParameters,
}: {
	trace: TraceContext | undefined;
	userId?: string;
	name?: "model-call" | "vision-call";
	model: string;
	messages: ChatMessageLike[];
	tools?: unknown[];
	modelParameters?: Record<string, string | number>;
}): ModelCallHandle {
	if (!trace || !isValidTraceId(trace.traceId)) return NOOP_MODEL_CALL;
	const state = initTracing();
	if (!state) return NOOP_MODEL_CALL;
	try {
		const startedAt = Date.now();
		const generation = startObservation(
			name,
			{
				model,
				modelParameters,
				input: {
					messages: redactImageData(messages),
					...(tools?.length ? { tools: summarizeTools(tools) } : {}),
				},
				metadata: { step: trace.step, platform: trace.platform },
			},
			{ asType: "generation", parentSpanContext: rootParent(trace.traceId) },
		);
		applyTraceAttributes(generation.otelSpan, { ...trace, userId, model });
		markNotRoot(generation.otelSpan);
		let finished = false;
		return {
			finish(result) {
				if (finished) return;
				finished = true;
				try {
					const usage = result.usage;
					generation.update({
						output: result.output,
						model: result.responseModel || model,
						usageDetails: usage
							? {
									input: usage.prompt_tokens ?? 0,
									output: usage.completion_tokens ?? 0,
									total: usage.total_tokens ?? 0,
								}
							: undefined,
						costDetails:
							typeof usage?.cost === "number"
								? { total: usage.cost }
								: undefined,
						metadata: {
							step: trace.step,
							platform: trace.platform,
							openrouterId: result.responseId,
							statusCode: result.statusCode,
							latencyMs: Date.now() - startedAt,
						},
						...(result.error
							? { level: "ERROR" as const, statusMessage: result.error }
							: {}),
					});
					generation.end();
				} catch (error) {
					warnOnce(error);
				}
			},
		};
	} catch (error) {
		warnOnce(error);
		return NOOP_MODEL_CALL;
	}
}

/** Records one renderer-executed tool call as a `tool:<name>` observation. */
export function recordToolSpan(event: ToolSpanEvent, userId?: string): void {
	const state = initTracing();
	if (!state) return;
	try {
		const span = startObservation(
			`tool:${event.name}`,
			{
				input: truncatePayload(event.args),
				output: truncatePayload(event.result),
				metadata: {
					step: event.step,
					target: event.target,
					status: event.status,
					toolCallId: event.toolCallId,
					durationMs: event.endTime - event.startTime,
				},
				...(event.status === "error"
					? { level: "ERROR" as const, statusMessage: event.error ?? "error" }
					: {}),
			},
			{
				asType: "tool",
				startTime: new Date(event.startTime),
				parentSpanContext: rootParent(event.traceId),
			},
		);
		applyTraceAttributes(span.otelSpan, { ...event, userId });
		markNotRoot(span.otelSpan);
		span.end(new Date(event.endTime));
	} catch (error) {
		warnOnce(error);
	}
}

/**
 * Writes the `agent-turn` root observation (ids forced to the renderer's trace
 * id + derived root span id) and the `turn_completed` score.
 */
export function recordTurnEnd(event: TurnEndEvent, userId?: string): void {
	const state = initTracing();
	if (!state) return;
	try {
		state.idGenerator.forced = {
			traceId: event.traceId,
			spanId: rootSpanIdForTrace(event.traceId),
		};
		let root: LangfuseAgent;
		try {
			root = startObservation(
				TRACE_NAME,
				{
					input: event.input,
					output: event.output,
					metadata: {
						status: event.status,
						steps: event.steps,
						toolCount: event.toolCount,
						error: event.error,
						model: event.model,
						maxSteps: event.maxSteps,
					},
					...(event.status === "error"
						? { level: "ERROR" as const, statusMessage: event.error ?? "error" }
						: event.status !== "completed"
							? { level: "WARNING" as const, statusMessage: event.status }
							: {}),
				},
				{ asType: "agent", startTime: new Date(event.startTime) },
			);
		} finally {
			state.idGenerator.forced = null;
		}
		const span = root.otelSpan;
		if (span.spanContext().traceId !== event.traceId) {
			throw new Error("agent-turn root did not take the renderer trace id");
		}
		applyTraceAttributes(span, { ...event, userId });
		span.setAttribute(
			LangfuseOtelSpanAttributes.TRACE_INPUT,
			JSON.stringify(event.input),
		);
		span.setAttribute(
			LangfuseOtelSpanAttributes.TRACE_OUTPUT,
			JSON.stringify(event.output),
		);
		root.end(new Date(event.endTime));
		recordScore({
			traceId: event.traceId,
			name: "turn_completed",
			value: event.status === "completed" ? 1 : 0,
			comment: event.error ? `${event.status}: ${event.error}` : event.status,
		});
	} catch (error) {
		warnOnce(error);
	}
}

export function recordScore({
	traceId,
	name,
	value,
	comment,
}: {
	traceId: string;
	name: string;
	value: number;
	comment?: string;
}): void {
	if (!isValidTraceId(traceId)) return;
	const state = initTracing();
	if (!state) return;
	try {
		state.client.score.create({
			traceId,
			name,
			value,
			dataType: "NUMERIC",
			comment,
		});
	} catch (error) {
		warnOnce(error);
	}
}

/**
 * Pushes buffered spans and scores, waiting at most `timeoutMs`. Call it from
 * Next's after() so responses are not delayed.
 */
export async function flushTracing(timeoutMs = 1500): Promise<void> {
	const g = globalThis as GlobalWithTracing;
	const state = g[STATE_KEY];
	if (!state) return;
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			Promise.allSettled([state.processor.forceFlush(), state.client.flush()]),
			new Promise<void>((resolve) => {
				timer = setTimeout(resolve, timeoutMs);
			}),
		]);
	} catch (error) {
		warnOnce(error);
	} finally {
		if (timer) clearTimeout(timer);
	}
}
