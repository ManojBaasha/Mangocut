import { describe, expect, test } from "bun:test";
import { signAiBearer, verifyAiBearer } from "../ai-bearer";

describe("ai bearer", () => {
	test("signs and verifies", () => {
		const token = signAiBearer({
			userId: "u1",
			email: "a@x.com",
			secret: "test-secret",
		});
		expect(verifyAiBearer({ token, secret: "test-secret" })).toEqual({
			userId: "u1",
			email: "a@x.com",
			exp: expect.any(Number),
		});
	});

	test("rejects expired and bad signature", () => {
		const token = signAiBearer({
			userId: "u1",
			email: "a@x.com",
			secret: "test-secret",
			expiresInSeconds: 1,
		});
		expect(
			verifyAiBearer({
				token,
				secret: "test-secret",
				nowSeconds: Math.floor(Date.now() / 1000) + 10,
			}),
		).toBeNull();
		expect(verifyAiBearer({ token, secret: "other" })).toBeNull();
	});
});
