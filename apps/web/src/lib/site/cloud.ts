function normalizeOrigin({ raw }: { raw: string }): string | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	try {
		return new URL(trimmed).origin;
	} catch {
		return null;
	}
}

/** Hosted Mangocut origin for AI + auth, or null for local-only mode. */
export function getCloudOrigin(): string | null {
	const fromPublic = process.env.NEXT_PUBLIC_MANGOCUT_CLOUD_ORIGIN;
	if (typeof fromPublic === "string" && fromPublic.trim()) {
		return normalizeOrigin({ raw: fromPublic });
	}
	const fromServer = process.env.MANGOCUT_CLOUD_ORIGIN;
	if (typeof fromServer === "string" && fromServer.trim()) {
		return normalizeOrigin({ raw: fromServer });
	}
	return null;
}

export function isCloudAiMode(): boolean {
	return getCloudOrigin() !== null;
}

/** Absolute AI API origin, or empty string for same-origin relative fetches. */
export function getAiApiBaseUrl(): string {
	return getCloudOrigin() ?? "";
}
