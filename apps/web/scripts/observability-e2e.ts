/**
 * End-to-end check of agent tracing against a running local Langfuse.
 *
 *   cd apps/web && bun scripts/observability-e2e.ts [--app http://127.0.0.1:3046]
 *
 * Simulates one agent turn without the UI:
 *   - two model calls traced through the server module exactly as
 *     /api/ai/chat does, with a mocked OpenRouter response (no API key needed)
 *   - tool spans, the turn end and an Accept score sent as the renderer would:
 *     POST /api/ai/trace on a running Next server when --app is given,
 *     otherwise recorded through the server module directly
 * then polls the Langfuse public API until the trace, generations, tool span
 * and scores are visible, and prints what it found.
 *
 * Needs LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY / LANGFUSE_BASE_URL
 * (bun loads apps/web/.env.local when run from apps/web).
 */
import {
	createChatSessionId,
	createTraceId,
} from "../src/lib/ai/observability/client";
import {
	flushTracing,
	readLangfuseConfig,
	recordScore,
	recordToolSpan,
	recordTurnEnd,
	startModelCall,
} from "../src/lib/ai/observability/server";
import type { TraceEvent } from "../src/lib/ai/observability/shared";

const appArg = process.argv.indexOf("--app");
const appUrl = appArg > 0 ? process.argv[appArg + 1] : undefined;

const maybeConfig = readLangfuseConfig();
if (!maybeConfig) {
	console.error(
		"LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY / LANGFUSE_BASE_URL not set",
	);
	process.exit(2);
}
const config = maybeConfig;

const traceId = createTraceId();
const sessionId = `e2e-${createChatSessionId()}`;
const userMessage = "Trim the first 2 seconds of the intro clip";
const model = "openai/gpt-4.1-mini";
const tools = [
	{
		type: "function",
		function: {
			name: "get_timeline_overview",
			description: "Overview of tracks and clips",
			parameters: { type: "object", properties: {} },
		},
	},
	{
		type: "function",
		function: {
			name: "trim_element",
			description: "Trim a clip",
			parameters: {
				type: "object",
				properties: {
					elementId: { type: "string" },
					startSeconds: { type: "number" },
				},
			},
		},
	},
];

/** Stand-in for OpenRouter chat/completions (same response shape). */
function mockOpenRouter(step: number) {
	return step === 0
		? {
				id: `gen-e2e-${step}`,
				model,
				usage: {
					prompt_tokens: 812,
					completion_tokens: 41,
					total_tokens: 853,
					cost: 0.00041,
				},
				message: {
					role: "assistant",
					content: null,
					tool_calls: [
						{
							id: "call_overview",
							type: "function",
							function: { name: "get_timeline_overview", arguments: "{}" },
						},
						{
							id: "call_trim",
							type: "function",
							function: {
								name: "trim_element",
								arguments: '{"elementId":"intro","startSeconds":2}',
							},
						},
					],
				},
			}
		: {
				id: `gen-e2e-${step}`,
				model,
				usage: {
					prompt_tokens: 990,
					completion_tokens: 18,
					total_tokens: 1008,
					cost: 0.00045,
				},
				message: {
					role: "assistant",
					content: "Trimmed 2s from the intro in the AI Preview.",
				},
			};
}

const started = Date.now();
const messages: Array<{ role: string; content: unknown }> = [
	{ role: "system", content: "You are Mangocut AI..." },
	{ role: "user", content: userMessage },
];
for (const step of [0, 1]) {
	const call = startModelCall({
		trace: { traceId, sessionId, step, platform: "desktop" },
		userId: "e2e-device",
		model,
		messages,
		tools,
		modelParameters: { max_tokens: 4096 },
	});
	const response = mockOpenRouter(step);
	await new Promise((r) => setTimeout(r, 30));
	call.finish({
		output: response.message,
		usage: response.usage,
		responseId: response.id,
		responseModel: response.model,
		statusCode: 200,
	});
	messages.push(response.message);
}

const t0 = started + 50;
const events: TraceEvent[] = [
	{
		type: "tool",
		traceId,
		sessionId,
		platform: "desktop",
		step: 0,
		toolCallId: "call_overview",
		name: "get_timeline_overview",
		target: "shadow",
		args: {},
		result: { tracks: [{ id: "main", clips: ["intro", "body"] }] },
		status: "ok",
		startTime: t0,
		endTime: t0 + 12,
	},
	{
		type: "tool",
		traceId,
		sessionId,
		platform: "desktop",
		step: 0,
		toolCallId: "call_trim",
		name: "trim_element",
		target: "shadow",
		args: { elementId: "intro", startSeconds: 2 },
		result: { ok: true },
		status: "ok",
		startTime: t0 + 15,
		endTime: t0 + 40,
	},
	{
		type: "turn_end",
		traceId,
		sessionId,
		platform: "desktop",
		model,
		maxSteps: 24,
		input: userMessage,
		output: "Trimmed 2s from the intro in the AI Preview.",
		status: "completed",
		steps: 2,
		toolCount: 2,
		startTime: started,
		endTime: Date.now(),
	},
	{
		type: "score",
		traceId,
		name: "preview_accepted",
		value: 1,
		comment: "e2e accept",
	},
];

if (appUrl) {
	const res = await fetch(`${appUrl}/api/ai/trace`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-mangocut-device-id": "e2e-device",
		},
		body: JSON.stringify({ events }),
	});
	console.log(
		`POST ${appUrl}/api/ai/trace -> ${res.status} (x-mangocut-tracing: ${res.headers.get("x-mangocut-tracing") ?? "-"})`,
	);
	if (res.status !== 204 || res.headers.get("x-mangocut-tracing") === "off") {
		console.error(await res.text());
		process.exit(1);
	}
} else {
	for (const event of events) {
		if (event.type === "tool") recordToolSpan(event, "e2e-device");
		else if (event.type === "turn_end") recordTurnEnd(event, "e2e-device");
		else recordScore(event);
	}
}
await flushTracing(10_000);

const auth = `Basic ${Buffer.from(`${config.publicKey}:${config.secretKey}`).toString("base64")}`;
async function api(path: string) {
	const res = await fetch(`${config.baseUrl}${path}`, {
		headers: { Authorization: auth },
	});
	if (!res.ok) throw new Error(`${path} -> ${res.status}: ${await res.text()}`);
	return res.json() as Promise<{ data: Array<Record<string, unknown>> }>;
}

type Found = {
	observations: Array<Record<string, unknown>>;
	scores: Array<Record<string, unknown>>;
};
async function poll(): Promise<Found> {
	const deadline = Date.now() + 120_000;
	let last: Found = { observations: [], scores: [] };
	while (Date.now() < deadline) {
		const [obs, scores] = await Promise.all([
			api(
				`/api/public/v2/observations?traceId=${traceId}&fields=core,basic,io,metadata,model,usage,trace_context&limit=100`,
			),
			api(
				`/api/public/v3/scores?traceId=${traceId}&fields=core,details&limit=50`,
			),
		]);
		last = { observations: obs.data, scores: scores.data };
		const names = new Set(last.observations.map((o) => o.name));
		const scoreNames = new Set(last.scores.map((s) => s.name));
		if (
			names.has("agent-turn") &&
			names.has("model-call") &&
			names.has("tool:trim_element") &&
			scoreNames.has("turn_completed") &&
			scoreNames.has("preview_accepted")
		) {
			return last;
		}
		await new Promise((r) => setTimeout(r, 3000));
	}
	return last;
}

const found = await poll();
console.log(`\ntraceId=${traceId} sessionId=${sessionId}`);
console.log(
	`UI: http://localhost:3100/project/mangocut-agent/traces/${traceId}`,
);
console.log("\nobservations:");
for (const o of found.observations.sort((a, b) =>
	String(a.startTime).localeCompare(String(b.startTime)),
)) {
	console.log(
		`  ${String(o.type).padEnd(10)} ${String(o.name).padEnd(28)} parent=${o.parentObservationId ?? "-"} root=${o.isRootObservation ?? "-"} traceName=${o.traceName ?? "-"} session=${o.sessionId ?? "-"} user=${o.userId ?? "-"}${o.model ? ` model=${o.model}` : ""}${o.usageDetails ? ` usage=${JSON.stringify(o.usageDetails)}` : ""}${o.totalCost ? ` cost=${o.totalCost}` : ""}`,
	);
}
console.log("\nscores:");
for (const s of found.scores) {
	console.log(`  ${s.name} = ${s.value} (${s.comment ?? ""})`);
}

const names = new Set(found.observations.map((o) => o.name));
const scoreNames = new Set(found.scores.map((s) => s.name));
const checks = {
	trace_root_agent_turn: names.has("agent-turn"),
	generation_model_call: found.observations.some(
		(o) => o.name === "model-call" && String(o.type) === "GENERATION",
	),
	tool_span:
		names.has("tool:trim_element") && names.has("tool:get_timeline_overview"),
	score_turn_completed: scoreNames.has("turn_completed"),
	score_preview_accepted: scoreNames.has("preview_accepted"),
};
console.log("\nchecks:", checks);
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
