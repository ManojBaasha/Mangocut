import { z } from "zod";

const isDesktop = process.env.MANGOCUT_DESKTOP === "1";

const webEnvSchema = z.object({
	NODE_ENV: z.enum(["development", "production", "test"]),
	ANALYZE: z.string().optional(),
	NEXT_RUNTIME: z.enum(["nodejs", "edge"]).optional(),
	MANGOCUT_DESKTOP: z.string().optional(),

	NEXT_PUBLIC_SITE_URL: z.url().default("http://localhost:3000"),

	// Optional cloud sounds search — empty disables the Freesound API.
	FREESOUND_CLIENT_ID: z.string().default(""),
	FREESOUND_API_KEY: z.string().default(""),

	/** Server-only OpenRouter key for Mangocut AI proxy. */
	OPENROUTER_API_KEY: z.string().default(""),
	OPENROUTER_ALLOWED_MODELS: z.string().default(""),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

export const webEnv = webEnvSchema.parse({
	...process.env,
	// Desktop builds inject these; keep parse resilient when unset in tests.
	NODE_ENV: process.env.NODE_ENV ?? "development",
	MANGOCUT_DESKTOP: process.env.MANGOCUT_DESKTOP,
	...(isDesktop
		? {
				FREESOUND_CLIENT_ID: process.env.FREESOUND_CLIENT_ID ?? "",
				FREESOUND_API_KEY: process.env.FREESOUND_API_KEY ?? "",
			}
		: {}),
});
