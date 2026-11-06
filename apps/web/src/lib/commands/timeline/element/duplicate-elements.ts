import { Command, type CommandResult } from "@/lib/commands/base-command";
import type { SceneTracks } from "@/lib/timeline";
import { EditorCore } from "@/core";
import {
	keepExistingRefs,
	runTimelineOp,
	StableIdPool,
} from "../run-timeline-op";

interface DuplicateElementsParams {
	elements: { trackId: string; elementId: string }[];
}

export class DuplicateElementsCommand extends Command {
	handlesRipple = true;
	private duplicatedElements: { trackId: string; elementId: string }[] = [];
	private savedState: SceneTracks | null = null;
	private error: Error | null = null;
	private ids: StableIdPool | null = null;
	private elements: DuplicateElementsParams["elements"];

	constructor({ elements }: DuplicateElementsParams) {
		super();
		this.elements = elements;
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		this.savedState = editor.scenes.getActiveScene().tracks;
		this.error = null;
		this.duplicatedElements = [];

		const elements = keepExistingRefs(this.savedState, this.elements);
		if (elements.length === 0) {
			return undefined;
		}
		this.ids ??= new StableIdPool({ refs: elements.length });
		const result = runTimelineOp({
			tracks: this.savedState,
			op: { type: "duplicateElements", elements },
			ripple: editor.command.shouldCommandRipple(),
			ids: this.ids,
		});
		if (!result.ok) {
			this.error = result.error;
			return undefined;
		}
		if (result.output.changed) {
			editor.timeline.updateTracks(result.output.tracks);
		}

		this.duplicatedElements = result.output.created;
		if (this.duplicatedElements.length > 0) {
			return {
				select: this.duplicatedElements,
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

	getDuplicatedElements(): { trackId: string; elementId: string }[] {
		return this.duplicatedElements;
	}

	/** Why the last execute changed nothing, or null on success / no-op. */
	getError(): Error | null {
		return this.error;
	}
}
