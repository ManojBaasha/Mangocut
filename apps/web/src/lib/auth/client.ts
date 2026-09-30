import { createAuthClient } from "better-auth/react";
import { dashClient } from "@better-auth/infra/client";

const infraEnabled = Boolean(
	typeof process !== "undefined" && process.env.NEXT_PUBLIC_BETTER_AUTH_INFRA !== "0",
);

export const authClient = createAuthClient({
	baseURL:
		typeof window !== "undefined"
			? window.location.origin
			: process.env.NEXT_PUBLIC_SITE_URL || "http://127.0.0.1:3045",
	plugins: infraEnabled ? [dashClient()] : [],
});
