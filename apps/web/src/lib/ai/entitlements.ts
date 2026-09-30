import { auth, isGoogleAuthConfigured } from "@/lib/auth/server";
import {
	getAiUsageTurns,
	incrementAiUsageTurns,
} from "@/lib/ai/usage-store";

export interface AiEntitlement {
	ok: boolean;
	status: number;
	error?: string;
	key: string;
	remaining: number;
	limit: number;
	authenticated: boolean;
	googleConfigured: boolean;
}

function trialLimit(): number {
	const raw = Number(process.env.AI_TRIAL_CHAT_TURNS ?? "50");
	return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 50;
}

function requireAuth(): boolean {
	return process.env.AI_REQUIRE_AUTH === "true";
}

function deviceKeyFromRequest({ request }: { request: Request }): string {
	const header =
		request.headers.get("x-mangocut-device-id") ||
		request.headers.get("x-device-id") ||
		"";
	const cleaned = header.trim().slice(0, 128);
	if (cleaned) return `anon:${cleaned}`;
	const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
	return `anon:${forwarded || "local"}`;
}

export async function resolveAiEntitlement({
	request,
}: {
	request: Request;
}): Promise<AiEntitlement> {
	const limit = trialLimit();
	const googleConfigured = isGoogleAuthConfigured;

	const session = await auth.api.getSession({ headers: request.headers });
	const userId = session?.user?.id;
	const authenticated = Boolean(userId);

	if (requireAuth() && !authenticated) {
		return {
			ok: false,
			status: 401,
			error: "Sign in required to use Mangocut AI",
			key: "unauthenticated",
			remaining: 0,
			limit,
			authenticated: false,
			googleConfigured,
		};
	}

	const key = userId ? `user:${userId}` : deviceKeyFromRequest({ request });
	const used = getAiUsageTurns({ key });
	const remaining = Math.max(0, limit - used);

	if (remaining <= 0) {
		return {
			ok: false,
			status: 402,
			error: authenticated
				? "Free AI trial limit reached"
				: googleConfigured
					? "Free AI trial limit reached. Sign in with Google for your account trial."
					: "Free AI trial limit reached",
			key,
			remaining: 0,
			limit,
			authenticated,
			googleConfigured,
		};
	}

	return {
		ok: true,
		status: 200,
		key,
		remaining,
		limit,
		authenticated,
		googleConfigured,
	};
}

export async function assertAiEntitled({
	request,
}: {
	request: Request;
}): Promise<AiEntitlement> {
	return resolveAiEntitlement({ request });
}

export function consumeAiTurn({ key }: { key: string }): {
	turns: number;
	remaining: number;
	limit: number;
} {
	const limit = trialLimit();
	const turns = incrementAiUsageTurns({ key });
	return { turns, remaining: Math.max(0, limit - turns), limit };
}
