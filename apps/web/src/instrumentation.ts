/**
 * Next.js instrumentation hook. Registers Langfuse tracing for the agent
 * (Node runtime only). Without LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY /
 * LANGFUSE_BASE_URL this does nothing, which is the production default.
 */
export async function register() {
	if (process.env.NEXT_RUNTIME !== "nodejs") return;
	if (
		!process.env.LANGFUSE_PUBLIC_KEY ||
		!process.env.LANGFUSE_SECRET_KEY ||
		!process.env.LANGFUSE_BASE_URL
	) {
		return;
	}
	const { initTracing } = await import("@/lib/ai/observability/server");
	initTracing();
}
