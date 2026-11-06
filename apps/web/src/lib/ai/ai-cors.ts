const DESKTOP_ORIGINS = new Set([
	"http://127.0.0.1:3045",
	"http://localhost:3045",
	"http://127.0.0.1:47823",
	"http://localhost:47823",
]);

export function isAllowedDesktopOrigin({
	origin,
}: {
	origin: string | null | undefined;
}): boolean {
	if (!origin) return false;
	return DESKTOP_ORIGINS.has(origin);
}

function allowedOrigin({ request }: { request: Request }): string | null {
	const origin = request.headers.get("origin");
	if (!origin) return null;
	if (DESKTOP_ORIGINS.has(origin)) return origin;
	const site = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
	if (site && origin === site) return origin;
	const cloud =
		process.env.NEXT_PUBLIC_MANGOCUT_CLOUD_ORIGIN?.replace(/\/$/, "") ||
		process.env.MANGOCUT_CLOUD_ORIGIN?.replace(/\/$/, "");
	if (cloud && origin === cloud) return origin;
	return null;
}

export function aiCorsPreflight({
	request,
}: {
	request: Request;
}): Response {
	const origin = allowedOrigin({ request });
	if (!origin) {
		return new Response(null, { status: 204 });
	}
	return new Response(null, {
		status: 204,
		headers: {
			"Access-Control-Allow-Origin": origin,
			"Access-Control-Allow-Credentials": "true",
			"Access-Control-Allow-Methods": "GET,POST,OPTIONS",
			"Access-Control-Allow-Headers":
				"Content-Type, Authorization, x-mangocut-device-id, x-device-id",
			"Access-Control-Max-Age": "86400",
			Vary: "Origin",
		},
	});
}

export function applyAiCors({
	request,
	response,
}: {
	request: Request;
	response: Response;
}): Response {
	const origin = allowedOrigin({ request });
	if (!origin) return response;
	const headers = new Headers(response.headers);
	headers.set("Access-Control-Allow-Origin", origin);
	headers.set("Access-Control-Allow-Credentials", "true");
	headers.set("Vary", "Origin");
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}
