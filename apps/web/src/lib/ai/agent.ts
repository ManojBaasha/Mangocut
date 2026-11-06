import { listAgentTools, executeCommand } from "@/lib/commands-api";
import { EditorCore } from "@/core";
import { getDesktopApi, isMangocutDesktop } from "@/lib/ai/desktop";
import { aiRequestHeaders, getOrCreateDeviceId } from "@/lib/ai/device-id";
import {
	clearActiveTurn,
	notePreviewTrace,
	setActiveTurnStep,
	startTurnTrace,
	type TurnTrace,
} from "@/lib/ai/observability/client";
import type { TraceContext, TurnStatus } from "@/lib/ai/observability/shared";

const SYSTEM_PROMPT = `You are Mangocut AI, an assistant inside a video editor.
You edit via tools. All timeline mutations apply to the AI Preview (shadow) timeline.
The user must Accept to commit into the final timeline.
Prefer get_project_summary or get_timeline_overview before editing; use get_timeline_detail to drill into clips.
When the user describes content (not a filename), call search_media first, then place_media with the best mediaId.
If the user wants media that is already in the project (listed in get_project_summary assets), use place_media with that asset's mediaId or mediaName. Do NOT call import_media_paths for already-imported assets.
Filesystem import tools (list_dir, glob_media, import_media_paths) only work in the Mangocut desktop app. On web, ask the user to upload media in the UI or use desktop for disk import.
For visual understanding of a clip, call get_media_vision first; if empty, call describe_media (this persists frame descriptions). Prefer stored vision over re-describing.
After multi-step edits, use assert_edit_quality and/or inspect_playhead to verify the preview.
For complex requests: propose_edit_plan, then act, then verify_edit_plan. Use list_edit_skills / get_edit_skill for recipes (talking-head-cleanup, highlight-reel, broll-pace).
For speech: transcribe_media / get_transcript, remove_filler_words, cut_on_speech, find_highlights, package_highlights, insert_captions.
When grading, list_grades then apply_grade. Be concise.`;

function agentMaxSteps(): number {
	const raw = Number(process.env.AI_AGENT_MAX_STEPS ?? "24");
	if (!Number.isFinite(raw)) return 24;
	return Math.min(48, Math.max(8, Math.floor(raw)));
}

export interface AgentChatTurn {
	role: "user" | "assistant" | "tool" | "system";
	content: string;
	tool_call_id?: string;
	tool_calls?: Array<{
		id: string;
		type: "function";
		function: { name: string; arguments: string };
	}>;
}

type ToolChip = {
	id: string;
	name: string;
	status: "running" | "done" | "error";
	detail?: string;
};

type AgentTurnResult = { assistantText: string; toolChips: ToolChip[] };

/**
 * Runs one agent turn. Each turn is one Langfuse trace (see
 * lib/ai/observability): model calls are traced server-side, tool calls are
 * reported from here, and the outcome is recorded when the turn ends.
 */
export async function runAgentTurn({
	userMessage,
	history,
	model,
	sessionId,
	onToolCall,
}: {
	userMessage: string;
	history: AgentChatTurn[];
	model: string;
	/** Chat conversation id (Langfuse session). */
	sessionId: string;
	onToolCall?: (chip: {
		id: string;
		name: string;
		status: "running" | "done" | "error";
		detail?: string;
	}) => void;
}): Promise<AgentTurnResult> {
	const maxSteps = agentMaxSteps();
	const turn = startTurnTrace({
		sessionId,
		platform: isMangocutDesktop() ? "desktop" : "web",
		model,
		maxSteps,
		userMessage,
	});
	let steps = 0;
	const finish = (
		result: AgentTurnResult,
		status: TurnStatus,
	): AgentTurnResult => {
		if (turn.toolCalls > 0) notePreviewTrace(turn.traceId);
		void turn.end({ status, output: result.assistantText, steps });
		return result;
	};
	try {
		return await runAgentLoop({
			userMessage,
			history,
			model,
			maxSteps,
			turn,
			onStep: (step) => {
				steps = step + 1;
				setActiveTurnStep(turn, step);
			},
			onToolCall,
			finish,
		});
	} catch (error) {
		if (turn.toolCalls > 0) notePreviewTrace(turn.traceId);
		void turn.end({
			status: "error",
			output: "",
			steps,
			error: error instanceof Error ? error.message : String(error),
		});
		throw error;
	} finally {
		clearActiveTurn(turn);
	}
}

async function runAgentLoop({
	userMessage,
	history,
	model,
	maxSteps,
	turn,
	onStep,
	onToolCall,
	finish,
}: {
	userMessage: string;
	history: AgentChatTurn[];
	model: string;
	maxSteps: number;
	turn: TurnTrace;
	onStep: (step: number) => void;
	onToolCall?: (chip: ToolChip) => void;
	finish: (result: AgentTurnResult, status: TurnStatus) => AgentTurnResult;
}): Promise<AgentTurnResult> {
	const editor = EditorCore.getInstance();
	editor.shadow.ensureShadow();

	const tools = listAgentTools();
	const messages: AgentChatTurn[] = [
		{ role: "system", content: SYSTEM_PROMPT },
		...history,
		{ role: "user", content: userMessage },
	];

	const toolChips: ToolChip[] = [];

	const desktop = getDesktopApi();
	let verifyFailStreak = 0;

	for (let step = 0; step < maxSteps; step++) {
		onStep(step);
		if (step > 0 && step % 6 === 0) {
			messages.push({
				role: "system",
				content: `Checkpoint: tool-round ${step}/${maxSteps}. Summarize progress briefly in your next reply if done; otherwise continue the plan and call verify_edit_plan before finishing.`,
			});
		}

		const response = await callChatApi({
			messages,
			model,
			tools,
			desktop,
			trace: turn.context(step),
		});

		const assistant = response.message;
		messages.push({
			role: "assistant",
			content: assistant.content ?? "",
			tool_calls: assistant.tool_calls,
		});

		if (!assistant.tool_calls?.length) {
			return finish(
				{ assistantText: assistant.content ?? "", toolChips },
				"completed",
			);
		}

		for (const call of assistant.tool_calls) {
			const chip = {
				id: call.id,
				name: call.function.name,
				status: "running" as const,
			};
			toolChips.push(chip);
			onToolCall?.(chip);

			let result: unknown;
			let args: unknown = call.function.arguments;
			let toolError: string | undefined;
			const toolStart = Date.now();
			try {
				args = JSON.parse(call.function.arguments || "{}") as unknown;
				result = await executeCommand({
					name: call.function.name,
					args,
					target: "shadow",
				});
				if (call.function.name === "verify_edit_plan") {
					const passed = Boolean(
						result &&
							typeof result === "object" &&
							"passed" in result &&
							(result as { passed: boolean }).passed,
					);
					verifyFailStreak = passed ? 0 : verifyFailStreak + 1;
				}
				const done = {
					id: call.id,
					name: call.function.name,
					status: "done" as const,
					detail: summarizeResult(result),
				};
				const idx = toolChips.findIndex((c) => c.id === call.id);
				if (idx >= 0) toolChips[idx] = done;
				onToolCall?.(done);
			} catch (error) {
				toolError = error instanceof Error ? error.message : String(error);
				result = { error: toolError };
				const failed = {
					id: call.id,
					name: call.function.name,
					status: "error" as const,
					detail: String((result as { error: string }).error),
				};
				const idx = toolChips.findIndex((c) => c.id === call.id);
				if (idx >= 0) toolChips[idx] = failed;
				onToolCall?.(failed);
			}

			turn.recordTool({
				step,
				toolCallId: call.id,
				name: call.function.name,
				target: "shadow",
				args,
				result,
				error: toolError,
				startTime: toolStart,
			});

			messages.push({
				role: "tool",
				tool_call_id: call.id,
				content: JSON.stringify(result),
			});
		}

		if (verifyFailStreak >= 2) {
			return finish(
				{
					assistantText:
						"I hit repeated verify failures on the edit plan. Please review the AI Preview, adjust the request, or Accept/Reject what is there.",
					toolChips,
				},
				"verify_failed",
			);
		}
	}

	return finish(
		{
			assistantText:
				"Stopped after too many tool steps. Try a narrower request.",
			toolChips,
		},
		"max_steps",
	);
}

async function callChatApi({
	messages,
	model,
	tools,
	desktop,
	trace,
}: {
	messages: AgentChatTurn[];
	model: string;
	tools: unknown[];
	desktop: ReturnType<typeof getDesktopApi>;
	trace: TraceContext;
}): Promise<{
	message: {
		role: string;
		content: string | null;
		tool_calls?: AgentChatTurn["tool_calls"];
	};
}> {
	if (isMangocutDesktop() && desktop?.ai?.chat) {
		// Electron main forwards the body (incl. `trace`) to the local Next server.
		return desktop.ai.chat({
			messages,
			model,
			tools,
			trace,
			deviceId: getOrCreateDeviceId(),
		} as never);
	}

	const res = await fetch("/api/ai/chat", {
		method: "POST",
		headers: aiRequestHeaders(),
		credentials: "include",
		body: JSON.stringify({ messages, model, tools, trace }),
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(text || `Chat proxy failed (${res.status})`);
	}
	return res.json();
}

function summarizeResult(result: unknown): string {
	if (result == null) return "ok";
	if (typeof result === "string") return result.slice(0, 120);
	try {
		return JSON.stringify(result).slice(0, 120);
	} catch {
		return "ok";
	}
}
