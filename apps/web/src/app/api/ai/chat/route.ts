import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rate-limit";
import { consumeAiTurn } from "@/lib/ai/entitlements";

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
});

export async function POST(request: NextRequest) {
	const limited = await checkRateLimit({ request });
	if (limited.limited) {
		return NextResponse.json(
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
		return NextResponse.json(
			{ error: "OPENROUTER_API_KEY is not configured on the server" },
			{ status: 503 },
		);
	}

	let body: z.infer<typeof bodySchema>;
	try {
		body = bodySchema.parse(await request.json());
	} catch (error) {
		return NextResponse.json(
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
		return NextResponse.json({ error: "Model not allowed" }, { status: 400 });
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
				max_tokens: 4096,
			}),
		});

		const data = (await res.json()) as {
			error?: { message?: string };
			choices?: Array<{ message: unknown }>;
		};

		if (!res.ok) {
			return NextResponse.json(
				{ error: data.error?.message || "OpenRouter request failed" },
				{ status: res.status },
			);
		}

		const message = data.choices?.[0]?.message;
		if (!message) {
			return NextResponse.json(
				{ error: "Empty model response" },
				{ status: 502 },
			);
		}

		const usage = consumeAiTurn({ key: limited.key });
		return NextResponse.json({
			message,
			entitlement: {
				remaining: usage.remaining,
				limit: usage.limit,
			},
		});
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "OpenRouter request failed";
		return NextResponse.json({ error: message }, { status: 502 });
	}
}
