import { z } from "zod";
import type { EditorCore } from "@/core";
import { registerCommand } from "@/lib/commands-api/registry";
import {
	DEFAULT_TRANSCRIPTION_MODEL,
	TRANSCRIPTION_MODELS,
} from "@/lib/transcription/models";
import type { TranscriptionModelId } from "@/lib/transcription/types";
import { DEFAULT_TRANSCRIPTION_SAMPLE_RATE } from "@/lib/transcription/audio";
import { transcriptionService } from "@/services/transcription/service";
import { decodeAudioToFloat32 } from "@/lib/media/audio";
import { buildCaptionChunks } from "@/lib/transcription/caption";
import { insertCaptionChunksAsTextTrack } from "@/lib/subtitles/insert";
import { TICKS_PER_SECOND } from "@/lib/wasm";
import { getElementsAtTime } from "@/lib/timeline";
import {
	buildDeleteRanges,
	buildKeepRanges,
	buildSilenceCutPoints,
	mediaTimeToTimelineTime,
} from "@/lib/ai/speech/speech-ranges";
import { deriveMediaTags } from "@/lib/ai/memory/tags";
import { findFillerRanges } from "@/lib/ai/speech/filler";
import { rankHighlights } from "@/lib/ai/speech/highlights";
import { buildElementFromMedia } from "@/lib/timeline/element-utils";
import type { TimelineElement } from "@/lib/timeline";

function isMediaElement(
	element: TimelineElement,
): element is TimelineElement & { mediaId: string; trimStart: number } {
	return "mediaId" in element && typeof element.mediaId === "string";
}

function listTimelineElements({
	editor,
}: {
	editor: EditorCore;
}): Array<{ trackId: string; element: TimelineElement }> {
	const tracks = editor.scenes.getActiveScene().tracks;
	const out: Array<{ trackId: string; element: TimelineElement }> = [];
	for (const element of tracks.main.elements) {
		out.push({ trackId: tracks.main.id, element });
	}
	for (const track of tracks.overlay) {
		for (const element of track.elements) {
			out.push({ trackId: track.id, element });
		}
	}
	for (const track of tracks.audio) {
		for (const element of track.elements) {
			out.push({ trackId: track.id, element });
		}
	}
	return out;
}

async function ensureTranscript({
	editor,
	mediaId,
	modelId,
	force,
}: {
	editor: EditorCore;
	mediaId: string;
	modelId?: TranscriptionModelId;
	force?: boolean;
}) {
	const asset = editor.media.getAsset({ id: mediaId });
	if (!asset) {
		throw new Error(`Unknown mediaId ${mediaId}`);
	}
	const project = editor.project.getActiveOrNull();
	if (!project) {
		throw new Error("No active project");
	}

	const resolvedModel = modelId ?? DEFAULT_TRANSCRIPTION_MODEL;
	if (
		!force &&
		asset.transcript?.segments?.length &&
		(!modelId || asset.transcript.modelId === resolvedModel)
	) {
		return {
			asset,
			projectId: project.metadata.id,
			segments: asset.transcript.segments.map((s) => ({
				start: s.start,
				end: s.end,
				text: s.text,
			})),
			modelId: asset.transcript.modelId as TranscriptionModelId,
			cached: true,
		};
	}

	const { samples } = await decodeAudioToFloat32({
		audioBlob: asset.file,
		sampleRate: DEFAULT_TRANSCRIPTION_SAMPLE_RATE,
	});
	const result = await transcriptionService.transcribe({
		audioData: samples,
		modelId: resolvedModel,
	});
	const segments = result.segments.map((s) => ({
		start: s.start,
		end: s.end,
		text: s.text,
	}));
	const transcript = {
		modelId: resolvedModel,
		segments,
		updatedAt: new Date().toISOString(),
	};
	await editor.media.updateAssetMemory({
		projectId: project.metadata.id,
		mediaId,
		transcript,
		tags: deriveMediaTags({
			name: asset.name,
			visionSummary: asset.vision?.summary,
			transcriptText: segments.map((s) => s.text).join(" "),
		}),
	});
	return {
		asset,
		projectId: project.metadata.id,
		segments,
		modelId: resolvedModel,
		cached: false,
	};
}

export function registerTranscriptionCommands({
	editor,
}: {
	editor: EditorCore;
}): void {
	registerCommand({
		definition: {
			name: "list_transcription_models",
			description: "List available local Whisper transcription models",
			category: "media",
			argsSchema: z.object({}),
			exposeToAgent: true,
		},
		handler: () => ({
			ok: true,
			defaultModelId: DEFAULT_TRANSCRIPTION_MODEL,
			models: TRANSCRIPTION_MODELS.map((m) => ({
				id: m.id,
				name: m.name,
				description: m.description,
			})),
		}),
	});

	registerCommand({
		definition: {
			name: "transcribe_media",
			description:
				"Run Whisper on a project media asset and persist the transcript on the asset",
			category: "media",
			argsSchema: z.object({
				mediaId: z.string().min(1),
				modelId: z
					.enum([
						"whisper-tiny",
						"whisper-small",
						"whisper-medium",
						"whisper-large-v3-turbo",
					])
					.optional(),
				force: z.boolean().optional(),
			}),
			exposeToAgent: true,
		},
		handler: async ({ mediaId, modelId, force }) => {
			const result = await ensureTranscript({
				editor,
				mediaId,
				modelId,
				force,
			});
			return {
				ok: true,
				mediaId,
				modelId: result.modelId,
				cached: result.cached,
				segmentCount: result.segments.length,
				segments: result.segments,
			};
		},
	});

	registerCommand({
		definition: {
			name: "insert_captions",
			description:
				"Insert caption text elements on the AI Preview from a media transcript (transcribes first if needed)",
			category: "media",
			argsSchema: z.object({
				mediaId: z.string().min(1),
				modelId: z
					.enum([
						"whisper-tiny",
						"whisper-small",
						"whisper-medium",
						"whisper-large-v3-turbo",
					])
					.optional(),
			}),
			exposeToAgent: true,
		},
		handler: async ({ mediaId, modelId }, ctx) => {
			const run = async () => {
				const { segments } = await ensureTranscript({
					editor,
					mediaId,
					modelId,
				});
				const captions = buildCaptionChunks({ segments });
				const trackId = insertCaptionChunksAsTextTrack({
					editor,
					captions,
				});
				if (!trackId) {
					return { ok: false, reason: "No captions generated" };
				}
				return {
					ok: true,
					trackId,
					captionCount: captions.length,
				};
			};
			if (ctx.target === "shadow") {
				return editor.shadow.runOnShadow(run);
			}
			return run();
		},
	});

	registerCommand({
		definition: {
			name: "cut_on_speech",
			description:
				"Split or trim timeline clips using Whisper speech segments. keep_speech deletes silence; split_on_gaps only splits at long gaps. Runs on AI Preview when target is shadow.",
			category: "editing",
			argsSchema: z.object({
				mediaId: z.string().optional(),
				elementId: z.string().optional(),
				mode: z.enum(["keep_speech", "split_on_gaps"]).default("keep_speech"),
				minGapSeconds: z.number().min(0).optional(),
				modelId: z
					.enum([
						"whisper-tiny",
						"whisper-small",
						"whisper-medium",
						"whisper-large-v3-turbo",
					])
					.optional(),
			}),
			exposeToAgent: true,
		},
		handler: async (
			{ mediaId, elementId, mode, minGapSeconds, modelId },
			ctx,
		) => {
			const run = async () => {
				const items = listTimelineElements({ editor });
				let targets = items.filter(({ element }) => isMediaElement(element));
				if (elementId) {
					targets = targets.filter(({ element }) => element.id === elementId);
				}
				if (mediaId) {
					targets = targets.filter(
						({ element }) =>
							isMediaElement(element) && element.mediaId === mediaId,
					);
				}
				if (targets.length === 0) {
					return {
						ok: false,
						reason:
							"No matching timeline media elements. Place the clip first, or pass mediaId/elementId.",
					};
				}

				const resolvedMediaId =
					mediaId ??
					(isMediaElement(targets[0].element)
						? targets[0].element.mediaId
						: null);
				if (!resolvedMediaId) {
					return { ok: false, reason: "Could not resolve mediaId" };
				}

				const { segments } = await ensureTranscript({
					editor,
					mediaId: resolvedMediaId,
					modelId,
				});
				const gap = minGapSeconds ?? (mode === "keep_speech" ? 0.35 : 0.75);
				const asset = editor.media.getAsset({ id: resolvedMediaId });
				const mediaDuration =
					asset?.duration ??
					Math.max(...segments.map((s) => s.end), 0);

				let splitCount = 0;
				let deletedCount = 0;

				if (mode === "split_on_gaps") {
					const cuts = buildSilenceCutPoints({
						segments,
						minGapSeconds: gap,
						mediaDurationSeconds: mediaDuration,
					});
					for (const { element } of targets) {
						if (!isMediaElement(element)) continue;
						const trimStartSeconds = element.trimStart / TICKS_PER_SECOND;
						const startSeconds = element.startTime / TICKS_PER_SECOND;
						for (const mediaCut of cuts) {
							if (mediaCut < trimStartSeconds) continue;
							const timelineSeconds = mediaTimeToTimelineTime({
								mediaTimeSeconds: mediaCut,
								elementStartSeconds: startSeconds,
								trimStartSeconds,
							});
							const time = Math.round(timelineSeconds * TICKS_PER_SECOND);
							const at = getElementsAtTime({
								tracks: editor.scenes.getActiveScene().tracks,
								time,
							}).filter((el) => el.elementId === element.id);
							if (at.length === 0) continue;
							editor.timeline.splitElements({
								elements: at,
								splitTime: time,
							});
							splitCount += 1;
						}
					}
					return { ok: true, mode, splitCount, deletedCount, cuts };
				}

				const keep = buildKeepRanges({ segments, minGapSeconds: gap });
				const deletes = buildDeleteRanges({
					keepRanges: keep,
					mediaDurationSeconds: mediaDuration,
				});

				for (const { element } of targets) {
					if (!isMediaElement(element)) continue;
					const trimStartSeconds = element.trimStart / TICKS_PER_SECOND;
					const startSeconds = element.startTime / TICKS_PER_SECOND;
					const elementEndMedia =
						trimStartSeconds + element.duration / TICKS_PER_SECOND;

					for (const del of deletes) {
						if (del.end <= trimStartSeconds || del.start >= elementEndMedia) {
							continue;
						}
						const cutStarts = [del.start, del.end].filter(
							(t) => t > trimStartSeconds && t < elementEndMedia,
						);
						for (const mediaCut of cutStarts) {
							const timelineSeconds = mediaTimeToTimelineTime({
								mediaTimeSeconds: mediaCut,
								elementStartSeconds: startSeconds,
								trimStartSeconds,
							});
							const time = Math.round(timelineSeconds * TICKS_PER_SECOND);
							const candidates = getElementsAtTime({
								tracks: editor.scenes.getActiveScene().tracks,
								time,
							});
							const match = candidates.filter((el) => {
								const found = listTimelineElements({ editor }).find(
									(row) => row.element.id === el.elementId,
								);
								return (
									found &&
									isMediaElement(found.element) &&
									found.element.mediaId === resolvedMediaId
								);
							});
							if (match.length === 0) continue;
							editor.timeline.splitElements({
								elements: match,
								splitTime: time,
							});
							splitCount += 1;
						}
					}
				}

				// Delete pieces whose midpoint media time falls in a delete range
				const after = listTimelineElements({ editor }).filter(
					({ element }) =>
						isMediaElement(element) && element.mediaId === resolvedMediaId,
				);
				const toDelete: Array<{ trackId: string; elementId: string }> = [];
				for (const { trackId, element } of after) {
					if (!isMediaElement(element)) continue;
					const trimStartSeconds = element.trimStart / TICKS_PER_SECOND;
					const midMedia =
						trimStartSeconds + element.duration / TICKS_PER_SECOND / 2;
					if (
						deletes.some((d) => midMedia >= d.start && midMedia <= d.end)
					) {
						toDelete.push({ trackId, elementId: element.id });
					}
				}
				if (toDelete.length > 0) {
					editor.timeline.deleteElements({ elements: toDelete });
					deletedCount = toDelete.length;
				}

				return {
					ok: true,
					mode,
					splitCount,
					deletedCount,
					keepRanges: keep,
				};
			};

			if (ctx.target === "shadow") {
				return editor.shadow.runOnShadow(run);
			}
			return run();
		},
	});

	registerCommand({
		definition: {
			name: "get_transcript",
			description:
				"Return persisted (or freshly transcribed) speech segments for a media asset",
			category: "media",
			argsSchema: z.object({
				mediaId: z.string().min(1),
				force: z.boolean().optional(),
			}),
			exposeToAgent: true,
		},
		handler: async ({ mediaId, force }) => {
			const result = await ensureTranscript({ editor, mediaId, force });
			return {
				ok: true,
				mediaId,
				modelId: result.modelId,
				cached: result.cached,
				segments: result.segments,
			};
		},
	});

	registerCommand({
		definition: {
			name: "delete_transcript_ranges",
			description:
				"Delete media regions matching transcript time ranges on timeline elements (AI Preview when shadow). Times are media-source seconds.",
			category: "editing",
			argsSchema: z.object({
				mediaId: z.string().min(1),
				ranges: z
					.array(
						z.object({
							start: z.number(),
							end: z.number(),
						}),
					)
					.min(1),
				elementId: z.string().optional(),
			}),
			exposeToAgent: true,
		},
		handler: async ({ mediaId, ranges, elementId }, ctx) => {
			const run = async () => {
				const deletes = ranges
					.filter((r) => r.end > r.start)
					.map((r) => ({ start: r.start, end: r.end }));
				return applyMediaDeleteRanges({
					editor,
					mediaId,
					elementId,
					deletes,
				});
			};
			if (ctx.target === "shadow") return editor.shadow.runOnShadow(run);
			return run();
		},
	});

	registerCommand({
		definition: {
			name: "remove_filler_words",
			description:
				"Detect um/uh/like filler segments via transcript and delete those ranges on the timeline (shadow).",
			category: "editing",
			argsSchema: z.object({
				mediaId: z.string().min(1),
				elementId: z.string().optional(),
			}),
			exposeToAgent: true,
		},
		handler: async ({ mediaId, elementId }, ctx) => {
			const run = async () => {
				const { segments } = await ensureTranscript({ editor, mediaId });
				const fillers = findFillerRanges({ segments });
				if (fillers.length === 0) {
					return { ok: true, deletedCount: 0, fillers: [] };
				}
				const result = await applyMediaDeleteRanges({
					editor,
					mediaId,
					elementId,
					deletes: fillers.map((f) => ({ start: f.start, end: f.end })),
				});
				return { ...result, fillers };
			};
			if (ctx.target === "shadow") return editor.shadow.runOnShadow(run);
			return run();
		},
	});

	registerCommand({
		definition: {
			name: "find_highlights",
			description:
				"Rank highlight windows from a media transcript for Shorts/reels packaging",
			category: "media",
			argsSchema: z.object({
				mediaId: z.string().min(1),
				maxClips: z.number().int().min(1).max(12).optional(),
				targetSeconds: z.number().min(5).max(120).optional(),
			}),
			exposeToAgent: true,
		},
		handler: async ({ mediaId, maxClips, targetSeconds }) => {
			const { segments } = await ensureTranscript({ editor, mediaId });
			const highlights = rankHighlights({
				segments,
				maxClips,
				targetSeconds,
			});
			return { ok: true, mediaId, count: highlights.length, highlights };
		},
	});

	registerCommand({
		definition: {
			name: "package_highlights",
			description:
				"Place ranked highlight windows from a media asset onto the AI Preview timeline sequentially",
			category: "editing",
			argsSchema: z.object({
				mediaId: z.string().min(1),
				maxClips: z.number().int().min(1).max(12).optional(),
				targetSeconds: z.number().min(5).max(120).optional(),
				startTimeSeconds: z.number().min(0).optional(),
			}),
			exposeToAgent: true,
		},
		handler: async (
			{ mediaId, maxClips, targetSeconds, startTimeSeconds },
			ctx,
		) => {
			const run = async () => {
				const asset = editor.media.getAsset({ id: mediaId });
				if (!asset) return { ok: false, reason: `Unknown media ${mediaId}` };
				const { segments } = await ensureTranscript({ editor, mediaId });
				const highlights = rankHighlights({
					segments,
					maxClips,
					targetSeconds,
				});
				if (highlights.length === 0) {
					return { ok: false, reason: "No highlights found" };
				}
				let cursor =
					startTimeSeconds !== undefined
						? startTimeSeconds
						: editor.timeline.getTotalDuration() / TICKS_PER_SECOND;
				const placed: Array<{ start: number; end: number; quote: string }> =
					[];
				for (const hit of highlights) {
					const durationTicks = Math.round(
						(hit.end - hit.start) * TICKS_PER_SECOND,
					);
					const startTicks = Math.round(cursor * TICKS_PER_SECOND);
					const trimStart = Math.round(hit.start * TICKS_PER_SECOND);
					const element = buildElementFromMedia({
						mediaId: asset.id,
						mediaType: asset.type,
						name: `${asset.name} highlight`,
						duration: durationTicks,
						startTime: startTicks,
					});
					if ("trimStart" in element) {
						(element as { trimStart: number }).trimStart = trimStart;
					}
					editor.timeline.insertElement({
						element,
						placement: { mode: "auto" },
					});
					placed.push(hit);
					cursor += hit.end - hit.start;
				}
				return {
					ok: true,
					placedCount: placed.length,
					placed,
					note: "Consider 9:16 export for Shorts; project aspect is unchanged.",
				};
			};
			if (ctx.target === "shadow") return editor.shadow.runOnShadow(run);
			return run();
		},
	});
}

async function applyMediaDeleteRanges({
	editor,
	mediaId,
	elementId,
	deletes,
}: {
	editor: EditorCore;
	mediaId: string;
	elementId?: string;
	deletes: Array<{ start: number; end: number }>;
}): Promise<{
	ok: boolean;
	splitCount: number;
	deletedCount: number;
	reason?: string;
}> {
	let targets = listTimelineElements({ editor }).filter(
		({ element }) => isMediaElement(element) && element.mediaId === mediaId,
	);
	if (elementId) {
		targets = targets.filter(({ element }) => element.id === elementId);
	}
	if (targets.length === 0) {
		return {
			ok: false,
			splitCount: 0,
			deletedCount: 0,
			reason: "No matching timeline elements for mediaId",
		};
	}

	let splitCount = 0;
	for (const { element } of targets) {
		if (!isMediaElement(element)) continue;
		const trimStartSeconds = element.trimStart / TICKS_PER_SECOND;
		const startSeconds = element.startTime / TICKS_PER_SECOND;
		const elementEndMedia =
			trimStartSeconds + element.duration / TICKS_PER_SECOND;
		for (const del of deletes) {
			if (del.end <= trimStartSeconds || del.start >= elementEndMedia) continue;
			for (const mediaCut of [del.start, del.end]) {
				if (mediaCut <= trimStartSeconds || mediaCut >= elementEndMedia) {
					continue;
				}
				const timelineSeconds = mediaTimeToTimelineTime({
					mediaTimeSeconds: mediaCut,
					elementStartSeconds: startSeconds,
					trimStartSeconds,
				});
				const time = Math.round(timelineSeconds * TICKS_PER_SECOND);
				const candidates = getElementsAtTime({
					tracks: editor.scenes.getActiveScene().tracks,
					time,
				}).filter((el) => el.elementId === element.id);
				if (candidates.length === 0) continue;
				editor.timeline.splitElements({
					elements: candidates,
					splitTime: time,
				});
				splitCount += 1;
			}
		}
	}

	const after = listTimelineElements({ editor }).filter(
		({ element }) => isMediaElement(element) && element.mediaId === mediaId,
	);
	const toDelete: Array<{ trackId: string; elementId: string }> = [];
	for (const { trackId, element } of after) {
		if (!isMediaElement(element)) continue;
		const trimStartSeconds = element.trimStart / TICKS_PER_SECOND;
		const midMedia = trimStartSeconds + element.duration / TICKS_PER_SECOND / 2;
		if (deletes.some((d) => midMedia >= d.start && midMedia <= d.end)) {
			toDelete.push({ trackId, elementId: element.id });
		}
	}
	if (toDelete.length > 0) {
		editor.timeline.deleteElements({ elements: toDelete });
	}
	return { ok: true, splitCount, deletedCount: toDelete.length };
}
