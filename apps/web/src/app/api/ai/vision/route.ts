import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rate-limit";
import { consumeAiTurn } from "@/lib/ai/entitlements";

const MAX_IMAGES = 6;
const MAX_DATA_URL_CHARS = 1_500_000;

const contentPartSchema = z.union([
	z.object({ type: z.literal("text"), text: z.string().max(20_000) }),
	z.object({
		type: z.literal("image_url"),
		image_url: z.object({
			url: z
				.string()
				.max(MAX_DATA_URL_CHARS)
				.refine(
					(url) =>
						url.startsWith("data:image/") ||
						url.startsWith("https://") ||
						url.startsWith("http://"),
					"image_url must be a data URL or http(s) URL",
				),
		}),
	}),
]);

const bodySchema = z.object({
	model: z.string().min(1).max(200).default("google/gemini-2.5-flash"),
	messages: z
		.array(
			z.object({
				role: z.enum(["system", "user", "assistant"]),
				content: z.union([z.string().max(50_000), z.array(contentPartSchema)]),
			}),
		)
		.min(1)
		.max(20),
});

function countImages(
	messages: z.infer<typeof bodySchema>["messages"],
): number {
	let count = 0;
	for (const message of messages) {
		if (!Array.isArray(message.content)) continue;
		for (const part of message.content) {
			if (part.type === "image_url") count += 1;
		}
	}
	return count;
}

export async function POST(request: NextRequest) {
	const limited = await checkRateLimit({ request });
	if (limited.limited) {
		return NextResponse.json(
			{
				error: limited.error || "Rate limit exceeded",
				remaining: limited.remaining,
				limit: limited.limit,
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

	if (countImages(body.messages) > MAX_IMAGES) {
		return NextResponse.json(
			{ error: `Too many images (max ${MAX_IMAGES})` },
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
				max_tokens: 2048,
			}),
		});

		const data = (await res.json()) as {
			error?: { message?: string };
			choices?: Array<{ message?: { content?: string | unknown } }>;
		};

		if (!res.ok) {
			return NextResponse.json(
				{ error: data.error?.message || "OpenRouter request failed" },
				{ status: res.status },
			);
		}

		const content = data.choices?.[0]?.message?.content;
		const text =
			typeof content === "string"
				? content
				: Array.isArray(content)
					? content
							.map((part) =>
								typeof part === "object" &&
								part &&
								"text" in part &&
								typeof (part as { text: unknown }).text === "string"
									? (part as { text: string }).text
									: "",
							)
							.join("\n")
					: "";

		if (!text.trim()) {
			return NextResponse.json(
				{ error: "Empty vision model response" },
				{ status: 502 },
			);
		}

		const usage = consumeAiTurn({ key: limited.key });
		return NextResponse.json({
			text,
			entitlement: { remaining: usage.remaining, limit: usage.limit },
		});
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "OpenRouter request failed";
		return NextResponse.json({ error: message }, { status: 502 });
	}
}
