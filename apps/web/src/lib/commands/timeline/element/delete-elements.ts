import { Command, type CommandResult } from "@/lib/commands/base-command";
import type { SceneTracks } from "@/lib/timeline";
import { EditorCore } from "@/core";
import { keepExistingRefs, runTimelineOp } from "../run-timeline-op";

export class DeleteElementsCommand extends Command {
	handlesRipple = true;
	private savedState: SceneTracks | null = null;
	private readonly elements: { trackId: string; elementId: string }[];

	constructor({
		elements,
	}: {
		elements: { trackId: string; elementId: string }[];
	}) {
		super();
		this.elements = elements;
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		this.savedState = editor.scenes.getActiveScene().tracks;

		const elements = keepExistingRefs(this.savedState, this.elements);
		if (elements.length === 0) {
			return { select: [] };
		}
		const result = runTimelineOp({
			tracks: this.savedState,
			op: { type: "deleteElements", elements },
			ripple: editor.command.shouldCommandRipple(),
		});
		if (!result.ok) {
			return undefined;
		}
		if (result.output.changed) {
			editor.timeline.updateTracks(result.output.tracks);
		}

		return {
			select: [],
		};
	}

	undo(): void {
		if (this.savedState) {
			const editor = EditorCore.getInstance();
			editor.timeline.updateTracks(this.savedState);
		}
	}
}
