export type { CommandTarget, CommandContext, CommandDefinition } from "./types";
export { toOpenRouterTool } from "./types";
export {
	registerCommand,
	getCommand,
	listCommands,
	listAgentTools,
	executeCommand,
	isCommandRegistered,
	clearCommandRegistry,
	setShadowCommandGuard,
} from "./registry";
export { registerEditorCommands } from "./register-editor-commands";
export { registerVisionCommands } from "./register-vision-commands";
export { registerTranscriptionCommands } from "./register-transcription-commands";
export { registerMemoryCommands } from "./register-memory-commands";
