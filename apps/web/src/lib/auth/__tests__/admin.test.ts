import { describe, expect, test, afterEach } from "bun:test";
import { getAdminEmail, isAdminEmail } from "../admin";

describe("admin gate", () => {
	const prev = process.env.MANGOCUT_ADMIN_EMAIL;
	afterEach(() => {
		if (prev === undefined) delete process.env.MANGOCUT_ADMIN_EMAIL;
		else process.env.MANGOCUT_ADMIN_EMAIL = prev;
	});

	test("default admin email", () => {
		delete process.env.MANGOCUT_ADMIN_EMAIL;
		expect(getAdminEmail()).toBe("manoj.elango123@gmail.com");
	});

	test("isAdminEmail is case-insensitive and trims", () => {
		delete process.env.MANGOCUT_ADMIN_EMAIL;
		expect(isAdminEmail({ email: "  Manoj.Elango123@Gmail.com " })).toBe(true);
		expect(isAdminEmail({ email: "other@example.com" })).toBe(false);
		expect(isAdminEmail({ email: null })).toBe(false);
		expect(isAdminEmail({ email: undefined })).toBe(false);
	});
});
