import { Command, type CommandResult } from "@/lib/commands/base-command";
import type { SceneTracks } from "@/lib/timeline";
import { EditorCore } from "@/core";
import {
	keepExistingRefs,
	runTimelineOp,
	StableIdPool,
} from "../run-timeline-op";

export class SplitElementsCommand extends Command {
	handlesRipple = true;
	private savedState: SceneTracks | null = null;
	private ids: StableIdPool | null = null;
	private rightSideElements: { trackId: string; elementId: string }[] = [];
	private readonly elements: { trackId: string; elementId: string }[];
	private readonly splitTime: number;
	private readonly retainSide: "both" | "left" | "right";

	constructor({
		elements,
		splitTime,
		retainSide = "both",
	}: {
		elements: { trackId: string; elementId: string }[];
		splitTime: number;
		retainSide?: "both" | "left" | "right";
	}) {
		super();
		this.elements = elements;
		this.splitTime = splitTime;
		this.retainSide = retainSide;
	}

	getRightSideElements(): { trackId: string; elementId: string }[] {
		return this.rightSideElements;
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		this.savedState = editor.scenes.getActiveScene().tracks;
		this.rightSideElements = [];

		const elements = keepExistingRefs(this.savedState, this.elements);
		if (elements.length === 0) {
			return undefined;
		}
		this.ids ??= new StableIdPool({ refs: elements.length });
		const result = runTimelineOp({
			tracks: this.savedState,
			op: {
				type: "splitElements",
				elements,
				splitTime: this.splitTime,
				retainSide: this.retainSide,
			},
			ripple: editor.command.shouldCommandRipple(),
			ids: this.ids,
		});
		if (!result.ok) {
			return undefined;
		}
		if (result.output.changed) {
			editor.timeline.updateTracks(result.output.tracks);
		}

		this.rightSideElements = result.output.created;
		if (this.rightSideElements.length > 0) {
			return {
				select: this.rightSideElements,
			};
		}
		return undefined;
	}

	undo(): void {
		if (this.savedState) {
			const editor = EditorCore.getInstance();
			editor.timeline.updateTracks(this.savedState);
		}
	}
}
