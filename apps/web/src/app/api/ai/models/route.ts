import { type NextRequest, NextResponse } from "next/server";
import { assertAiEntitled } from "@/lib/ai/entitlements";

export async function GET(request: NextRequest) {
	const entitlement = await assertAiEntitled({ request });
	if (!entitlement.ok && process.env.AI_REQUIRE_AUTH === "true") {
		return NextResponse.json(
			{
				error: entitlement.error,
				models: [],
				hasKey: Boolean(process.env.OPENROUTER_API_KEY),
				remaining: entitlement.remaining,
				limit: entitlement.limit,
			},
			{ status: entitlement.status },
		);
	}

	const configured = (process.env.OPENROUTER_ALLOWED_MODELS || "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);

	const models =
		configured.length > 0
			? configured
			: [
					"openai/gpt-4.1-mini",
					"openai/gpt-4.1",
					"anthropic/claude-sonnet-4",
					"google/gemini-2.5-flash",
				];

	return NextResponse.json({
		models,
		hasKey: Boolean(process.env.OPENROUTER_API_KEY),
		remaining: entitlement.remaining,
		limit: entitlement.limit,
		authenticated: entitlement.authenticated,
		googleConfigured: entitlement.googleConfigured,
	});
}
