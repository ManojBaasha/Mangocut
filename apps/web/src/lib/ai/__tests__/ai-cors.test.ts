import { describe, expect, test } from "bun:test";
import { isAllowedDesktopOrigin } from "../ai-cors";

describe("isAllowedDesktopOrigin", () => {
	test("allows local desktop origins only", () => {
		expect(isAllowedDesktopOrigin({ origin: "http://127.0.0.1:3045" })).toBe(
			true,
		);
		expect(isAllowedDesktopOrigin({ origin: "http://localhost:3045" })).toBe(
			true,
		);
		expect(
			isAllowedDesktopOrigin({ origin: "https://evil.example" }),
		).toBe(false);
		expect(isAllowedDesktopOrigin({ origin: null })).toBe(false);
	});
});
