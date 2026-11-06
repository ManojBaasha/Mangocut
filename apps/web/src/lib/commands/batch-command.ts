import { Command, type CommandResult } from "./base-command";

export class BatchCommand extends Command {
	constructor(private commands: Command[]) {
		super();
		// Only when every child ripples itself; otherwise CommandManager ripples
		// the whole batch once and the children are told not to.
		this.handlesRipple =
			commands.length > 0 && commands.every((command) => command.handlesRipple);
	}

	execute(): CommandResult | undefined {
		let latestSelectionResult: CommandResult | undefined;

		for (const command of this.commands) {
			const result = command.execute();
			if (result?.select !== undefined) {
				latestSelectionResult = result;
			}
		}

		return latestSelectionResult;
	}

	undo(): void {
		for (const command of [...this.commands].reverse()) {
			command.undo();
		}
	}

	redo(): CommandResult | undefined {
		let latestSelectionResult: CommandResult | undefined;

		for (const command of this.commands) {
			const result = command.redo();
			if (result?.select !== undefined) {
				latestSelectionResult = result;
			}
		}

		return latestSelectionResult;
	}
}
