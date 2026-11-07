import { z } from "zod";
import type { EditorCore } from "@/core";
import { registerCommand } from "@/lib/commands-api/registry";
import { findProjectMediaAsset } from "@/lib/commands-api/place-media";
import { invokeAction } from "@/lib/actions";
import type { TAction } from "@/lib/actions/definitions";
import { TICKS_PER_SECOND } from "@/lib/wasm";
import { TimelineOpError } from "@/lib/wasm/timeline";
import { withStrictTimelineValidation } from "@/lib/commands/timeline/validation-context";
import { getElementsAtTime } from "@/lib/timeline";
import type { TimelineElement } from "@/lib/timeline";
import {
	buildElementFromMedia,
	buildTextElement,
} from "@/lib/timeline/element-utils";
import { DEFAULT_NEW_ELEMENT_DURATION } from "@/lib/timeline/creation";
import { clampRetimeRate } from "@/lib/retime/rate";
import { buildDefaultMaskInstance } from "@/lib/masks";
import { effectsRegistry } from "@/lib/effects";
import { recordPreviewDecision } from "@/lib/ai/observability/client";

const emptyArgs = z.object({});

/**
 * The agent-facing result for a timeline edit the engine rejected (typed
 * TimelineOpError code/hint, or `fallbackCode` for other failures).
 */
function editFailure(error: Error, fallbackCode: string) {
	const code = error instanceof TimelineOpError ? error.code : fallbackCode;
	const hint = error instanceof TimelineOpError ? error.hint : undefined;
	return {
		ok: false as const,
		reason: error.message,
		error: { code, message: error.message, hint },
	};
}

function withTarget(
	editor: EditorCore,
	target: "final" | "shadow",
	fn: () => unknown,
): unknown {
	if (target === "shadow") {
		return editor.shadow.runOnShadow(fn);
	}
	return fn();
}

function findElementOnTracks({
	editor,
	elementId,
}: {
	editor: EditorCore;
	elementId: string;
}): { trackId: string; element: TimelineElement } | null {
	const tracks = editor.scenes.getActiveScene().tracks;
	for (const track of [tracks.main, ...tracks.overlay, ...tracks.audio]) {
		const element = (track.elements as TimelineElement[]).find(
			(e) => e.id === elementId,
		);
		if (element) return { trackId: track.id, element };
	}
	return null;
}

/** Gaps or overlaps smaller than this are float error, not intent (~1 frame). */
const SNAP_TOLERANCE_TICKS = Math.round(0.04 * TICKS_PER_SECOND);

/**
 * Snap a requested start time to the nearest clip edge on the main track when
 * it is within a frame of it. Agents compute start times by adding durations,
 * and float error (5.499999 vs 5.5) would otherwise overlap the previous clip
 * by a tick and push the new clip onto an overlay track.
 */
function snapToMainTrackEdge({
	editor,
	time,
}: {
	editor: EditorCore;
	time: number;
}): number {
	const main = editor.scenes?.getActiveSceneOrNull?.()?.tracks.main;
	if (!main) return time;
	let best = time;
	let bestDistance = SNAP_TOLERANCE_TICKS + 1;
	for (const element of main.elements) {
		for (const edge of [element.startTime, element.startTime + element.duration]) {
			const distance = Math.abs(edge - time);
			if (distance < bestDistance) {
				best = edge;
				bestDistance = distance;
			}
		}
	}
	return best;
}

function findPlacedMedia({
	editor,
	mediaId,
	startTime,
}: {
	editor: EditorCore;
	mediaId: string;
	startTime: number;
}): { elementId: string; trackId: string; trackKind: "main" | "overlay" } | null {
	const tracks = editor.scenes?.getActiveSceneOrNull?.()?.tracks;
	if (!tracks) return null;
	const candidates: Array<{ trackKind: "main" | "overlay"; track: typeof tracks.main | (typeof tracks.overlay)[number] }> = [
		{ trackKind: "main", track: tracks.main },
		...tracks.overlay.map((track) => ({ trackKind: "overlay" as const, track })),
	];
	for (const { trackKind, track } of candidates) {
		const element = (track.elements as TimelineElement[]).find(
			(e) =>
				"mediaId" in e &&
				e.mediaId === mediaId &&
				Math.abs(e.startTime - startTime) <= SNAP_TOLERANCE_TICKS,
		);
		if (element) return { elementId: element.id, trackId: track.id, trackKind };
	}
	return null;
}

/** Register editor-parity commands the agent and UI share. */
export function registerEditorCommands({ editor }: { editor: EditorCore }): void {
	const actionCommands: Array<{
		name: string;
		description: string;
		category: "playback" | "navigation" | "editing" | "selection" | "history" | "timeline" | "controls" | "assets";
		action: TAction;
		argsSchema?: z.ZodType;
	}> = [
		{ name: "toggle_play", description: "Play or pause playback", category: "playback", action: "toggle-play" },
		{ name: "stop_playback", description: "Stop playback and seek to start", category: "playback", action: "stop-playback" },
		{ name: "seek_forward", description: "Seek forward by seconds", category: "playback", action: "seek-forward", argsSchema: z.object({ seconds: z.number().optional() }) },
		{ name: "seek_backward", description: "Seek backward by seconds", category: "playback", action: "seek-backward", argsSchema: z.object({ seconds: z.number().optional() }) },
		{ name: "frame_step_forward", description: "Step one frame forward", category: "navigation", action: "frame-step-forward" },
		{ name: "frame_step_backward", description: "Step one frame backward", category: "navigation", action: "frame-step-backward" },
		{ name: "jump_forward", description: "Jump forward by seconds (default 5)", category: "navigation", action: "jump-forward", argsSchema: z.object({ seconds: z.number().optional() }) },
		{ name: "jump_backward", description: "Jump backward by seconds (default 5)", category: "navigation", action: "jump-backward", argsSchema: z.object({ seconds: z.number().optional() }) },
		{ name: "goto_start", description: "Go to timeline start", category: "navigation", action: "goto-start" },
		{ name: "goto_end", description: "Go to timeline end", category: "navigation", action: "goto-end" },
		{ name: "split", description: "Split elements at playhead", category: "editing", action: "split" },
		{ name: "split_left", description: "Split and remove left side", category: "editing", action: "split-left" },
		{ name: "split_right", description: "Split and remove right side", category: "editing", action: "split-right" },
		{ name: "delete_selected", description: "Delete selected elements or keyframes", category: "editing", action: "delete-selected" },
		{ name: "copy_selected", description: "Copy selected elements", category: "editing", action: "copy-selected" },
		{ name: "paste_copied", description: "Paste at playhead", category: "editing", action: "paste-copied" },
		{ name: "toggle_snapping", description: "Toggle timeline snapping", category: "editing", action: "toggle-snapping" },
		{ name: "toggle_ripple_editing", description: "Toggle ripple editing", category: "editing", action: "toggle-ripple-editing" },
		{ name: "toggle_source_audio", description: "Extract or recover source audio", category: "editing", action: "toggle-source-audio" },
		{ name: "select_all", description: "Select all timeline elements", category: "selection", action: "select-all" },
		{ name: "deselect_all", description: "Clear selection", category: "selection", action: "deselect-all" },
		{ name: "duplicate_selected", description: "Duplicate selected elements", category: "selection", action: "duplicate-selected" },
		{ name: "toggle_elements_muted", description: "Mute/unmute selected", category: "selection", action: "toggle-elements-muted-selected" },
		{ name: "toggle_elements_visibility", description: "Show/hide selected", category: "selection", action: "toggle-elements-visibility-selected" },
		{ name: "toggle_bookmark", description: "Toggle bookmark at playhead", category: "timeline", action: "toggle-bookmark" },
		{ name: "undo", description: "Undo last edit", category: "history", action: "undo" },
		{ name: "redo", description: "Redo last undone edit", category: "history", action: "redo" },
	];

	for (const item of actionCommands) {
		registerCommand({
			definition: {
				name: item.name,
				description: item.description,
				category: item.category,
				argsSchema: item.argsSchema ?? emptyArgs,
				exposeToAgent: true,
			},
			handler: (args, ctx) =>
				withTarget(editor, ctx.target, () => {
					if (item.argsSchema) {
						(invokeAction as (action: TAction, args?: unknown) => void)(
							item.action,
							args,
						);
					} else {
						(invokeAction as (action: TAction) => void)(item.action);
					}
					return { ok: true };
				}),
		});
	}

	registerCommand({
		definition: {
			name: "get_project_summary",
			description: "Get project name, duration, media assets, and track element counts",
			category: "project",
			argsSchema: emptyArgs,
			exposeToAgent: true,
		},
		handler: (_args, ctx) => {
			const read = () => {
				const project = editor.project.getActiveOrNull();
				const scene = editor.scenes.getActiveSceneOrNull();
				const assets = editor.media.getAssets();
				const tracks = scene?.tracks;
				const elementCount = tracks
					? tracks.main.elements.length +
						tracks.overlay.reduce((n, t) => n + t.elements.length, 0) +
						tracks.audio.reduce((n, t) => n + t.elements.length, 0)
					: 0;
				const summarizeElement = (element: TimelineElement) => ({
					id: element.id,
					name: element.name,
					type: element.type,
					startTimeSeconds: element.startTime / TICKS_PER_SECOND,
					durationSeconds: element.duration / TICKS_PER_SECOND,
					mediaId: "mediaId" in element ? element.mediaId : undefined,
				});
				return {
					projectId: project?.metadata.id ?? null,
					name: project?.metadata.name ?? null,
					durationSeconds: editor.timeline.getTotalDuration() / TICKS_PER_SECOND,
					currentTimeSeconds: editor.playback.getCurrentTime() / TICKS_PER_SECOND,
					viewMode: editor.shadow.getViewMode(),
					hasShadow: editor.shadow.hasShadow(),
					diverged: editor.shadow.isFinalDiverged(),
					assetCount: assets.length,
					assets: assets.map((a) => ({
						id: a.id,
						name: a.name,
						type: a.type,
						duration: a.duration,
						visionSummary: a.vision?.summary ?? null,
						visionFrameCount: a.vision?.frames?.length ?? 0,
						hasTranscript: Boolean(a.transcript?.segments?.length),
					})),
					elementCount,
					tracks: tracks
						? {
								main: {
									id: tracks.main.id,
									elements: tracks.main.elements.map(summarizeElement),
								},
								overlay: tracks.overlay.map((t) => ({
									id: t.id,
									elements: t.elements.map(summarizeElement),
								})),
								audio: tracks.audio.map((t) => ({
									id: t.id,
									elements: t.elements.map(summarizeElement),
								})),
							}
						: null,
					target: ctx.target,
				};
			};
			if (ctx.target === "shadow") {
				return editor.shadow.runOnShadow(read);
			}
			return read();
		},
	});

	registerCommand({
		definition: {
			name: "place_media",
			description:
				"Place an already-imported project media asset onto the timeline (AI Preview when target is shadow). Prefer this over import_media_paths when get_project_summary already lists the asset. Omit startTimeSeconds to append at the end of the timeline: do that to put clips one after another. The result says which track the clip landed on; a clip lands on an overlay track only when the main track is occupied at that time.",
			category: "media",
			argsSchema: z
				.object({
					mediaId: z.string().optional(),
					mediaName: z.string().optional(),
					startTimeSeconds: z.number().min(0).optional(),
				})
				.refine((v) => Boolean(v.mediaId || v.mediaName), {
					message: "Provide mediaId or mediaName",
				}),
			exposeToAgent: true,
		},
		handler: ({ mediaId, mediaName, startTimeSeconds }, ctx) =>
			withTarget(editor, ctx.target, () => {
				const asset = findProjectMediaAsset({
					assets: editor.media.getAssets(),
					mediaId,
					mediaName,
				});
				if (!asset) {
					return {
						ok: false,
						reason: `No project media matched mediaId=${mediaId ?? ""} mediaName=${mediaName ?? ""}`,
					};
				}
				const startTime =
					startTimeSeconds !== undefined
						? snapToMainTrackEdge({
								editor,
								time: Math.round(startTimeSeconds * TICKS_PER_SECOND),
							})
						: editor.timeline.getTotalDuration();
				const duration =
					asset.duration != null
						? Math.round(asset.duration * TICKS_PER_SECOND)
						: DEFAULT_NEW_ELEMENT_DURATION;
				const element = buildElementFromMedia({
					mediaId: asset.id,
					mediaType: asset.type,
					name: asset.name,
					duration,
					startTime,
				});
				const error = editor.timeline.insertElement({
					element,
					placement: { mode: "auto" },
				});
				if (error) return editFailure(error, "insert_failed");
				const placed = findPlacedMedia({ editor, mediaId: asset.id, startTime });
				return {
					ok: true,
					mediaId: asset.id,
					name: asset.name,
					elementId: placed?.elementId,
					trackId: placed?.trackId,
					trackKind: placed?.trackKind,
					startTimeSeconds: startTime / TICKS_PER_SECOND,
					durationSeconds: duration / TICKS_PER_SECOND,
					...(placed?.trackKind === "overlay"
						? {
								note: "The main track was occupied at this time, so the clip went on an overlay track (layered above). To play clips in sequence, place them without startTimeSeconds.",
							}
						: {}),
				};
			}),
	});

	registerCommand({
		definition: {
			name: "seek_to",
			description: "Seek playhead to an absolute time in seconds",
			category: "playback",
			argsSchema: z.object({ seconds: z.number().min(0) }),
			exposeToAgent: true,
		},
		handler: ({ seconds }, ctx) =>
			withTarget(editor, ctx.target, () => {
				editor.playback.seek({ time: seconds * TICKS_PER_SECOND });
				return { ok: true, seconds };
			}),
	});

	registerCommand({
		definition: {
			name: "split_at",
			description: "Split all elements (or selected) at a time in seconds",
			category: "editing",
			argsSchema: z.object({
				seconds: z.number().min(0),
				selectedOnly: z.boolean().optional(),
			}),
			exposeToAgent: true,
		},
		handler: ({ seconds, selectedOnly }, ctx) =>
			withTarget(editor, ctx.target, () => {
				const time = seconds * TICKS_PER_SECOND;
				const tracks = editor.scenes.getActiveScene().tracks;
				const selected = editor.selection.getSelectedElements();
				const elements =
					selectedOnly && selected.length > 0
						? selected
						: getElementsAtTime({ tracks, time });
				if (elements.length === 0) {
					return { ok: false, reason: "No elements at time" };
				}
				const { error } = editor.timeline.splitElementsWithResult({
					elements,
					splitTime: time,
				});
				if (error) return editFailure(error, "split_failed");
				return { ok: true, splitCount: elements.length };
			}),
	});

	registerCommand({
		definition: {
			name: "delete_elements",
			description: "Delete timeline elements by trackId + elementId",
			category: "editing",
			argsSchema: z.object({
				elements: z.array(
					z.object({ trackId: z.string(), elementId: z.string() }),
				),
			}),
			exposeToAgent: true,
		},
		handler: ({ elements }, ctx) =>
			withTarget(editor, ctx.target, () => {
				const error = editor.timeline.deleteElements({ elements });
				if (error) return editFailure(error, "delete_failed");
				return { ok: true };
			}),
	});

	registerCommand({
		definition: {
			name: "trim_element",
			description:
				"Choose which part of a clip's source media plays. Keeps `durationSeconds` of the source starting `sourceStartSeconds` into it (default 0 = from the beginning); the clip's timeline start stays put. Example: keep the first 3 seconds -> { elementId, durationSeconds: 3 }. Returns the clip's new start, duration and source range. Gaps this leaves are not closed: call close_gaps afterwards to pack the track.",
			category: "editing",
			argsSchema: z.object({
				elementId: z.string(),
				durationSeconds: z
					.number()
					.positive()
					.describe("How long the clip should last on the timeline, in seconds."),
				sourceStartSeconds: z
					.number()
					.min(0)
					.optional()
					.describe("Where in the source media to start, in seconds (default 0)."),
			}),
			exposeToAgent: true,
		},
		handler: (args, ctx) =>
			withTarget(editor, ctx.target, () => {
				const found = findElementOnTracks({ editor, elementId: args.elementId });
				if (!found) {
					return {
						ok: false as const,
						reason: `No clip with id ${args.elementId}`,
						error: {
							code: "element_not_found",
							message: `No clip with id ${args.elementId}`,
							hint: "Call get_timeline_detail to list clip ids.",
						},
					};
				}
				const { element } = found;
				const rate =
					"retime" in element && element.retime
						? clampRetimeRate({ rate: element.retime.rate })
						: 1;
				const sourceStart = Math.round(
					(args.sourceStartSeconds ?? 0) * TICKS_PER_SECOND,
				);
				const sourceTotal =
					element.sourceDuration ??
					element.trimStart + element.duration * rate + element.trimEnd;
				const available = Math.max(0, sourceTotal - sourceStart);
				if (available <= 0) {
					return {
						ok: false as const,
						reason: `sourceStartSeconds is past the end of the source (${(sourceTotal / TICKS_PER_SECOND).toFixed(2)}s)`,
						error: {
							code: "invalid_trim",
							message: "sourceStartSeconds is past the end of the source",
							hint: `Use a sourceStartSeconds below ${(sourceTotal / TICKS_PER_SECOND).toFixed(2)}.`,
						},
					};
				}
				const requestedSpan = args.durationSeconds * TICKS_PER_SECOND * rate;
				const sourceSpan = Math.min(requestedSpan, available);
				const duration = Math.round(sourceSpan / rate);
				const error = editor.timeline.updateElementTrim({
					elementId: args.elementId,
					trimStart: sourceStart,
					trimEnd: Math.max(0, Math.round(sourceTotal - sourceStart - sourceSpan)),
					duration,
				});
				if (error) return editFailure(error, "trim_failed");
				return {
					ok: true,
					elementId: args.elementId,
					startTimeSeconds: element.startTime / TICKS_PER_SECOND,
					durationSeconds: duration / TICKS_PER_SECOND,
					sourceStartSeconds: sourceStart / TICKS_PER_SECOND,
					sourceEndSeconds: (sourceStart + sourceSpan) / TICKS_PER_SECOND,
					...(sourceSpan < requestedSpan
						? {
								note: `Source is shorter than requested; kept ${(duration / TICKS_PER_SECOND).toFixed(2)}s.`,
							}
						: {}),
				};
			}),
	});

	registerCommand({
		definition: {
			name: "close_gaps",
			description:
				"Pack the clips on one track back to back in their current order, removing gaps between them (one undoable edit). Defaults to the main track. Use after trimming or deleting clips.",
			category: "editing",
			argsSchema: z.object({
				trackId: z
					.string()
					.optional()
					.describe("Track to pack (default: the main video track)."),
				startAtSeconds: z
					.number()
					.min(0)
					.optional()
					.describe("Where the first clip should start (default: where it starts now)."),
			}),
			exposeToAgent: true,
		},
		handler: (args, ctx) =>
			withTarget(editor, ctx.target, () => {
				const tracks = editor.scenes.getActiveScene().tracks;
				const all = [tracks.main, ...tracks.overlay, ...tracks.audio];
				const track = args.trackId
					? all.find((t) => t.id === args.trackId)
					: tracks.main;
				if (!track) {
					return {
						ok: false as const,
						reason: `No track with id ${args.trackId}`,
						error: {
							code: "track_not_found",
							message: `No track with id ${args.trackId}`,
							hint: `Track ids: ${all.map((t) => t.id).join(", ")}`,
						},
					};
				}
				const ordered = [...track.elements].sort(
					(a, b) => a.startTime - b.startTime,
				);
				if (ordered.length === 0) return { ok: true, moved: 0, clips: [] };
				let cursor =
					args.startAtSeconds !== undefined
						? Math.round(args.startAtSeconds * TICKS_PER_SECOND)
						: ordered[0].startTime;
				const updates: Array<{
					trackId: string;
					elementId: string;
					patch: Partial<TimelineElement>;
				}> = [];
				const clips: Array<{ elementId: string; startTimeSeconds: number; durationSeconds: number }> = [];
				for (const element of ordered) {
					if (element.startTime !== cursor) {
						updates.push({
							trackId: track.id,
							elementId: element.id,
							patch: { startTime: cursor },
						});
					}
					clips.push({
						elementId: element.id,
						startTimeSeconds: cursor / TICKS_PER_SECOND,
						durationSeconds: element.duration / TICKS_PER_SECOND,
					});
					cursor += element.duration;
				}
				const error = editor.timeline.updateElements({ updates });
				if (error) return editFailure(error, "close_gaps_failed");
				const otherTracks = all
					.filter((t) => t.id !== track.id && t.elements.length > 0)
					.map((t) => ({ trackId: t.id, type: t.type, clips: t.elements.length }));
				return {
					ok: true,
					trackId: track.id,
					moved: updates.length,
					trackDurationSeconds: cursor / TICKS_PER_SECOND,
					clips,
					...(otherTracks.length > 0
						? {
								otherTracksWithClips: otherTracks,
								note: "Only this track was packed. Clips on the other tracks listed here keep their times; move them onto this track (move_element with targetTrackId, then close_gaps) if they belong in the same sequence.",
							}
						: {}),
				};
			}),
	});

	registerCommand({
		definition: {
			name: "move_element",
			description: "Move an element to a new start time / track",
			category: "editing",
			argsSchema: z.object({
				sourceTrackId: z.string(),
				elementId: z.string(),
				targetTrackId: z.string().optional(),
				newStartTimeSeconds: z.number().min(0),
			}),
			exposeToAgent: true,
		},
		handler: (args, ctx) =>
			withTarget(editor, ctx.target, () => {
				const error = withStrictTimelineValidation(() =>
					editor.timeline.moveElement({
						sourceTrackId: args.sourceTrackId,
						targetTrackId: args.targetTrackId ?? args.sourceTrackId,
						elementId: args.elementId,
						newStartTime: args.newStartTimeSeconds * TICKS_PER_SECOND,
					}),
				);
				if (error) return editFailure(error, "move_failed");
				return { ok: true };
			}),
	});

	registerCommand({
		definition: {
			name: "add_text",
			description: "Add a text element to the timeline",
			category: "editing",
			argsSchema: z.object({
				content: z.string().min(1),
				startTimeSeconds: z.number().min(0).optional(),
				durationSeconds: z.number().min(0).optional(),
				fontSize: z.number().optional(),
				color: z.string().optional(),
			}),
			exposeToAgent: true,
		},
		handler: (args, ctx) =>
			withTarget(editor, ctx.target, () => {
				const startTime =
					args.startTimeSeconds !== undefined
						? Math.round(args.startTimeSeconds * TICKS_PER_SECOND)
						: editor.playback.getCurrentTime();
				const element = buildTextElement({
					raw: {
						content: args.content,
						duration:
							args.durationSeconds !== undefined
								? Math.round(args.durationSeconds * TICKS_PER_SECOND)
								: undefined,
						fontSize: args.fontSize,
						color: args.color,
					},
					startTime,
				});
				const error = editor.timeline.insertElement({
					element,
					placement: { mode: "auto" },
				});
				if (error) return editFailure(error, "insert_failed");
				return { ok: true, content: args.content };
			}),
	});

	registerCommand({
		definition: {
			name: "update_text",
			description: "Update fields on a timeline text element",
			category: "editing",
			argsSchema: z.object({
				trackId: z.string(),
				elementId: z.string(),
				content: z.string().optional(),
				fontSize: z.number().optional(),
				color: z.string().optional(),
				opacity: z.number().min(0).max(1).optional(),
			}),
			exposeToAgent: true,
		},
		handler: (args, ctx) =>
			withTarget(editor, ctx.target, () => {
				const patch: Record<string, unknown> = {};
				if (args.content !== undefined) patch.content = args.content;
				if (args.fontSize !== undefined) patch.fontSize = args.fontSize;
				if (args.color !== undefined) patch.color = args.color;
				if (args.opacity !== undefined) patch.opacity = args.opacity;
				const error = editor.timeline.updateElements({
					updates: [
						{
							trackId: args.trackId,
							elementId: args.elementId,
							patch,
						},
					],
				});
				if (error) return editFailure(error, "update_failed");
				return { ok: true };
			}),
	});

	registerCommand({
		definition: {
			name: "add_effect",
			description:
				"Add a built-in real-time clip effect (e.g. blur) to a timeline element. Color grades are not effects: use list_grades / apply_grade for those.",
			category: "editing",
			argsSchema: z.object({
				trackId: z.string(),
				elementId: z.string(),
				effectType: z.string().default("blur"),
			}),
			exposeToAgent: true,
		},
		handler: (args, ctx) =>
			withTarget(editor, ctx.target, () => {
				if (!effectsRegistry.has(args.effectType)) {
					const known = effectsRegistry.getAll().map((d) => d.type);
					return {
						ok: false as const,
						reason: `Unknown effect: ${args.effectType}`,
						error: {
							code: "unknown_effect",
							message: `Unknown effect: ${args.effectType}`,
							hint: `Effect types: ${known.join(", ")}. For color grades use list_grades and apply_grade.`,
						},
					};
				}
				const effectId = editor.timeline.addClipEffect({
					trackId: args.trackId,
					elementId: args.elementId,
					effectType: args.effectType,
				});
				return { ok: true, effectId };
			}),
	});

	registerCommand({
		definition: {
			name: "remove_effect",
			description: "Remove a clip effect from a timeline element",
			category: "editing",
			argsSchema: z.object({
				trackId: z.string(),
				elementId: z.string(),
				effectId: z.string(),
			}),
			exposeToAgent: true,
		},
		handler: (args, ctx) =>
			withTarget(editor, ctx.target, () => {
				editor.timeline.removeClipEffect({
					trackId: args.trackId,
					elementId: args.elementId,
					effectId: args.effectId,
				});
				return { ok: true };
			}),
	});

	registerCommand({
		definition: {
			name: "update_transform",
			description:
				"Update position/scale/rotation transform on a visual timeline element",
			category: "editing",
			argsSchema: z.object({
				trackId: z.string(),
				elementId: z.string(),
				scaleX: z.number().optional(),
				scaleY: z.number().optional(),
				x: z.number().optional(),
				y: z.number().optional(),
				rotate: z.number().optional(),
			}),
			exposeToAgent: true,
		},
		handler: (args, ctx) =>
			withTarget(editor, ctx.target, () => {
				const scene = editor.scenes.getActiveScene();
				const track =
					scene.tracks.main.id === args.trackId
						? scene.tracks.main
						: [...scene.tracks.overlay, ...scene.tracks.audio].find(
								(t) => t.id === args.trackId,
							);
				const element = track?.elements.find((el) => el.id === args.elementId);
				if (!element || !("transform" in element)) {
					return { ok: false, reason: "Element has no transform" };
				}
				const transform = {
					...element.transform,
					...(args.scaleX !== undefined ? { scaleX: args.scaleX } : {}),
					...(args.scaleY !== undefined ? { scaleY: args.scaleY } : {}),
					...(args.rotate !== undefined ? { rotate: args.rotate } : {}),
					position: {
						x: args.x ?? element.transform.position.x,
						y: args.y ?? element.transform.position.y,
					},
				};
				const error = editor.timeline.updateElements({
					updates: [
						{
							trackId: args.trackId,
							elementId: args.elementId,
							patch: { transform },
						},
					],
				});
				if (error) return editFailure(error, "update_failed");
				return { ok: true, transform };
			}),
	});

	registerCommand({
		definition: {
			name: "add_rectangle_mask",
			description:
				"Add a rectangle mask to a video/image element (crop-like framing)",
			category: "editing",
			argsSchema: z.object({
				trackId: z.string(),
				elementId: z.string(),
			}),
			exposeToAgent: true,
		},
		handler: (args, ctx) =>
			withTarget(editor, ctx.target, () => {
				const mask = buildDefaultMaskInstance({ maskType: "rectangle" });
				const error = editor.timeline.updateElements({
					updates: [
						{
							trackId: args.trackId,
							elementId: args.elementId,
							patch: { masks: [mask] },
						},
					],
				});
				if (error) return editFailure(error, "update_failed");
				return { ok: true, maskId: mask.id };
			}),
	});

	registerCommand({
		definition: {
			name: "ai_accept_preview",
			description: "Accept AI Preview shadow timeline into the final timeline",
			category: "ai",
			argsSchema: emptyArgs,
			exposeToAgent: false,
		},
		handler: () => {
			editor.shadow.accept();
			recordPreviewDecision(true);
			return { ok: true };
		},
	});

	registerCommand({
		definition: {
			name: "ai_reject_preview",
			description: "Reject/discard the AI Preview shadow timeline",
			category: "ai",
			argsSchema: emptyArgs,
			exposeToAgent: false,
		},
		handler: () => {
			editor.shadow.reject();
			recordPreviewDecision(false);
			return { ok: true };
		},
	});

	registerCommand({
		definition: {
			name: "ai_reset_preview",
			description:
				"Reset AI Preview from the current final timeline (clears diverge)",
			category: "ai",
			argsSchema: emptyArgs,
			exposeToAgent: false,
		},
		handler: () => {
			editor.shadow.resetFromFinal();
			return { ok: true };
		},
	});

	registerCommand({
		definition: {
			name: "ai_set_view_mode",
			description: "Switch between final and AI Preview timeline view",
			category: "ai",
			argsSchema: z.object({ mode: z.enum(["final", "shadow"]) }),
			exposeToAgent: false,
		},
		handler: ({ mode }) => {
			editor.shadow.setViewMode({ mode });
			return { ok: true, mode };
		},
	});
}
