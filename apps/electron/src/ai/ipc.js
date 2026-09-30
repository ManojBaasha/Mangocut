const { ipcMain, dialog } = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const os = require("node:os");

const MEDIA_EXT = new Set([
	".mp4",
	".mov",
	".mkv",
	".webm",
	".avi",
	".m4v",
	".mp3",
	".wav",
	".aac",
	".m4a",
	".flac",
	".png",
	".jpg",
	".jpeg",
	".webp",
	".gif",
]);

function findFfmpeg() {
	const candidates = [
		process.env.FFMPEG_PATH,
		"ffmpeg",
		"/opt/homebrew/bin/ffmpeg",
		"/usr/local/bin/ffmpeg",
		"/usr/bin/ffmpeg",
	].filter(Boolean);

	for (const candidate of candidates) {
		try {
			if (candidate === "ffmpeg") {
				return "ffmpeg";
			}
			if (fs.existsSync(candidate)) {
				return candidate;
			}
		} catch {
			// continue
		}
	}
	return null;
}

function runProcess(bin, args, { cwd } = {}) {
	return new Promise((resolve) => {
		const child = spawn(bin, args, {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		child.stderr?.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		child.on("error", (error) => {
			resolve({
				ok: false,
				stdout,
				stderr: `${stderr}\n${error.message}`,
				code: null,
			});
		});
		child.on("close", (code) => {
			resolve({ ok: code === 0, stdout, stderr, code });
		});
	});
}

async function walkMedia(root, { recursive }) {
	const files = [];
	async function walk(dir, depth) {
		let entries;
		try {
			entries = await fsp.readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				if (recursive && depth < 8) {
					await walk(full, depth + 1);
				}
				continue;
			}
			if (MEDIA_EXT.has(path.extname(entry.name).toLowerCase())) {
				files.push(full);
			}
		}
	}
	await walk(root, 0);
	return files;
}

function registerAiIpc({ getMainWindow }) {
	ipcMain.handle("ai:chat", async (_event, payload) => {
		const origin =
			process.env.MANGOCUT_AI_ORIGIN ||
			process.env.MANGOCUT_DEV_URL ||
			"http://127.0.0.1:3045";
		const deviceId =
			typeof payload?.deviceId === "string" ? payload.deviceId : "electron";
		const { deviceId: _deviceId, ...body } = payload ?? {};
		const res = await fetch(`${origin}/api/ai/chat`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-mangocut-device-id": deviceId,
			},
			body: JSON.stringify(body),
		});
		const data = await res.json();
		if (!res.ok) {
			throw new Error(data.error || `Chat proxy failed (${res.status})`);
		}
		return data;
	});

	ipcMain.handle("ai:list-dir", async (_event, { path: dirPath }) => {
		const entries = await fsp.readdir(dirPath, { withFileTypes: true });
		return {
			entries: entries.map((entry) => ({
				name: entry.name,
				path: path.join(dirPath, entry.name),
				isDirectory: entry.isDirectory(),
			})),
		};
	});

	ipcMain.handle("ai:glob-media", async (_event, { path: dirPath, recursive = true }) => {
		const files = await walkMedia(dirPath, { recursive });
		return { files };
	});

	ipcMain.handle("ai:stat", async (_event, { path: target }) => {
		const st = await fsp.stat(target);
		return {
			size: st.size,
			mtimeMs: st.mtimeMs,
			isFile: st.isFile(),
			isDirectory: st.isDirectory(),
		};
	});

	ipcMain.handle("ai:pick-folder", async () => {
		const win = getMainWindow?.();
		const result = await dialog.showOpenDialog(win ?? undefined, {
			properties: ["openDirectory"],
		});
		if (result.canceled || result.filePaths.length === 0) {
			return { path: null };
		}
		return { path: result.filePaths[0] };
	});

	ipcMain.handle("ai:import-paths", async (_event, { paths }) => {
		const files = [];
		for (const filePath of paths) {
			const buf = await fsp.readFile(filePath);
			files.push({
				path: filePath,
				name: path.basename(filePath),
				buffer: buf.buffer.slice(
					buf.byteOffset,
					buf.byteOffset + buf.byteLength,
				),
			});
		}
		return { files };
	});

	ipcMain.handle("ai:ffmpeg-available", async () => {
		const bin = findFfmpeg();
		if (!bin) return { available: false, path: null };
		const probe = await runProcess(bin, ["-version"]);
		return { available: probe.ok, path: bin };
	});

	ipcMain.handle("ai:run-ffmpeg", async (_event, { args, cwd }) => {
		const bin = findFfmpeg();
		if (!bin) {
			return {
				ok: false,
				stdout: "",
				stderr: "ffmpeg not found. Install ffmpeg or set FFMPEG_PATH.",
				code: null,
			};
		}
		return runProcess(bin, args, { cwd });
	});

	ipcMain.handle("ai:extract-frames", async (_event, { inputPath, outputDir }) => {
		const bin = findFfmpeg();
		if (!bin) throw new Error("ffmpeg not found");
		await fsp.mkdir(outputDir, { recursive: true });
		const pattern = path.join(outputDir, "frame_%03d.jpg");
		// start, mid, end-ish: fps trick — extract 3 frames evenly
		const result = await runProcess(bin, [
			"-y",
			"-i",
			inputPath,
			"-vf",
			"fps=1/1000,scale=640:-1",
			"-frames:v",
			"3",
			pattern,
		]);
		if (!result.ok) {
			// fallback: three explicit seeks
			const frames = [];
			for (const [i, ss] of ["0", "1", "2"].entries()) {
				const out = path.join(outputDir, `frame_${String(i + 1).padStart(3, "0")}.jpg`);
				const one = await runProcess(bin, [
					"-y",
					"-ss",
					ss,
					"-i",
					inputPath,
					"-frames:v",
					"1",
					out,
				]);
				if (one.ok) frames.push(out);
			}
			if (frames.length === 0) {
				throw new Error(result.stderr || "Failed to extract frames");
			}
			return { frames };
		}
		const files = (await fsp.readdir(outputDir))
			.filter((name) => name.startsWith("frame_"))
			.map((name) => path.join(outputDir, name))
			.sort();
		return { frames: files };
	});

	ipcMain.handle(
		"ai:apply-grade",
		async (_event, { inputPath, outputPath, filterChain }) => {
			const bin = findFfmpeg();
			if (!bin) throw new Error("ffmpeg not found");
			await fsp.mkdir(path.dirname(outputPath), { recursive: true });
			const result = await runProcess(bin, [
				"-y",
				"-i",
				inputPath,
				"-vf",
				filterChain,
				"-c:v",
				"libx264",
				"-preset",
				"fast",
				"-crf",
				"18",
				"-c:a",
				"copy",
				outputPath,
			]);
			if (!result.ok) {
				throw new Error(result.stderr || "apply_grade failed");
			}
			return { outputPath };
		},
	);

	ipcMain.handle("ai:compile-clips", async (_event, { inputs, outputPath }) => {
		const bin = findFfmpeg();
		if (!bin) throw new Error("ffmpeg not found");
		await fsp.mkdir(path.dirname(outputPath), { recursive: true });
		const listFile = path.join(
			os.tmpdir(),
			`mangocut-concat-${Date.now()}.txt`,
		);
		const listBody = inputs
			.map((input) => `file '${input.replace(/'/g, "'\\''")}'`)
			.join("\n");
		await fsp.writeFile(listFile, listBody, "utf8");
		const result = await runProcess(bin, [
			"-y",
			"-f",
			"concat",
			"-safe",
			"0",
			"-i",
			listFile,
			"-c",
			"copy",
			outputPath,
		]);
		await fsp.unlink(listFile).catch(() => {});
		if (!result.ok) {
			throw new Error(result.stderr || "compile_clips failed");
		}
		return { outputPath };
	});

	ipcMain.handle(
		"ai:add-audio-bed",
		async (_event, { videoPath, audioPath, outputPath, fadeIn = 2, fadeOut = 3 }) => {
			const bin = findFfmpeg();
			if (!bin) throw new Error("ffmpeg not found");
			await fsp.mkdir(path.dirname(outputPath), { recursive: true });
			const result = await runProcess(bin, [
				"-y",
				"-i",
				videoPath,
				"-i",
				audioPath,
				"-filter_complex",
				`[1:a]afade=t=in:st=0:d=${fadeIn},afade=t=out:st=0:d=${fadeOut}[a]`,
				"-map",
				"0:v",
				"-map",
				"[a]",
				"-c:v",
				"copy",
				"-shortest",
				outputPath,
			]);
			if (!result.ok) {
				throw new Error(result.stderr || "add_audio_bed failed");
			}
			return { outputPath };
		},
	);
	ipcMain.handle(
		"ai:add-text-overlay",
		async (_event, { inputPath, outputPath, text, start = 0, end = 5 }) => {
			const bin = findFfmpeg();
			if (!bin) throw new Error("ffmpeg not found");
			await fsp.mkdir(path.dirname(outputPath), { recursive: true });
			const escaped = String(text).replace(/:/g, "\\:").replace(/'/g, "\\'");
			const result = await runProcess(bin, [
				"-y",
				"-i",
				inputPath,
				"-vf",
				`drawtext=text='${escaped}':fontsize=48:fontcolor=white:x=(w-text_w)/2:y=h-120:enable='between(t,${start},${end})'`,
				"-c:a",
				"copy",
				outputPath,
			]);
			if (!result.ok) {
				throw new Error(result.stderr || "add_text_overlay failed");
			}
			return { outputPath };
		},
	);
}

module.exports = { registerAiIpc, findFfmpeg };
