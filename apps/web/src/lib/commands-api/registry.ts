import type {
	CommandContext,
	CommandDefinition,
	CommandHandler,
	CommandTarget,
	RegisteredCommand,
} from "./types";
import { toOpenRouterTool } from "./types";
import type { z } from "zod";

const registry = new Map<string, RegisteredCommand>();

type ShadowCommandGuard = () => void;
let shadowCommandGuard: ShadowCommandGuard | null = null;

/** Blocks shadow-targeted commands when final timeline diverged mid-preview. */
export function setShadowCommandGuard({
	guard,
}: {
	guard: ShadowCommandGuard | null;
}): void {
	shadowCommandGuard = guard;
}

export function registerCommand<TArgs, TResult = unknown>({
	definition,
	handler,
}: {
	definition: CommandDefinition<z.ZodType<TArgs>>;
	handler: CommandHandler<TArgs, TResult>;
}): void {
	if (registry.has(definition.name)) {
		throw new Error(`Command already registered: ${definition.name}`);
	}
	registry.set(definition.name, {
		...definition,
		handler: handler as CommandHandler,
	});
}

export function getCommand({
	name,
}: {
	name: string;
}): RegisteredCommand | undefined {
	return registry.get(name);
}

export function listCommands(): RegisteredCommand[] {
	return [...registry.values()];
}

export function listAgentTools(): ReturnType<typeof toOpenRouterTool>[] {
	return listCommands()
		.filter((command) => command.exposeToAgent !== false)
		.map(toOpenRouterTool);
}

export async function executeCommand<TResult = unknown>({
	name,
	args,
	target = "final",
}: {
	name: string;
	args?: unknown;
	target?: CommandTarget;
}): Promise<TResult> {
	if (target === "shadow") {
		shadowCommandGuard?.();
	}

	const command = registry.get(name);
	if (!command) {
		throw new Error(`Unknown command: ${name}`);
	}

	const parsed = command.argsSchema.parse(args ?? {});
	const ctx: CommandContext = { target };
	return (await command.handler(parsed, ctx)) as TResult;
}

export function clearCommandRegistry(): void {
	registry.clear();
	shadowCommandGuard = null;
}

export function isCommandRegistered({ name }: { name: string }): boolean {
	return registry.has(name);
}
