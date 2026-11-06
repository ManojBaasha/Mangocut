import { Command, type CommandResult } from "@/lib/commands/base-command";
import type { SceneTracks } from "@/lib/timeline";
import { EditorCore } from "@/core";
import { runTimelineOp } from "../run-timeline-op";

export class RemoveTrackCommand extends Command {
	handlesRipple = true;
	private savedState: SceneTracks | null = null;

	constructor(private trackId: string) {
		super();
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		this.savedState = editor.scenes.getActiveScene().tracks;

		const result = runTimelineOp({
			tracks: this.savedState,
			op: { type: "removeTrack", trackId: this.trackId },
			ripple: editor.command.shouldCommandRipple(),
		});
		if (result.ok && result.output.changed) {
			editor.timeline.updateTracks(result.output.tracks);
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
