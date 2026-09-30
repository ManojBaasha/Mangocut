import { assertAiEntitled } from "@/lib/ai/entitlements";

/** @deprecated Prefer assertAiEntitled — kept as thin wrapper for existing call sites. */
export async function checkRateLimit({ request }: { request: Request }) {
	const entitlement = await assertAiEntitled({ request });
	return {
		success: entitlement.ok,
		limited: !entitlement.ok,
		status: entitlement.status,
		error: entitlement.error,
		remaining: entitlement.remaining,
		limit: entitlement.limit,
		authenticated: entitlement.authenticated,
		googleConfigured: entitlement.googleConfigured,
		key: entitlement.key,
	};
}
