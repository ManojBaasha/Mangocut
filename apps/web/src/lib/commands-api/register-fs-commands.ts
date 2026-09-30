import { z } from "zod";
import type { EditorCore } from "@/core";
import { registerCommand } from "@/lib/commands-api/registry";
import { getDesktopApi } from "@/lib/ai/desktop";
import { processMediaAssets } from "@/lib/media/processing";
import { TICKS_PER_SECOND } from "@/lib/wasm";
import { buildElementFromMedia } from "@/lib/timeline/element-utils";
import { DEFAULT_NEW_ELEMENT_DURATION } from "@/lib/timeline/creation";

function requireDesktop() {
	const api = getDesktopApi();
	if (!api?.ai) {
		throw new Error("Filesystem tools require Mangocut desktop");
	}
	return api.ai;
}

export function registerFsCommands({ editor }: { editor: EditorCore }): void {
	registerCommand({
		definition: {
			name: "list_dir",
			description: "List files and folders at an absolute path on the local machine",
			category: "fs",
			argsSchema: z.object({ path: z.string().min(1) }),
			exposeToAgent: true,
		},
		handler: async ({ path }) => requireDesktop().listDir({ path }),
	});

	registerCommand({
		definition: {
			name: "glob_media",
			description:
				"Find video/audio/image files under a folder (absolute path)",
			category: "fs",
			argsSchema: z.object({
				path: z.string().min(1),
				recursive: z.boolean().optional(),
			}),
			exposeToAgent: true,
		},
		handler: async ({ path, recursive }) =>
			requireDesktop().globMedia({ path, recursive }),
	});

	registerCommand({
		definition: {
			name: "stat_path",
			description: "Get size and type for a local path",
			category: "fs",
			argsSchema: z.object({ path: z.string().min(1) }),
			exposeToAgent: true,
		},
		handler: async ({ path }) => requireDesktop().stat({ path }),
	});

	registerCommand({
		definition: {
			name: "pick_folder",
			description: "Open a native folder picker and return the chosen path",
			category: "fs",
			argsSchema: z.object({}),
			exposeToAgent: true,
		},
		handler: async () => requireDesktop().pickFolder(),
	});

	registerCommand({
		definition: {
			name: "import_media_paths",
			description:
				"Import local media files into the project (and optionally place on timeline). Uses AI Preview when target is shadow.",
			category: "media",
			argsSchema: z.object({
				paths: z.array(z.string()).min(1),
				placeOnTimeline: z.boolean().optional(),
			}),
			exposeToAgent: true,
		},
		handler: async ({ paths, placeOnTimeline }, ctx) => {
			const ai = requireDesktop();
			const project = editor.project.getActive();
			const { files: payloads } = await ai.importPaths({ paths });

			const fileList = payloads.map(
				(item) =>
					new File([item.buffer], item.name, {
						type: guessMime(item.name),
					}),
			);

			const processed = await processMediaAssets({ files: fileList });
			const createdIds: string[] = [];

			const run = async () => {
				let cursor = editor.timeline.getTotalDuration();
				for (const asset of processed) {
					const created = await editor.media.addMediaAsset({
						projectId: project.metadata.id,
						asset,
					});
					if (!created) continue;
					createdIds.push(created.id);

					if (placeOnTimeline !== false) {
						const duration =
							created.duration != null
								? Math.round(created.duration * TICKS_PER_SECOND)
								: DEFAULT_NEW_ELEMENT_DURATION;
						const element = buildElementFromMedia({
							mediaId: created.id,
							mediaType: created.type,
							name: created.name,
							duration,
							startTime: cursor,
						});
						editor.timeline.insertElement({
							element,
							placement: { mode: "auto" },
						});
						cursor += duration;
					}
				}
			};

			if (ctx.target === "shadow") {
				await editor.shadow.runOnShadow(run);
			} else {
				await run();
			}

			return { ok: true, assetIds: createdIds, count: createdIds.length };
		},
	});
}

function guessMime(name: string): string {
	const ext = name.split(".").pop()?.toLowerCase();
	switch (ext) {
		case "mp4":
		case "m4v":
			return "video/mp4";
		case "mov":
			return "video/quicktime";
		case "webm":
			return "video/webm";
		case "mp3":
			return "audio/mpeg";
		case "wav":
			return "audio/wav";
		case "png":
			return "image/png";
		case "jpg":
		case "jpeg":
			return "image/jpeg";
		case "webp":
			return "image/webp";
		default:
			return "application/octet-stream";
	}
}
