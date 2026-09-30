/**
 * Better Auth entrypoint for the CLI (`bunx auth migrate|info|check`).
 * App code should import from `@/lib/auth/server` or `@/lib/auth/client`.
 */
export { auth, isGoogleAuthConfigured, isBetterAuthInfraConfigured } from "./auth/server";
export { authClient } from "./auth/client";
