export interface OpenRouterUsage {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	/** OpenRouter reports this in USD (credits ≈ USD). */
	costUsd: number;
}

export function parseOpenRouterUsage({
	data,
}: {
	data: unknown;
}): OpenRouterUsage {
	const empty: OpenRouterUsage = {
		promptTokens: 0,
		completionTokens: 0,
		totalTokens: 0,
		costUsd: 0,
	};
	if (!data || typeof data !== "object") return empty;
	const usage = (data as { usage?: Record<string, unknown> }).usage;
	if (!usage || typeof usage !== "object") return empty;

	const promptTokens = numberOrZero(usage.prompt_tokens);
	const completionTokens = numberOrZero(usage.completion_tokens);
	const totalTokens =
		numberOrZero(usage.total_tokens) || promptTokens + completionTokens;
	const costUsd = numberOrZero(usage.cost);

	return { promptTokens, completionTokens, totalTokens, costUsd };
}

function numberOrZero(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
