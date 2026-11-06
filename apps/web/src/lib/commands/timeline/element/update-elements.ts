import { EditorCore } from "@/core";
import { Command, type CommandResult } from "@/lib/commands/base-command";
import type { SceneTracks, TimelineElement } from "@/lib/timeline";
import {
	type JsonValue,
	keepExistingRefs,
	runTimelineOp,
} from "../run-timeline-op";

/**
 * A patch key set to `undefined` clears that field (TS spread, then JSON).
 * The wasm wrapper strips undefined, so send those keys as `null`, which the
 * Rust update treats as "remove the key".
 */
function toWasmPatch(patch: Partial<TimelineElement>): JsonValue {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(patch)) {
		out[key] = value === undefined ? null : value;
	}
	return out as JsonValue;
}

export class UpdateElementsCommand extends Command {
	handlesRipple = true;
	private savedState: SceneTracks | null = null;
	private readonly updates: Array<{
		trackId: string;
		elementId: string;
		patch: Partial<TimelineElement>;
	}>;

	constructor({
		updates,
	}: {
		updates: Array<{
			trackId: string;
			elementId: string;
			patch: Partial<TimelineElement>;
		}>;
	}) {
		super();
		this.updates = updates;
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		this.savedState = editor.scenes.getActiveScene().tracks;

		const updates = keepExistingRefs(this.savedState, this.updates);
		if (updates.length === 0) {
			return undefined;
		}
		const result = runTimelineOp({
			tracks: this.savedState,
			op: {
				type: "updateElements",
				updates: updates.map(({ trackId, elementId, patch }) => ({
					trackId,
					elementId,
					patch: toWasmPatch(patch),
				})),
			},
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
