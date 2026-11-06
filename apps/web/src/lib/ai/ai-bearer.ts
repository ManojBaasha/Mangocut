import { createHmac, timingSafeEqual } from "node:crypto";

export interface AiBearerClaims {
	userId: string;
	email: string;
	exp: number;
}

function getSecret({ secret }: { secret?: string }): string {
	const resolved =
		secret ||
		process.env.BETTER_AUTH_SECRET ||
		"";
	if (!resolved.trim()) {
		if (process.env.NODE_ENV === "production") {
			throw new Error("BETTER_AUTH_SECRET is required to sign AI bearer tokens");
		}
		return "mangocut-dev-secret-change-me-in-production";
	}
	return resolved;
}

function b64url({ value }: { value: string | Buffer }): string {
	return Buffer.from(value)
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

function fromB64url({ value }: { value: string }): Buffer {
	const padded = value.replace(/-/g, "+").replace(/_/g, "/");
	const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
	return Buffer.from(padded + pad, "base64");
}

export function signAiBearer({
	userId,
	email,
	secret,
	expiresInSeconds = 60 * 60 * 24 * 7,
}: {
	userId: string;
	email: string;
	secret?: string;
	expiresInSeconds?: number;
}): string {
	const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
	const payload = b64url({
		value: JSON.stringify({ userId, email, exp } satisfies AiBearerClaims),
	});
	const sig = createHmac("sha256", getSecret({ secret }))
		.update(payload)
		.digest();
	return `${payload}.${b64url({ value: sig })}`;
}

export function verifyAiBearer({
	token,
	secret,
	nowSeconds = Math.floor(Date.now() / 1000),
}: {
	token: string;
	secret?: string;
	nowSeconds?: number;
}): AiBearerClaims | null {
	const parts = token.split(".");
	if (parts.length !== 2) return null;
	const [payload, sig] = parts;
	if (!payload || !sig) return null;
	let expected: Buffer;
	try {
		expected = createHmac("sha256", getSecret({ secret }))
			.update(payload)
			.digest();
	} catch {
		return null;
	}
	let actual: Buffer;
	try {
		actual = fromB64url({ value: sig });
	} catch {
		return null;
	}
	if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
		return null;
	}
	try {
		const claims = JSON.parse(
			fromB64url({ value: payload }).toString("utf8"),
		) as AiBearerClaims;
		if (
			typeof claims.userId !== "string" ||
			typeof claims.email !== "string" ||
			typeof claims.exp !== "number"
		) {
			return null;
		}
		if (claims.exp < nowSeconds) return null;
		return claims;
	} catch {
		return null;
	}
}
