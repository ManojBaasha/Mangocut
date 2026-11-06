import { describe, expect, test, afterEach } from "bun:test";
import {
	getAiApiBaseUrl,
	getCloudOrigin,
	isCloudAiMode,
} from "../cloud";

describe("cloud origin", () => {
	const prevPublic = process.env.NEXT_PUBLIC_MANGOCUT_CLOUD_ORIGIN;
	const prevServer = process.env.MANGOCUT_CLOUD_ORIGIN;

	afterEach(() => {
		if (prevPublic === undefined) {
			delete process.env.NEXT_PUBLIC_MANGOCUT_CLOUD_ORIGIN;
		} else {
			process.env.NEXT_PUBLIC_MANGOCUT_CLOUD_ORIGIN = prevPublic;
		}
		if (prevServer === undefined) {
			delete process.env.MANGOCUT_CLOUD_ORIGIN;
		} else {
			process.env.MANGOCUT_CLOUD_ORIGIN = prevServer;
		}
	});

	test("null when unset", () => {
		delete process.env.MANGOCUT_CLOUD_ORIGIN;
		delete process.env.NEXT_PUBLIC_MANGOCUT_CLOUD_ORIGIN;
		expect(getCloudOrigin()).toBeNull();
		expect(isCloudAiMode()).toBe(false);
		expect(getAiApiBaseUrl()).toBe("");
	});

	test("strips trailing slash; prefers NEXT_PUBLIC", () => {
		delete process.env.MANGOCUT_CLOUD_ORIGIN;
		process.env.NEXT_PUBLIC_MANGOCUT_CLOUD_ORIGIN =
			"https://mangocut.jonam.dev/";
		expect(getCloudOrigin()).toBe("https://mangocut.jonam.dev");
		expect(isCloudAiMode()).toBe(true);
		expect(getAiApiBaseUrl()).toBe("https://mangocut.jonam.dev");
	});

	test("falls back to MANGOCUT_CLOUD_ORIGIN", () => {
		delete process.env.NEXT_PUBLIC_MANGOCUT_CLOUD_ORIGIN;
		process.env.MANGOCUT_CLOUD_ORIGIN = "https://example.com";
		expect(getCloudOrigin()).toBe("https://example.com");
	});
});
