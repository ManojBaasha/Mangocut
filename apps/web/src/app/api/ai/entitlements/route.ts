import { type NextRequest, NextResponse } from "next/server";
import { assertAiEntitled } from "@/lib/ai/entitlements";
import { isGoogleAuthConfigured } from "@/lib/auth/server";

export async function GET(request: NextRequest) {
	const entitlement = await assertAiEntitled({ request });
	return NextResponse.json({
		ok: entitlement.ok,
		remaining: entitlement.remaining,
		limit: entitlement.limit,
		authenticated: entitlement.authenticated,
		googleConfigured: isGoogleAuthConfigured,
		error: entitlement.error,
	});
}
