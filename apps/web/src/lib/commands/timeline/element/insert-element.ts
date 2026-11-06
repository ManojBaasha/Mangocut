import { Command, type CommandResult } from "@/lib/commands/base-command";
import { EditorCore } from "@/core";
import type {
	CreateTimelineElement,
	SceneTracks,
	TrackType,
} from "@/lib/timeline";
import { generateUUID } from "@/utils/id";
import { requiresMediaId } from "@/lib/timeline/element-utils";
import type { MediaAsset } from "@/lib/media/types";
import { floatToFrameRate } from "@/lib/fps/utils";
import { graphicsRegistry, registerDefaultGraphics } from "@/lib/graphics";
import {
	isNoOpError,
	type JsonValue,
	runTimelineOp,
	StableIdPool,
} from "../run-timeline-op";

type InsertElementPlacement =
	| { mode: "explicit"; trackId: string }
	| { mode: "auto"; trackType?: TrackType; insertIndex?: number };

export interface InsertElementParams {
	element: CreateTimelineElement;
	placement: InsertElementPlacement;
}

export class InsertElementCommand extends Command {
	handlesRipple = true;
	private elementId: string;
	private ids: StableIdPool;
	private savedState: SceneTracks | null = null;
	private error: Error | null = null;
	private targetTrackId: string | null = null;

	constructor({ element, placement }: InsertElementParams) {
		super();
		this.elementId = generateUUID();
		this.ids = new StableIdPool({ first: this.elementId });
		this.element = element;
		this.placement = placement;
	}

	private element: CreateTimelineElement;
	private placement: InsertElementPlacement;

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		this.savedState = editor.scenes.getActiveScene().tracks;
		this.error = null;

		const invalid = this.validateElementBasics({ element: this.element });
		if (invalid) {
			console.error(invalid);
			this.error = new Error(invalid);
			return;
		}

		const totalElementsInTimeline =
			this.savedState.main.elements.length +
			this.savedState.overlay.reduce(
				(total, track) => total + track.elements.length,
				0,
			) +
			this.savedState.audio.reduce(
				(total, track) => total + track.elements.length,
				0,
			);
		const isFirstElement = totalElementsInTimeline === 0;

		// Placement, defaults and validation run in Rust; the element id is
		// fixed up front so getElementId() works before execute.
		const result = runTimelineOp({
			tracks: this.savedState,
			op: {
				type: "insertElement",
				element: this.element as unknown as JsonValue,
				placement: this.placement,
			},
			ripple: editor.command.shouldCommandRipple(),
			ids: this.ids,
		});
		if (!result.ok) {
			if (isNoOpError(result.error)) {
				console.error(result.error.message);
			}
			this.error = result.error;
			return;
		}
		if (!result.output.changed) {
			console.error(result.output.summary);
			this.error = new Error(result.output.summary);
			return;
		}

		const placed = result.output.created[0];
		if (!placed) {
			return;
		}
		const targetTrackId = placed.trackId;
		this.targetTrackId = targetTrackId;

		const newElement = this.element;
		const isVisualMedia =
			newElement.type === "video" || newElement.type === "image";

		if (isFirstElement && isVisualMedia) {
			const mediaAssets = editor.media.getAssets();
			const activeProject = editor.project.getActive();
			const asset = mediaAssets.find(
				(item: MediaAsset) => item.id === newElement.mediaId,
			);

			if (asset?.width && asset?.height) {
				const nextCanvasSize = { width: asset.width, height: asset.height };
				const shouldSetOriginalCanvasSize =
					!activeProject?.settings.originalCanvasSize;
				editor.project.updateSettings({
					settings: {
						canvasSize: nextCanvasSize,
						...(shouldSetOriginalCanvasSize
							? { originalCanvasSize: nextCanvasSize }
							: {}),
					},
					pushHistory: false,
				});
			}

			if (asset?.type === "video" && asset?.fps) {
				editor.project.updateSettings({
					settings: { fps: floatToFrameRate(asset.fps) },
					pushHistory: false,
				});
			}
		}

		editor.timeline.updateTracks(result.output.tracks);

		return {
			select: [{ trackId: targetTrackId, elementId: this.elementId }],
		};
	}

	undo(): void {
		if (this.savedState) {
			const editor = EditorCore.getInstance();
			editor.timeline.updateTracks(this.savedState);
		}
	}

	getElementId(): string {
		return this.elementId;
	}

	getTrackId(): string | null {
		return this.targetTrackId;
	}

	/** Why the last execute inserted nothing, or null on success. */
	getError(): Error | null {
		return this.error;
	}

	private validateElementBasics({
		element,
	}: {
		element: CreateTimelineElement;
	}): string | null {
		if (requiresMediaId({ element }) && !("mediaId" in element)) {
			return "Element requires mediaId";
		}

		if (
			element.type === "audio" &&
			element.sourceType === "library" &&
			!element.sourceUrl
		) {
			return "Library audio element must have sourceUrl";
		}

		if (element.type === "sticker" && !element.stickerId) {
			return "Sticker element must have stickerId";
		}

		if (element.type === "graphic") {
			registerDefaultGraphics();
			if (!element.definitionId || !graphicsRegistry.has(element.definitionId)) {
				return "Graphic element must have a valid definitionId";
			}
		}

		if (element.type === "text" && !element.content) {
			return "Text element must have content";
		}

		if (element.type === "effect" && !element.effectType) {
			return "Effect element must have effectType";
		}

		return null;
	}
}
