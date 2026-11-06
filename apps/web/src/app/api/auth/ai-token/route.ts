import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { signAiBearer } from "@/lib/ai/ai-bearer";
import { applyAiCors, aiCorsPreflight } from "@/lib/ai/ai-cors";

export async function OPTIONS(request: NextRequest) {
	return aiCorsPreflight({ request });
}

export async function GET(request: NextRequest) {
	const session = await auth.api.getSession({ headers: request.headers });
	if (!session?.user?.id || !session.user.email) {
		return applyAiCors({
			request,
			response: NextResponse.json({ error: "Sign in required" }, { status: 401 }),
		});
	}

	const expiresInSeconds = 60 * 60 * 24 * 7;
	const token = signAiBearer({
		userId: session.user.id,
		email: session.user.email,
		expiresInSeconds,
	});
	return applyAiCors({
		request,
		response: NextResponse.json({
			token,
			expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
		}),
	});
}
