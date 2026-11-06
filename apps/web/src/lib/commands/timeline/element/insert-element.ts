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

		if (!this.validateElementBasics({ element: this.element })) {
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
			return;
		}
		if (!result.output.changed) {
			console.error(result.output.summary);
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

	private validateElementBasics({
		element,
	}: {
		element: CreateTimelineElement;
	}): boolean {
		if (requiresMediaId({ element }) && !("mediaId" in element)) {
			console.error("Element requires mediaId");
			return false;
		}

		if (
			element.type === "audio" &&
			element.sourceType === "library" &&
			!element.sourceUrl
		) {
			console.error("Library audio element must have sourceUrl");
			return false;
		}

		if (element.type === "sticker" && !element.stickerId) {
			console.error("Sticker element must have stickerId");
			return false;
		}

		if (element.type === "graphic") {
			registerDefaultGraphics();
			if (!element.definitionId || !graphicsRegistry.has(element.definitionId)) {
				console.error("Graphic element must have a valid definitionId");
				return false;
			}
		}

		if (element.type === "text" && !element.content) {
			console.error("Text element must have content");
			return false;
		}

		if (element.type === "effect" && !element.effectType) {
			console.error("Effect element must have effectType");
			return false;
		}

		return true;
	}
}
