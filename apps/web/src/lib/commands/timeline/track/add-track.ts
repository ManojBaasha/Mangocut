import { Command, type CommandResult } from "@/lib/commands/base-command";
import type { SceneTracks, TrackType } from "@/lib/timeline";
import { generateUUID } from "@/utils/id";
import { EditorCore } from "@/core";
import { runTimelineOp, StableIdPool } from "../run-timeline-op";

export class AddTrackCommand extends Command {
	handlesRipple = true;
	private trackId: string;
	private ids: StableIdPool;
	private savedState: SceneTracks | null = null;

	constructor(
		private type: TrackType,
		private index?: number,
	) {
		super();
		// Known before execute: callers batch an insert onto this track.
		this.trackId = generateUUID();
		this.ids = new StableIdPool({ first: this.trackId });
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		this.savedState = editor.scenes.getActiveScene().tracks;

		const result = runTimelineOp({
			tracks: this.savedState,
			op: { type: "addTrack", trackType: this.type, index: this.index },
			ripple: editor.command.shouldCommandRipple(),
			ids: this.ids,
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

	getTrackId(): string {
		return this.trackId;
	}
}
