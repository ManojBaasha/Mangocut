import { z } from "zod";
import type { EditorCore } from "@/core";
import { registerCommand } from "@/lib/commands-api/registry";
import { searchMediaAssets } from "@/lib/ai/memory/search-media";
import { captureAssetFrames } from "@/lib/ai/vision/capture";
import { describeCapturedFrames } from "@/lib/ai/vision/describe";
import { TICKS_PER_SECOND } from "@/lib/timeline";
import type { TimelineElement } from "@/lib/timeline";

function withTarget<T>(
	editor: EditorCore,
	target: "final" | "shadow",
	fn: () => T,
): T {
	if (target === "shadow") {
		return editor.shadow.runOnShadow(fn);
	}
	return fn();
}

function findElementAtTime({
	elements,
	timeSeconds,
}: {
	elements: TimelineElement[];
	timeSeconds: number;
}): TimelineElement | null {
	const t = timeSeconds * TICKS_PER_SECOND;
	for (const element of elements) {
		const start = element.startTime;
		const end = start + element.duration;
		if (t >= start && t < end) return element;
	}
	return null;
}

export function registerMemoryCommands({ editor }: { editor: EditorCore }): void {
	registerCommand({
		definition: {
			name: "search_media",
			description:
				"Search project media by meaning using name, vision memory, transcript text, and tags. Prefer this before place_media when the user describes content instead of a filename.",
			category: "media",
			argsSchema: z.object({
				query: z.string().min(1),
				limit: z.number().int().min(1).max(20).optional(),
			}),
			exposeToAgent: true,
		},
		handler: ({ query, limit }) => {
			const hits = searchMediaAssets({
				assets: editor.media.getAssets(),
				query,
				limit,
			});
			return { ok: true, query, count: hits.length, hits };
		},
	});

	registerCommand({
		definition: {
			name: "get_timeline_overview",
			description:
				"Compact timeline overview: duration, playhead, track/element counts, bookmarks. Prefer before get_timeline_detail.",
			category: "timeline",
			argsSchema: z.object({}),
			exposeToAgent: true,
		},
		handler: (_args, ctx) =>
			withTarget(editor, ctx.target, () => {
				const scene = editor.scenes.getActiveSceneOrNull();
				const tracks = scene?.tracks;
				const count = (els: TimelineElement[]) => els.length;
				const overlayCount =
					tracks?.overlay.reduce((n, t) => n + count(t.elements), 0) ?? 0;
				const audioCount =
					tracks?.audio.reduce((n, t) => n + count(t.elements), 0) ?? 0;
				return {
					ok: true,
					sceneId: scene?.id ?? null,
					durationSeconds: editor.timeline.getTotalDuration() / TICKS_PER_SECOND,
					currentTimeSeconds: editor.playback.getCurrentTime() / TICKS_PER_SECOND,
					viewMode: editor.shadow.getViewMode(),
					hasShadow: editor.shadow.hasShadow(),
					diverged: editor.shadow.isFinalDiverged(),
					mainElements: tracks ? count(tracks.main.elements) : 0,
					overlayElements: overlayCount,
					audioElements: audioCount,
				};
			}),
	});

	registerCommand({
		definition: {
			name: "get_timeline_detail",
			description:
				"Drill into timeline elements. Optionally filter by elementId or a time window in seconds.",
			category: "timeline",
			argsSchema: z.object({
				elementId: z.string().optional(),
				windowStartSeconds: z.number().optional(),
				windowEndSeconds: z.number().optional(),
			}),
			exposeToAgent: true,
		},
		handler: ({ elementId, windowStartSeconds, windowEndSeconds }, ctx) =>
			withTarget(editor, ctx.target, () => {
				const scene = editor.scenes.getActiveSceneOrNull();
				if (!scene) return { ok: false, reason: "No active scene" };
				const all: Array<TimelineElement & { trackKind: string; trackId: string }> =
					[];
				const push = (
					trackKind: string,
					trackId: string,
					elements: TimelineElement[],
				) => {
					for (const el of elements) {
						all.push({ ...el, trackKind, trackId });
					}
				};
				push("main", scene.tracks.main.id, scene.tracks.main.elements);
				for (const t of scene.tracks.overlay) push("overlay", t.id, t.elements);
				for (const t of scene.tracks.audio) push("audio", t.id, t.elements);

				let filtered = all;
				if (elementId) {
					filtered = filtered.filter((el) => el.id === elementId);
				}
				if (windowStartSeconds != null || windowEndSeconds != null) {
					const w0 = (windowStartSeconds ?? 0) * TICKS_PER_SECOND;
					const w1 =
						(windowEndSeconds ?? Number.POSITIVE_INFINITY) * TICKS_PER_SECOND;
					filtered = filtered.filter((el) => {
						const start = el.startTime;
						const end = start + el.duration;
						return end > w0 && start < w1;
					});
				}

				return {
					ok: true,
					count: filtered.length,
					elements: filtered.map((el) => ({
						id: el.id,
						name: el.name,
						type: el.type,
						trackKind: el.trackKind,
						trackId: el.trackId,
						startTimeSeconds: el.startTime / TICKS_PER_SECOND,
						durationSeconds: el.duration / TICKS_PER_SECOND,
						mediaId: "mediaId" in el ? el.mediaId : undefined,
						text: "text" in el ? el.text : undefined,
					})),
				};
			}),
	});

	registerCommand({
		definition: {
			name: "inspect_playhead",
			description:
				"Capture and optionally vision-describe the frame under the playhead (or timeSeconds) for visual QA. Does not persist unless persist=true.",
			category: "media",
			argsSchema: z.object({
				timeSeconds: z.number().optional(),
				runVision: z.boolean().optional(),
				persist: z.boolean().optional(),
				prompt: z.string().optional(),
			}),
			exposeToAgent: true,
		},
		handler: async (
			{ timeSeconds, runVision = true, persist = false, prompt },
			ctx,
		) => {
			return withTarget(editor, ctx.target, async () => {
				const scene = editor.scenes.getActiveSceneOrNull();
				if (!scene) return { ok: false, reason: "No active scene" };
				const t =
					timeSeconds ?? editor.playback.getCurrentTime() / TICKS_PER_SECOND;
				const candidates = [
					...scene.tracks.main.elements,
					...scene.tracks.overlay.flatMap((tr) => tr.elements),
				];
				const el = findElementAtTime({ elements: candidates, timeSeconds: t });
				if (!el || !("mediaId" in el) || !el.mediaId) {
					return {
						ok: false,
						reason: "No media element under playhead",
						timeSeconds: t,
					};
				}
				const asset = editor.media.getAsset({ id: el.mediaId });
				if (!asset) {
					return { ok: false, reason: `Unknown media ${el.mediaId}` };
				}
				const sourceOffset =
					"trimStart" in el && typeof el.trimStart === "number"
						? el.trimStart / TICKS_PER_SECOND
						: 0;
				const localTime = Math.max(
					0,
					t - el.startTime / TICKS_PER_SECOND + sourceOffset,
				);
				const frames = await captureAssetFrames({
					asset,
					timesSeconds: [localTime],
				});
				if (!runVision) {
					return {
						ok: true,
						timeSeconds: t,
						elementId: el.id,
						mediaId: asset.id,
						captured: frames.length,
					};
				}
				const { vision } = await describeCapturedFrames({
					frames,
					prompt:
						prompt ??
						"Describe this frame for edit QA: subject, framing, exposure, any black/empty frame.",
					assetName: asset.name,
				});
				if (persist) {
					const project = editor.project.getActiveOrNull();
					if (project) {
						await editor.media.updateAssetMemory({
							projectId: project.metadata.id,
							mediaId: asset.id,
							vision: {
								summary: vision.summary,
								updatedAt: new Date().toISOString(),
								frames: [
									...(asset.vision?.frames ?? []),
									...(vision.frames ?? []),
								].slice(-24),
							},
						});
					}
				}
				return {
					ok: true,
					timeSeconds: t,
					elementId: el.id,
					mediaId: asset.id,
					description: vision.summary ?? vision.frames?.[0]?.description ?? null,
					frames: vision.frames ?? [],
				};
			});
		},
	});

	registerCommand({
		definition: {
			name: "assert_edit_quality",
			description:
				"Lightweight QA checklist against the current AI Preview / timeline. Returns pass/fail per check.",
			category: "timeline",
			argsSchema: z.object({
				checks: z
					.array(z.string())
					.optional()
					.describe(
						"Optional checklist labels. Defaults to empty-timeline, zero-duration, playhead-has-media.",
					),
			}),
			exposeToAgent: true,
		},
		handler: ({ checks }, ctx) =>
			withTarget(editor, ctx.target, () => {
				const scene = editor.scenes.getActiveSceneOrNull();
				const duration = editor.timeline.getTotalDuration() / TICKS_PER_SECOND;
				const mainCount = scene?.tracks.main.elements.length ?? 0;
				const overlayCount =
					scene?.tracks.overlay.reduce((n, t) => n + t.elements.length, 0) ?? 0;
				const totalElements = mainCount + overlayCount;
				const t = editor.playback.getCurrentTime() / TICKS_PER_SECOND;
				const underPlayhead = scene
					? findElementAtTime({
							elements: [
								...scene.tracks.main.elements,
								...scene.tracks.overlay.flatMap((tr) => tr.elements),
							],
							timeSeconds: t,
						})
					: null;

				const defaults = [
					"has_elements",
					"nonzero_duration",
					"playhead_has_media",
				];
				const list = checks?.length ? checks : defaults;
				const results = list.map((check) => {
					const key = check.toLowerCase().replace(/\s+/g, "_");
					if (key.includes("empty") || key === "has_elements") {
						const pass = totalElements > 0;
						return {
							check,
							pass,
							detail: pass
								? `${totalElements} visual elements`
								: "Timeline has no visual elements",
						};
					}
					if (key.includes("duration") || key === "nonzero_duration") {
						const pass = duration > 0.05;
						return {
							check,
							pass,
							detail: pass
								? `duration ${duration.toFixed(2)}s`
								: "Timeline duration is near zero",
						};
					}
					if (key.includes("playhead")) {
						const pass = Boolean(underPlayhead);
						return {
							check,
							pass,
							detail: pass
								? `playhead on ${underPlayhead?.name ?? underPlayhead?.id}`
								: "No media under playhead",
						};
					}
					return {
						check,
						pass: true,
						detail: "No automated rule; treat as informational",
					};
				});
				return {
					ok: true,
					passed: results.every((r) => r.pass),
					results,
				};
			}),
	});
}
