import { createAuthClient } from "better-auth/react";
import { dashClient } from "@better-auth/infra/client";
import { getCloudOrigin } from "@/lib/site/cloud";

const infraEnabled = Boolean(
	typeof process !== "undefined" && process.env.NEXT_PUBLIC_BETTER_AUTH_INFRA !== "0",
);

function authBaseURL(): string {
	const cloud = getCloudOrigin();
	if (cloud) return cloud;
	if (typeof window !== "undefined") return window.location.origin;
	return process.env.NEXT_PUBLIC_SITE_URL || "http://127.0.0.1:3045";
}

export const authClient = createAuthClient({
	baseURL: authBaseURL(),
	plugins: infraEnabled ? [dashClient()] : [],
});
