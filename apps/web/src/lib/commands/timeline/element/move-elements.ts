import { Command, type CommandResult } from "@/lib/commands/base-command";
import { EditorCore } from "@/core";
import type { SceneTracks, TrackType } from "@/lib/timeline";
import { runTimelineOp } from "../run-timeline-op";

export class MoveElementCommand extends Command {
	handlesRipple = true;
	private savedState: SceneTracks | null = null;
	private error: Error | null = null;
	private readonly sourceTrackId: string;
	private readonly targetTrackId: string;
	private readonly elementId: string;
	private readonly newStartTime: number;
	private readonly createTrack: { type: TrackType; index: number } | undefined;

	constructor({
		sourceTrackId,
		targetTrackId,
		elementId,
		newStartTime,
		createTrack,
	}: {
		sourceTrackId: string;
		targetTrackId: string;
		elementId: string;
		newStartTime: number;
		createTrack?: { type: TrackType; index: number };
	}) {
		super();
		this.sourceTrackId = sourceTrackId;
		this.targetTrackId = targetTrackId;
		this.elementId = elementId;
		this.newStartTime = newStartTime;
		this.createTrack = createTrack;
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		this.savedState = editor.scenes.getActiveScene().tracks;
		this.error = null;

		// A new track (createTrack) takes targetTrackId as its id.
		const result = runTimelineOp({
			tracks: this.savedState,
			op: {
				type: "moveElement",
				sourceTrackId: this.sourceTrackId,
				targetTrackId: this.targetTrackId,
				elementId: this.elementId,
				newStartTime: this.newStartTime,
				createTrack: this.createTrack,
			},
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

	/** Why the last execute changed nothing, or null when it succeeded. */
	getError(): Error | null {
		return this.error;
	}
}
