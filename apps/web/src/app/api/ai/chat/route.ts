import { after, type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rate-limit";
import { consumeAiTurn } from "@/lib/ai/entitlements";
import { traceContextSchema } from "@/lib/ai/observability/shared";
import {
	flushTracing,
	isTracingEnabled,
	startModelCall,
	traceUserIdFromKey,
	type OpenRouterUsage,
} from "@/lib/ai/observability/server";
import { parseOpenRouterUsage } from "@/lib/ai/openrouter-usage";
import { aiCorsPreflight, applyAiCors } from "@/lib/ai/ai-cors";

function json(
	request: NextRequest,
	body: unknown,
	init?: { status?: number },
) {
	return applyAiCors({
		request,
		response: NextResponse.json(body, init),
	});
}

export async function OPTIONS(request: NextRequest) {
	return aiCorsPreflight({ request });
}

const bodySchema = z.object({
	model: z.string().min(1).max(200).default("openai/gpt-4.1-mini"),
	messages: z.array(
		z.object({
			role: z.enum(["system", "user", "assistant", "tool"]),
			content: z.string().nullable().optional(),
			tool_call_id: z.string().optional(),
			tool_calls: z.array(z.unknown()).optional(),
		}),
	),
	tools: z.array(z.unknown()).optional(),
	/** Agent-turn correlation for Langfuse; ignored when tracing is off. */
	trace: traceContextSchema.optional(),
});

export async function POST(request: NextRequest) {
	const limited = await checkRateLimit({ request });
	if (limited.limited) {
		return json(request, 
			{
				error: limited.error || "Rate limit exceeded",
				remaining: limited.remaining,
				limit: limited.limit,
				authenticated: limited.authenticated,
				googleConfigured: limited.googleConfigured,
			},
			{ status: limited.status || 429 },
		);
	}

	const apiKey = process.env.OPENROUTER_API_KEY;
	if (!apiKey) {
		return json(request, 
			{ error: "OPENROUTER_API_KEY is not configured on the server" },
			{ status: 503 },
		);
	}

	let body: z.infer<typeof bodySchema>;
	try {
		body = bodySchema.parse(await request.json());
	} catch (error) {
		return json(request, 
			{
				error: "Invalid request",
				details: error instanceof Error ? error.message : String(error),
			},
			{ status: 400 },
		);
	}

	const allowedModels = (process.env.OPENROUTER_ALLOWED_MODELS || "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	if (allowedModels.length > 0 && !allowedModels.includes(body.model)) {
		return json(request, { error: "Model not allowed" }, { status: 400 });
	}

	const tracing = isTracingEnabled();
	const modelCall = startModelCall({
		trace: body.trace,
		userId: traceUserIdFromKey(limited.key),
		model: body.model,
		messages: body.messages,
		tools: body.tools,
		modelParameters: { max_tokens: 4096 },
	});
	if (tracing && body.trace) {
		after(() => flushTracing());
	}

	try {
		const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
				"HTTP-Referer":
					process.env.NEXT_PUBLIC_SITE_URL || "https://mangocut.jonam.dev",
				"X-Title": "Mangocut",
			},
			body: JSON.stringify({
				model: body.model,
				messages: body.messages,
				tools: body.tools?.length ? body.tools : undefined,
				tool_choice: body.tools?.length ? "auto" : undefined,
				usage: { include: true },
				max_tokens: 4096,
			}),
		});

		const data = (await res.json()) as {
			id?: string;
			model?: string;
			usage?: OpenRouterUsage;
			error?: { message?: string };
			choices?: Array<{ message: unknown }>;
		};

		if (!res.ok) {
			modelCall.finish({
				error: data.error?.message || "OpenRouter request failed",
				statusCode: res.status,
				responseId: data.id,
			});
			return json(request, 
				{ error: data.error?.message || "OpenRouter request failed" },
				{ status: res.status },
			);
		}

		const message = data.choices?.[0]?.message;
		modelCall.finish({
			output: message,
			usage: data.usage,
			responseId: data.id,
			responseModel: data.model,
			statusCode: res.status,
			error: message ? undefined : "Empty model response",
		});
		if (!message) {
			return json(request, 
				{ error: "Empty model response" },
				{ status: 502 },
			);
		}

		const openRouterUsage = parseOpenRouterUsage({ data });
		const usage = consumeAiTurn({
			key: limited.key,
			costUsd: openRouterUsage.costUsd,
		});
		return json(request, {
			message,
			usage: openRouterUsage,
			entitlement: {
				remaining: usage.remaining,
				limit: usage.limit,
				spentUsd: usage.spentUsd,
				spendLimitUsd: usage.spendLimitUsd,
				trialExhausted: usage.trialExhausted,
			},
		});
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "OpenRouter request failed";
		modelCall.finish({ error: message, statusCode: 502 });
		return json(request, { error: message }, { status: 502 });
	}
}
