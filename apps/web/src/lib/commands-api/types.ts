import { z } from "zod";

export type CommandTarget = "final" | "shadow";

export interface CommandContext {
	target: CommandTarget;
}

export interface CommandDefinition<TArgs extends z.ZodType = z.ZodType> {
	name: string;
	description: string;
	category:
		| "playback"
		| "navigation"
		| "editing"
		| "selection"
		| "history"
		| "timeline"
		| "controls"
		| "assets"
		| "media"
		| "project"
		| "ai"
		| "fs"
		| "ffmpeg";
	argsSchema: TArgs;
	/** When true, included in OpenRouter tool definitions for the agent. */
	exposeToAgent?: boolean;
}

export type CommandHandler<TArgs = unknown, TResult = unknown> = (
	args: TArgs,
	ctx: CommandContext,
) => TResult | Promise<TResult>;

export interface RegisteredCommand<TArgs = unknown, TResult = unknown>
	extends CommandDefinition<z.ZodType<TArgs>> {
	handler: CommandHandler<TArgs, TResult>;
}

/** OpenAI/OpenRouter function-tool shape. */
export function toOpenRouterTool(command: RegisteredCommand): {
	type: "function";
	function: {
		name: string;
		description: string;
		parameters: Record<string, unknown>;
	};
} {
	const jsonSchema = z.toJSONSchema(command.argsSchema, {
		target: "draft-7",
	}) as Record<string, unknown>;
	const { $schema: _schema, ...parameters } = jsonSchema;

	return {
		type: "function",
		function: {
			name: command.name,
			description: command.description,
			parameters: {
				...parameters,
				type: "object",
			},
		},
	};
}
