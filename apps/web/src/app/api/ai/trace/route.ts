import { after, type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import {
	MAX_TRACE_BODY_BYTES,
	TRACING_DISABLED_HEADER,
	traceBatchSchema,
} from "@/lib/ai/observability/shared";
import {
	flushTracing,
	isTracingEnabled,
	recordScore,
	recordToolSpan,
	recordTurnEnd,
} from "@/lib/ai/observability/server";

/**
 * Receives renderer-side agent trace events (tool spans, turn ends, Accept/
 * Reject scores) and records them under the turn's Langfuse trace.
 *
 * Not entitlement-gated on purpose: it must not consume AI trial turns. When
 * tracing is not configured it answers 204 + `x-mangocut-tracing: off` without
 * reading the body, and the renderer stops sending.
 */
export async function POST(request: NextRequest) {
	if (!isTracingEnabled()) {
		return new NextResponse(null, {
			status: 204,
			headers: { [TRACING_DISABLED_HEADER]: "off" },
		});
	}

	const declared = Number(request.headers.get("content-length") ?? "0");
	if (declared > MAX_TRACE_BODY_BYTES) {
		return NextResponse.json({ error: "Payload too large" }, { status: 413 });
	}

	let text: string;
	try {
		text = await request.text();
	} catch {
		return NextResponse.json({ error: "Unreadable body" }, { status: 400 });
	}
	if (text.length > MAX_TRACE_BODY_BYTES) {
		return NextResponse.json({ error: "Payload too large" }, { status: 413 });
	}

	const parsed = (() => {
		try {
			return traceBatchSchema.safeParse(JSON.parse(text));
		} catch {
			return null;
		}
	})();
	if (!parsed?.success) {
		return NextResponse.json(
			{
				error: "Invalid trace batch",
				details: parsed?.error?.message ?? "Body is not JSON",
			},
			{ status: 400 },
		);
	}

	const userId = await resolveTraceUserId(request);
	for (const event of parsed.data.events) {
		if (event.type === "tool") recordToolSpan(event, userId);
		else if (event.type === "turn_end") recordTurnEnd(event, userId);
		else recordScore(event);
	}
	after(() => flushTracing());

	return new NextResponse(null, { status: 204 });
}

/** Signed-in user id when there is a session, else the device id header. */
async function resolveTraceUserId(
	request: NextRequest,
): Promise<string | undefined> {
	try {
		const session = await auth.api.getSession({ headers: request.headers });
		if (session?.user?.id) return session.user.id;
	} catch {
		// fall through to the device id
	}
	const device = request.headers.get("x-mangocut-device-id")?.trim();
	return device ? device.slice(0, 200) : undefined;
}
