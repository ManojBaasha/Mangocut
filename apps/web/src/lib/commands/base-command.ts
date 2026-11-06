import type { ElementRef } from "@/lib/timeline/types";

export interface CommandResult {
	select?: ElementRef[];
}

export abstract class Command {
	/**
	 * True when the command applies ripple itself (ported timeline ops pass
	 * ripple to the Rust engine), so CommandManager skips its own ripple pass.
	 */
	handlesRipple = false;

	abstract execute(): CommandResult | undefined;

	undo(): void {
		throw new Error("Undo not implemented for this command");
	}

	redo(): CommandResult | undefined {
		return this.execute();
	}
}
