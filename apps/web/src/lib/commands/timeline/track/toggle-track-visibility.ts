import { Command, type CommandResult } from "@/lib/commands/base-command";
import type { SceneTracks } from "@/lib/timeline";
import { EditorCore } from "@/core";
import { runTimelineOp } from "../run-timeline-op";

export class ToggleTrackVisibilityCommand extends Command {
	handlesRipple = true;
	private savedState: SceneTracks | null = null;
	private error: Error | null = null;

	constructor(private trackId: string) {
		super();
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		this.savedState = editor.scenes.getActiveScene().tracks;
		this.error = null;

		const result = runTimelineOp({
			tracks: this.savedState,
			op: { type: "toggleTrackVisibility", trackId: this.trackId },
			ripple: editor.command.shouldCommandRipple(),
		});
		if (!result.ok) {
			this.error = result.error;
			return undefined;
		}
		if (result.output.changed) {
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

	/** Why the last execute changed nothing, or null on success / no-op. */
	getError(): Error | null {
		return this.error;
	}
}
