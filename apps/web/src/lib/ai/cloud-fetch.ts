import { getAiApiBaseUrl, isCloudAiMode } from "@/lib/site/cloud";
import { aiRequestHeaders } from "@/lib/ai/device-id";

const BEARER_STORAGE_KEY = "mangocut-ai-bearer";

export function getStoredAiBearer(): string | null {
	if (typeof window === "undefined") return null;
	try {
		return window.localStorage.getItem(BEARER_STORAGE_KEY);
	} catch {
		return null;
	}
}

export function setStoredAiBearer({ token }: { token: string }): void {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(BEARER_STORAGE_KEY, token);
}

export function clearStoredAiBearer(): void {
	if (typeof window === "undefined") return;
	window.localStorage.removeItem(BEARER_STORAGE_KEY);
}

export async function ensureAiBearerFromCloud(): Promise<string | null> {
	if (!isCloudAiMode()) return getStoredAiBearer();
	const existing = getStoredAiBearer();
	if (existing) return existing;
	const base = getAiApiBaseUrl();
	try {
		const res = await fetch(`${base}/api/auth/ai-token`, {
			credentials: "include",
			headers: aiRequestHeaders(),
		});
		if (!res.ok) return null;
		const data = (await res.json()) as { token?: string };
		if (!data.token) return null;
		setStoredAiBearer({ token: data.token });
		return data.token;
	} catch {
		return null;
	}
}

/** Open cloud bridge; redirects back to local complete URL with ?token=. */
export function openDesktopAiBridge(): void {
	const base = getAiApiBaseUrl();
	if (!base || typeof window === "undefined") return;
	const returnTo = `${window.location.origin}/auth/desktop-bridge/complete`;
	const url = `${base}/auth/desktop-bridge?return_to=${encodeURIComponent(returnTo)}`;
	window.open(url, "_blank", "noopener,noreferrer");
}

/** Fetch AI routes against cloud origin when configured. */
export async function aiFetch(
	path: string,
	init: RequestInit = {},
): Promise<Response> {
	const base = getAiApiBaseUrl();
	const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
	const headers = new Headers(init.headers);
	const defaults = aiRequestHeaders();
	for (const [key, value] of Object.entries(defaults)) {
		if (!headers.has(key)) headers.set(key, String(value));
	}
	if (isCloudAiMode()) {
		const token = await ensureAiBearerFromCloud();
		if (token && !headers.has("Authorization")) {
			headers.set("Authorization", `Bearer ${token}`);
		}
	}
	try {
		const res = await fetch(url, {
			...init,
			headers,
			credentials: "include",
		});
		if (res.status === 401 && isCloudAiMode()) {
			clearStoredAiBearer();
		}
		return res;
	} catch {
		throw new Error(
			"Can't reach the Mangocut AI service — check your connection.",
		);
	}
}
