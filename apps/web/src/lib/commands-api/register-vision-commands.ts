import { z } from "zod";
import type { EditorCore } from "@/core";
import { registerCommand } from "@/lib/commands-api/registry";
import { captureAssetFrames } from "@/lib/ai/vision/capture";
import { applyVisionMerge, describeCapturedFrames } from "@/lib/ai/vision/describe";
import { normalizeFrameTimes } from "@/lib/ai/vision/merge";
import { deriveMediaTags } from "@/lib/ai/memory/tags";

export function registerVisionCommands({ editor }: { editor: EditorCore }): void {
	registerCommand({
		definition: {
			name: "get_media_vision",
			description:
				"Read stored AI vision memory (summary + frame descriptions) for a project media asset",
			category: "media",
			argsSchema: z.object({ mediaId: z.string().min(1) }),
			exposeToAgent: true,
		},
		handler: ({ mediaId }) => {
			const asset = editor.media.getAsset({ id: mediaId });
			if (!asset) {
				return { ok: false, reason: `Unknown mediaId ${mediaId}` };
			}
			return {
				ok: true,
				mediaId,
				name: asset.name,
				vision: asset.vision ?? null,
			};
		},
	});

	registerCommand({
		definition: {
			name: "describe_media",
			description:
				"Capture frames from a project media asset, run vision describe, and persist memory on the asset. Prefer get_media_vision first if descriptions already exist.",
			category: "media",
			argsSchema: z.object({
				mediaId: z.string().min(1),
				timesSeconds: z.array(z.number()).optional(),
				prompt: z.string().optional(),
				model: z.string().optional(),
			}),
			exposeToAgent: true,
		},
		handler: async ({ mediaId, timesSeconds, prompt, model }) => {
			const asset = editor.media.getAsset({ id: mediaId });
			if (!asset) {
				return { ok: false, reason: `Unknown mediaId ${mediaId}` };
			}
			if (asset.type === "audio") {
				return { ok: false, reason: "Cannot describe audio with vision" };
			}

			const project = editor.project.getActiveOrNull();
			if (!project) {
				return { ok: false, reason: "No active project" };
			}

			const times = normalizeFrameTimes({
				timesSeconds,
				durationSeconds: asset.duration,
			});
			const frames = await captureAssetFrames({ asset, timesSeconds: times });
			const { vision: described } = await describeCapturedFrames({
				frames,
				prompt,
				model,
				assetName: asset.name,
			});
			const merged = applyVisionMerge({
				existing: asset.vision,
				incoming: described,
			});
			const tags = deriveMediaTags({
				name: asset.name,
				visionSummary: merged.summary,
				transcriptText: asset.transcript?.segments.map((s) => s.text).join(" "),
			});
			const saved = await editor.media.updateAssetMemory({
				projectId: project.metadata.id,
				mediaId,
				vision: merged,
				tags,
			});
			if (!saved) {
				return { ok: false, reason: "Failed to persist vision memory" };
			}
			return {
				ok: true,
				mediaId,
				name: asset.name,
				vision: merged,
				tags,
				frameCount: frames.length,
			};
		},
	});
}
