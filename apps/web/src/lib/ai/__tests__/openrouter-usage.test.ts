import { describe, expect, test } from "bun:test";
import { parseOpenRouterUsage } from "../openrouter-usage";

describe("parseOpenRouterUsage", () => {
	test("reads cost and tokens from OpenRouter usage", () => {
		expect(
			parseOpenRouterUsage({
				data: {
					usage: {
						prompt_tokens: 10,
						completion_tokens: 5,
						total_tokens: 15,
						cost: 0.0012,
					},
				},
			}),
		).toEqual({
			promptTokens: 10,
			completionTokens: 5,
			totalTokens: 15,
			costUsd: 0.0012,
		});
	});

	test("returns zeros when usage is missing", () => {
		expect(parseOpenRouterUsage({ data: {} })).toEqual({
			promptTokens: 0,
			completionTokens: 0,
			totalTokens: 0,
			costUsd: 0,
		});
	});
});
