import { type NextRequest, NextResponse } from "next/server";
import { assertAiEntitled } from "@/lib/ai/entitlements";
import { isGoogleAuthConfigured } from "@/lib/auth/server";
import { aiCorsPreflight, applyAiCors } from "@/lib/ai/ai-cors";

export async function OPTIONS(request: NextRequest) {
	return aiCorsPreflight({ request });
}

export async function GET(request: NextRequest) {
	const entitlement = await assertAiEntitled({ request });
	return applyAiCors({
		request,
		response: NextResponse.json({
			ok: entitlement.ok,
			remaining: entitlement.remaining,
			limit: entitlement.limit,
			spentUsd: entitlement.spentUsd,
			spendLimitUsd: entitlement.spendLimitUsd,
			trialExhausted: entitlement.trialExhausted,
			authenticated: entitlement.authenticated,
			googleConfigured: isGoogleAuthConfigured,
			error: entitlement.error,
		}),
	});
}
