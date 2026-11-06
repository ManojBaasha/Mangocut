import type { EditorCore } from "@/core";
import type { Command, CommandResult } from "@/lib/commands";
import { applyRippleAdjustments, computeRippleAdjustments } from "@/lib/ripple";
import type { ElementRef, SceneTracks } from "@/lib/timeline/types";

interface CommandHistoryEntry {
	command: Command;
	previousSelection: ElementRef[];
	selectionOverride?: ElementRef[];
}

export class CommandManager {
	public isRippleEnabled = false;
	private commandRipple = false;
	private history: CommandHistoryEntry[] = [];
	private redoStack: CommandHistoryEntry[] = [];
	private reactors: Array<() => void> = [];

	constructor(private editor: EditorCore) {}

	execute({ command }: { command: Command }): Command {
		const beforeTracks = this.getRippleBaseline(command);
		const previousSelection = this.getSelectionSnapshot();
		const result = this.runWithRipple(command, () => command.execute());
		this.applyRippleIfEnabled({ beforeTracks });
		const selectionOverride = this.applySelectionOverride(result);
		this.runReactors();
		this.history.push({
			command,
			previousSelection,
			selectionOverride,
		});
		this.redoStack = [];
		return command;
	}

	push({ command }: { command: Command }): void {
		this.history.push({
			command,
			previousSelection: this.getSelectionSnapshot(),
		});
		this.redoStack = [];
	}

	registerReactor(reactor: () => void): void {
		this.reactors.push(reactor);
	}

	undo(): void {
		if (this.history.length === 0) return;
		const entry = this.history.pop();
		entry?.command.undo();
		if (entry) {
			// Only restore selection for commands that explicitly changed it.
			// Commands without selection intent leave selection untouched,
			// preserving any UI-driven selection changes (clicks, box select)
			// that happened between commands. Commands that remove elements
			// must declare { select: [] } to clear stale refs.
			if (entry.selectionOverride !== undefined) {
				this.editor.selection.setSelectedElements({
					elements: [...entry.previousSelection],
				});
			}
			this.redoStack.push(entry);
		}
	}

	redo(): void {
		if (this.redoStack.length === 0) return;
		const entry = this.redoStack.pop();
		if (!entry) {
			return;
		}

		const beforeTracks = this.getRippleBaseline(entry.command);
		const previousSelection = this.getSelectionSnapshot();
		const result = this.runWithRipple(entry.command, () =>
			entry.command.redo(),
		);
		this.applyRippleIfEnabled({ beforeTracks });
		const selectionOverride = this.applySelectionOverride(result);
		this.runReactors();

		this.history.push({
			command: entry.command,
			previousSelection,
			selectionOverride,
		});
	}

	canUndo(): boolean {
		return this.history.length > 0;
	}

	canRedo(): boolean {
		return this.redoStack.length > 0;
	}

	clear(): void {
		this.history = [];
		this.redoStack = [];
	}

	/**
	 * Whether a command that ripples itself (`handlesRipple`) should ripple
	 * now. True only while this manager executes or redoes such a command with
	 * ripple enabled, so direct `command.execute()` calls (live previews with
	 * pushHistory: false) never ripple, as before.
	 */
	shouldCommandRipple(): boolean {
		return this.commandRipple;
	}

	private runWithRipple<T>(command: Command, run: () => T): T {
		const previous = this.commandRipple;
		this.commandRipple = this.isRippleEnabled && command.handlesRipple;
		try {
			return run();
		} finally {
			this.commandRipple = previous;
		}
	}

	/** Tracks before the command, when this manager must ripple it itself. */
	private getRippleBaseline(command: Command): SceneTracks | null {
		if (!this.isRippleEnabled || command.handlesRipple) {
			return null;
		}
		return this.editor.scenes.getActiveSceneOrNull()?.tracks ?? null;
	}

	private getSelectionSnapshot(): ElementRef[] {
		return [...this.editor.selection.getSelectedElements()];
	}

	private applySelectionOverride(
		result: CommandResult | undefined,
	): ElementRef[] | undefined {
		if (result?.select === undefined) {
			return undefined;
		}

		const selectionOverride = [...result.select];
		this.editor.selection.setSelectedElements({ elements: selectionOverride });
		return selectionOverride;
	}

	private runReactors(): void {
		for (const reactor of this.reactors) {
			reactor();
		}
	}

	private applyRippleIfEnabled({
		beforeTracks,
	}: {
		beforeTracks: SceneTracks | null;
	}): void {
		if (!this.isRippleEnabled || !beforeTracks) {
			return;
		}

		const afterTracks = this.editor.scenes.getActiveSceneOrNull()?.tracks;
		if (!afterTracks) {
			return;
		}
		const adjustments = computeRippleAdjustments({
			beforeTracks,
			afterTracks,
		});
		if (adjustments.length === 0) {
			return;
		}

		const tracksWithRipple = applyRippleAdjustments({
			tracks: afterTracks,
			adjustments,
		});
		this.editor.timeline.updateTracks(tracksWithRipple);
	}
}
