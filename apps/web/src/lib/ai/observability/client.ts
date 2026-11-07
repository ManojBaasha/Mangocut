/**
 * Renderer-side agent tracing: trace ids, per-turn bookkeeping and batched
 * delivery of tool spans / turn ends / scores to POST /api/ai/trace.
 *
 * No Langfuse or OpenTelemetry imports here and no keys: the server decides
 * whether anything is recorded. When it answers that tracing is off, the
 * renderer stops sending for the rest of the session.
 */
import { aiRequestHeaders } from "@/lib/ai/device-id";
import {
	MAX_TRACE_BATCH_EVENTS,
	TRACING_DISABLED_HEADER,
	isValidTraceId,
	truncatePayload,
	type TraceContext,
	type TraceEvent,
	type TracePlatform,
	type TurnStatus,
} from "./shared";

type RandomFill = (bytes: Uint8Array) => Uint8Array;

const defaultRandomFill: RandomFill = (bytes) => {
	if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
		return crypto.getRandomValues(bytes);
	}
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = Math.floor(Math.random() * 256);
	}
	return bytes;
};

/** New W3C trace id (32 lowercase hex chars, never all zeros). */
export function createTraceId(
	randomFill: RandomFill = defaultRandomFill,
): string {
	for (let attempt = 0; attempt < 4; attempt++) {
		const bytes = randomFill(new Uint8Array(16));
		const id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
			"",
		);
		if (isValidTraceId(id)) return id;
	}
	return `${"0".repeat(31)}1`;
}

/** New chat session id (one per conversation). */
export function createChatSessionId(): string {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}
	return `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export type TraceSendResult = { enabled: boolean };
export type TraceSender = (events: TraceEvent[]) => Promise<TraceSendResult>;

/**
 * Queues trace events and sends them in batches. Delivery is best effort:
 * failures are swallowed and never surface to the agent loop.
 */
export class TraceEventBatcher {
	private queue: TraceEvent[] = [];
	private timer: ReturnType<typeof setTimeout> | null = null;
	private inflight: Promise<void> = Promise.resolve();
	private disabled = false;
	private readonly send: TraceSender;
	private readonly maxBatch: number;
	private readonly flushIntervalMs: number;

	constructor({
		send,
		maxBatch = 20,
		flushIntervalMs = 2000,
	}: {
		send: TraceSender;
		maxBatch?: number;
		flushIntervalMs?: number;
	}) {
		this.send = send;
		this.maxBatch = Math.min(Math.max(1, maxBatch), MAX_TRACE_BATCH_EVENTS);
		this.flushIntervalMs = flushIntervalMs;
	}

	get isDisabled(): boolean {
		return this.disabled;
	}

	get pending(): number {
		return this.queue.length;
	}

	enqueue(event: TraceEvent): void {
		if (this.disabled) return;
		this.queue.push(event);
		if (this.queue.length >= this.maxBatch) {
			void this.flush();
			return;
		}
		if (!this.timer && this.flushIntervalMs > 0) {
			this.timer = setTimeout(() => {
				this.timer = null;
				void this.flush();
			}, this.flushIntervalMs);
		}
	}

	/** Sends everything queued so far; resolves once those batches settle. */
	flush(): Promise<void> {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		const run = async () => {
			while (this.queue.length > 0 && !this.disabled) {
				const batch = this.queue.splice(0, this.maxBatch);
				try {
					const result = await this.send(batch);
					if (!result.enabled) {
						this.disabled = true;
						this.queue = [];
					}
				} catch {
					// best effort: drop the batch
				}
			}
		};
		this.inflight = this.inflight.then(run, run);
		return this.inflight;
	}
}

const fetchSender: TraceSender = async (events) => {
	const res = await fetch("/api/ai/trace", {
		method: "POST",
		headers: aiRequestHeaders(),
		credentials: "include",
		body: JSON.stringify({ events }),
	});
	return { enabled: res.headers.get(TRACING_DISABLED_HEADER) !== "off" };
};

let defaultBatcher: TraceEventBatcher | null = null;

function getDefaultBatcher(): TraceEventBatcher | null {
	if (typeof window === "undefined" || typeof fetch === "undefined") {
		return null;
	}
	defaultBatcher ??= new TraceEventBatcher({ send: fetchSender });
	return defaultBatcher;
}

type BatcherLike = Pick<TraceEventBatcher, "enqueue" | "flush">;

/** Tracks one agent turn (one Langfuse trace). */
export class TurnTrace {
	readonly traceId: string;
	readonly sessionId: string;
	readonly platform: TracePlatform;
	readonly model: string;
	readonly maxSteps: number;
	readonly userMessage: string;
	readonly startTime: number;
	private toolCount = 0;
	private toolErrorCount = 0;
	private ended = false;
	private readonly batcher: BatcherLike | null;

	constructor({
		sessionId,
		platform,
		model,
		maxSteps,
		userMessage,
		batcher,
		traceId = createTraceId(),
		now = Date.now(),
	}: {
		sessionId: string;
		platform: TracePlatform;
		model: string;
		maxSteps: number;
		userMessage: string;
		batcher: BatcherLike | null;
		traceId?: string;
		now?: number;
	}) {
		this.traceId = traceId;
		this.sessionId = sessionId;
		this.platform = platform;
		this.model = model;
		this.maxSteps = maxSteps;
		this.userMessage = userMessage;
		this.startTime = now;
		this.batcher = batcher;
	}

	get toolCalls(): number {
		return this.toolCount;
	}

	/** Body field for /api/ai/chat and /api/ai/vision. */
	context(step: number): TraceContext {
		return {
			traceId: this.traceId,
			sessionId: this.sessionId,
			step,
			platform: this.platform,
		};
	}

	recordTool({
		step,
		toolCallId,
		name,
		target,
		args,
		result,
		error,
		startTime,
		endTime = Date.now(),
	}: {
		step: number;
		toolCallId: string;
		name: string;
		target: "shadow" | "final";
		args: unknown;
		result: unknown;
		error?: string;
		startTime: number;
		endTime?: number;
	}): void {
		this.toolCount += 1;
		if (error) this.toolErrorCount += 1;
		this.batcher?.enqueue({
			type: "tool",
			traceId: this.traceId,
			sessionId: this.sessionId,
			platform: this.platform,
			step,
			toolCallId: toolCallId.slice(0, 200),
			name: name.slice(0, 200),
			target,
			args: truncatePayload(args),
			result: truncatePayload(result),
			status: error ? "error" : "ok",
			error: error?.slice(0, 4000),
			startTime: Math.floor(startTime),
			endTime: Math.max(Math.floor(endTime), Math.floor(startTime)),
		});
	}

	/** Records the turn outcome and flushes. Safe to call more than once. */
	end({
		status,
		output,
		steps,
		error,
		finalState,
		now = Date.now(),
	}: {
		status: TurnStatus;
		output: string;
		steps: number;
		error?: string;
		/** Summary of the timeline the turn left behind (JSON-serialisable). */
		finalState?: unknown;
		now?: number;
	}): Promise<void> {
		if (this.ended || !this.batcher) return Promise.resolve();
		this.ended = true;
		this.batcher.enqueue({
			type: "turn_end",
			traceId: this.traceId,
			sessionId: this.sessionId,
			platform: this.platform,
			model: this.model.slice(0, 200),
			maxSteps: this.maxSteps,
			input: this.userMessage.slice(0, 50_000),
			output: output.slice(0, 50_000),
			status,
			steps,
			toolCount: this.toolCount,
			toolErrors: this.toolErrorCount,
			error: error?.slice(0, 4000),
			...(finalState === undefined
				? {}
				: { finalState: JSON.stringify(finalState).slice(0, 40_000) }),
			startTime: this.startTime,
			endTime: Math.max(now, this.startTime),
		});
		return this.batcher.flush();
	}
}

let activeTurn: TurnTrace | null = null;
let activeStep = 0;

export function startTurnTrace(params: {
	sessionId: string;
	platform: TracePlatform;
	model: string;
	maxSteps: number;
	userMessage: string;
}): TurnTrace {
	const turn = new TurnTrace({ ...params, batcher: getDefaultBatcher() });
	activeTurn = turn;
	activeStep = 0;
	return turn;
}

/** Marks the step the active turn is on (used by out-of-band calls such as vision). */
export function setActiveTurnStep(turn: TurnTrace, step: number): void {
	if (activeTurn === turn) activeStep = step;
}

export function clearActiveTurn(turn: TurnTrace): void {
	if (activeTurn === turn) activeTurn = null;
}

/** Trace context of the turn currently running, if any (for /api/ai/vision). */
export function getActiveTraceContext(): TraceContext | undefined {
	return activeTurn?.context(activeStep);
}

/** Turns whose edits are sitting in the AI Preview, awaiting Accept/Reject. */
const previewTraceIds: string[] = [];

export function notePreviewTrace(traceId: string): void {
	if (!isValidTraceId(traceId)) return;
	if (!previewTraceIds.includes(traceId)) previewTraceIds.push(traceId);
}

export function pendingPreviewTraceIds(): readonly string[] {
	return previewTraceIds;
}

/**
 * Scores `preview_accepted` (1 accept / 0 reject) on every turn that fed the
 * current AI Preview, then forgets them.
 */
export function recordPreviewDecision(
	accepted: boolean,
	batcher: BatcherLike | null = getDefaultBatcher(),
): void {
	const ids = previewTraceIds.splice(0, previewTraceIds.length);
	if (!batcher || ids.length === 0) return;
	for (const traceId of ids) {
		batcher.enqueue({
			type: "score",
			traceId,
			name: "preview_accepted",
			value: accepted ? 1 : 0,
			comment: accepted
				? "User accepted AI Preview"
				: "User rejected AI Preview",
		});
	}
	void batcher.flush();
}
