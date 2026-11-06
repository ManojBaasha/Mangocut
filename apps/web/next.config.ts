import { existsSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// Trace (and resolve hoisted workspace deps like `next`) from the repo root
// whenever it is present: local/Electron builds, and Vercel with "Include
// source files outside of the Root Directory" on (required: apps/web depends
// on file:../../rust/wasm/stub and the build compiles rust/). Only when the
// upload holds apps/web alone (repo root absent) fall back to apps/web, as
// pointing outside the upload root doubles /vercel/path0.
const repoRoot = path.join(__dirname, "../..");
const tracingRoot = existsSync(path.join(repoRoot, "turbo.json"))
	? repoRoot
	: __dirname;

const nextConfig: NextConfig = {
	compiler: {
		removeConsole: process.env.NODE_ENV === "production",
	},
	reactStrictMode: true,
	productionBrowserSourceMaps: true,
	output: "standalone",
	outputFileTracingRoot: tracingRoot,
	turbopack: {
		root: tracingRoot,
	},
	images: {
		remotePatterns: [
			{
				protocol: "https",
				hostname: "plus.unsplash.com",
			},
			{
				protocol: "https",
				hostname: "images.unsplash.com",
			},
			{
				protocol: "https",
				hostname: "lh3.googleusercontent.com",
			},
			{
				protocol: "https",
				hostname: "avatars.githubusercontent.com",
			},
			{
				protocol: "https",
				hostname: "api.iconify.design",
			},
		],
	},
};

export default nextConfig;
