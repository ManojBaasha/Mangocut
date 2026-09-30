const STORAGE_KEY = "mangocut-device-id";

function randomId(): string {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}
	return `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function getOrCreateDeviceId(): string {
	if (typeof window === "undefined") return "server";
	try {
		const existing = window.localStorage.getItem(STORAGE_KEY);
		if (existing) return existing;
		const next = randomId();
		window.localStorage.setItem(STORAGE_KEY, next);
		return next;
	} catch {
		return randomId();
	}
}

export function aiRequestHeaders(): HeadersInit {
	return {
		"Content-Type": "application/json",
		"x-mangocut-device-id": getOrCreateDeviceId(),
	};
}
