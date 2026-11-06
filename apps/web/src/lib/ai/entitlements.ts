import { auth, isGoogleAuthConfigured } from "@/lib/auth/server";
import {
	getAiUsageCostUsd,
	getAiUsageTurns,
	incrementAiUsageTurns,
} from "@/lib/ai/usage-store";
import { verifyAiBearer } from "@/lib/ai/ai-bearer";

export interface AiEntitlement {
	ok: boolean;
	status: number;
	error?: string;
	key: string;
	remaining: number;
	limit: number;
	spentUsd: number;
	/** null when no dollar spend cap is configured */
	spendLimitUsd: number | null;
	trialExhausted: boolean;
	authenticated: boolean;
	googleConfigured: boolean;
}

const TRIAL_EXHAUSTED_MESSAGE =
	"Free AI trial is over. Manual editing still works — AI is paused until a future release with paid plans.";

function trialTurnLimit(): number {
	const raw = Number(process.env.AI_TRIAL_CHAT_TURNS ?? "50");
	return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 50;
}

/** Optional OpenRouter spend cap in USD. Empty / unset = turns-only. */
export function trialSpendLimitUsd(): number | null {
	const raw = process.env.AI_TRIAL_SPEND_USD;
	if (raw == null || String(raw).trim() === "") return null;
	const n = Number(raw);
	return Number.isFinite(n) && n > 0 ? n : null;
}

function requireAuth(): boolean {
	// AI always requires sign-in unless explicitly disabled for local break-glass.
	return process.env.AI_REQUIRE_AUTH !== "false";
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

function bearerUserFromRequest({
	request,
}: {
	request: Request;
}): { userId: string; email: string } | null {
	const header = request.headers.get("authorization") || "";
	const match = /^Bearer\s+(.+)$/i.exec(header.trim());
	if (!match?.[1]) return null;
	const claims = verifyAiBearer({ token: match[1].trim() });
	if (!claims) return null;
	return { userId: claims.userId, email: claims.email };
}

function exhaustedEntitlement({
	key,
	limit,
	spentUsd,
	spendLimitUsd,
	authenticated,
	googleConfigured,
}: {
	key: string;
	limit: number;
	spentUsd: number;
	spendLimitUsd: number | null;
	authenticated: boolean;
	googleConfigured: boolean;
}): AiEntitlement {
	return {
		ok: false,
		status: 402,
		error: TRIAL_EXHAUSTED_MESSAGE,
		key,
		remaining: 0,
		limit,
		spentUsd,
		spendLimitUsd,
		trialExhausted: true,
		authenticated,
		googleConfigured,
	};
}

export async function resolveAiEntitlement({
	request,
}: {
	request: Request;
}): Promise<AiEntitlement> {
	const limit = trialTurnLimit();
	const spendLimitUsd = trialSpendLimitUsd();
	const googleConfigured = isGoogleAuthConfigured;

	const session = await auth.api.getSession({ headers: request.headers });
	const bearer = bearerUserFromRequest({ request });
	const userId = session?.user?.id || bearer?.userId;
	const authenticated = Boolean(userId);

	if (requireAuth() && !authenticated) {
		return {
			ok: false,
			status: 401,
			error: "Sign in with Google to start your free AI trial.",
			key: "unauthenticated",
			remaining: 0,
			limit,
			spentUsd: 0,
			spendLimitUsd,
			trialExhausted: false,
			authenticated: false,
			googleConfigured,
		};
	}

	const key = userId ? `user:${userId}` : deviceKeyFromRequest({ request });
	const used = getAiUsageTurns({ key });
	const spentUsd = getAiUsageCostUsd({ key });
	const remaining = Math.max(0, limit - used);

	if (remaining <= 0) {
		return exhaustedEntitlement({
			key,
			limit,
			spentUsd,
			spendLimitUsd,
			authenticated,
			googleConfigured,
		});
	}

	if (spendLimitUsd != null && spentUsd >= spendLimitUsd) {
		return exhaustedEntitlement({
			key,
			limit,
			spentUsd,
			spendLimitUsd,
			authenticated,
			googleConfigured,
		});
	}

	return {
		ok: true,
		status: 200,
		key,
		remaining,
		limit,
		spentUsd,
		spendLimitUsd,
		trialExhausted: false,
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

export function consumeAiTurn({
	key,
	costUsd = 0,
}: {
	key: string;
	costUsd?: number;
}): {
	turns: number;
	remaining: number;
	limit: number;
	spentUsd: number;
	spendLimitUsd: number | null;
	trialExhausted: boolean;
} {
	const limit = trialTurnLimit();
	const spendLimitUsd = trialSpendLimitUsd();
	const { turns, costUsd: spentUsd } = incrementAiUsageTurns({ key, costUsd });
	const remaining = Math.max(0, limit - turns);
	const trialExhausted =
		remaining <= 0 ||
		(spendLimitUsd != null && spentUsd >= spendLimitUsd);
	return {
		turns,
		remaining: trialExhausted ? 0 : remaining,
		limit,
		spentUsd,
		spendLimitUsd,
		trialExhausted,
	};
}
