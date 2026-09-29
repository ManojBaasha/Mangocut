const { cpSync, existsSync, rmSync } = require("node:fs");
const path = require("node:path");

/**
 * electron-builder excludes node_modules from extraResources by default.
 * Force-copy the prepared Next standalone tree (including node_modules) after pack.
 */
exports.default = async function afterPack(context) {
	const electronRoot = path.join(__dirname, "..");
	const source = path.join(electronRoot, "resources/next");
	if (!existsSync(source)) {
		throw new Error(`Missing ${source}; run prepare:standalone first`);
	}

	const appName = context.packager.appInfo.productFilename;
	const resourcesDir =
		context.electronPlatformName === "darwin"
			? path.join(context.appOutDir, `${appName}.app`, "Contents", "Resources")
			: path.join(context.appOutDir, "resources");

	const dest = path.join(resourcesDir, "next");
	rmSync(dest, { recursive: true, force: true });
	cpSync(source, dest, { recursive: true });
	console.log(`afterPack: copied Next standalone to ${dest}`);
};
