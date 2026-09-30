import path from "node:path";
import type { NextConfig } from "next";

// Local/Electron monorepo builds trace from the repo root; Vercel deploys
// only apps/web, so pointing outside the upload root doubles /vercel/path0.
const repoRoot = path.join(__dirname, "../..");
const tracingRoot = process.env.VERCEL ? __dirname : repoRoot;

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
