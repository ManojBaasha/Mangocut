import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { isAdminEmail } from "@/lib/auth/admin";
import { listAuthUsers } from "@/lib/auth/users";
import { buildAdminUsageReport } from "@/lib/ai/admin-usage";
import { listAllAiUsage } from "@/lib/ai/usage-store";
import { trialSpendLimitUsd } from "@/lib/ai/entitlements";

function trialTurnLimit(): number {
	const raw = Number(process.env.AI_TRIAL_CHAT_TURNS ?? "50");
	return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 50;
}

export async function GET(request: NextRequest) {
	const session = await auth.api.getSession({ headers: request.headers });
	if (!isAdminEmail({ email: session?.user?.email })) {
		return NextResponse.json({ error: "Not found" }, { status: 404 });
	}

	const turnLimit = trialTurnLimit();
	const spendLimitUsd = trialSpendLimitUsd();
	const report = buildAdminUsageReport({
		users: listAuthUsers(),
		usageByKey: listAllAiUsage(),
		turnLimit,
		spendLimitUsd,
	});

	return NextResponse.json({
		...report,
		turnLimit,
		spendLimitUsd,
	});
}
