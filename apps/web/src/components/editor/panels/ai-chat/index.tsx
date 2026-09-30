"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAiChatStore } from "@/stores/ai-chat-store";
import { runAgentTurn } from "@/lib/ai/agent";
import { executeCommand } from "@/lib/commands-api";
import { useEditor } from "@/hooks/use-editor";
import { isMangocutDesktop } from "@/lib/ai/desktop";
import { cn } from "@/utils/ui";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Send, Trash2 } from "lucide-react";
import { authClient } from "@/lib/auth/client";
import { aiRequestHeaders } from "@/lib/ai/device-id";

export function AiChatSidebar() {
	const isOpen = useAiChatStore((s) => s.isOpen);
	const setOpen = useAiChatStore((s) => s.setOpen);
	const messages = useAiChatStore((s) => s.messages);
	const isStreaming = useAiChatStore((s) => s.isStreaming);
	const model = useAiChatStore((s) => s.model);
	const setModel = useAiChatStore((s) => s.setModel);
	const error = useAiChatStore((s) => s.error);
	const addMessage = useAiChatStore((s) => s.addMessage);
	const updateMessage = useAiChatStore((s) => s.updateMessage);
	const setStreaming = useAiChatStore((s) => s.setStreaming);
	const setError = useAiChatStore((s) => s.setError);
	const clearMessages = useAiChatStore((s) => s.clearMessages);
	const [input, setInput] = useState("");
	const [remaining, setRemaining] = useState<number | null>(null);
	const [limit, setLimit] = useState<number | null>(null);
	const [googleConfigured, setGoogleConfigured] = useState(false);
	const [authenticated, setAuthenticated] = useState(false);
	const listRef = useRef<HTMLDivElement>(null);
	const editor = useEditor();
	const viewMode = useEditor((e) => e.shadow.getViewMode());
	const hasShadow = useEditor((e) => e.shadow.hasShadow());
	const diverged = useEditor((e) => e.shadow.isFinalDiverged());
	const session = authClient.useSession();

	useEffect(() => {
		if (!isOpen) return;
		void refreshEntitlements();
	}, [isOpen, session.data?.user?.id]);

	async function refreshEntitlements() {
		try {
			const res = await fetch("/api/ai/entitlements", {
				headers: aiRequestHeaders(),
				credentials: "include",
			});
			const data = (await res.json()) as {
				remaining?: number;
				limit?: number;
				googleConfigured?: boolean;
				authenticated?: boolean;
			};
			setRemaining(data.remaining ?? null);
			setLimit(data.limit ?? null);
			setGoogleConfigured(Boolean(data.googleConfigured));
			setAuthenticated(Boolean(data.authenticated));
		} catch {
			// non-fatal
		}
	}

	if (!isOpen) return null;

	const desktop = isMangocutDesktop();
	const canUseAi = desktop || authenticated;

	async function onSend() {
		const text = input.trim();
		if (!text || isStreaming) return;
		if (!canUseAi) {
			setError(
				"Sign in to use Mangocut AI on the web, or open the desktop app.",
			);
			return;
		}
		if (diverged) {
			setError(
				"Final timeline changed while AI Preview exists. Accept, Reject, or Reset first.",
			);
			return;
		}

		setInput("");
		setError(null);
		addMessage({ role: "user", content: text });
		const assistantId = addMessage({
			role: "assistant",
			content: "",
			toolCalls: [],
		});
		setStreaming(true);

		try {
			const history = useAiChatStore
				.getState()
				.messages.filter((m) => m.id !== assistantId)
				.filter((m) => m.role === "user" || m.role === "assistant")
				.map((m) => ({
					role: m.role as "user" | "assistant",
					content: m.content,
				}));

			const { assistantText, toolChips } = await runAgentTurn({
				userMessage: text,
				history,
				model,
				onToolCall: (chip) => {
					const current = useAiChatStore
						.getState()
						.messages.find((m) => m.id === assistantId);
					const existing = current?.toolCalls ?? [];
					const next = existing.some((c) => c.id === chip.id)
						? existing.map((c) => (c.id === chip.id ? chip : c))
						: [...existing, chip];
					updateMessage(assistantId, { toolCalls: next });
				},
			});

			updateMessage(assistantId, {
				content: assistantText || "Done.",
				toolCalls: toolChips,
			});
			editor.shadow.setViewMode({ mode: "shadow" });
			void refreshEntitlements();
		} catch (err) {
			const message = err instanceof Error ? err.message : "Agent failed";
			setError(message);
			updateMessage(assistantId, {
				content: `Error: ${message}`,
			});
		} finally {
			setStreaming(false);
			listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
		}
	}

	return (
		<aside className="bg-background border-l flex h-full w-[min(100%,22rem)] shrink-0 flex-col">
			<div className="border-b flex items-center justify-between gap-2 px-3 py-2">
				<div className="min-w-0">
					<p className="text-sm font-medium">Mangocut AI</p>
					<p className="text-muted-foreground truncate text-[11px]">
						Edits land in AI Preview
						{remaining != null && limit != null
							? ` · ${remaining}/${limit} turns`
							: ""}
					</p>
				</div>
				<div className="flex items-center gap-1">
					<Button
						variant="ghost"
						size="icon"
						className="size-7"
						onClick={() => clearMessages()}
						aria-label="Clear chat"
					>
						<Trash2 className="size-3.5" />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						className="size-7"
						onClick={() => setOpen(false)}
						aria-label="Close AI chat"
					>
						<HugeiconsIcon icon={Cancel01Icon} className="size-3.5" />
					</Button>
				</div>
			</div>

			{googleConfigured ? (
				<div className="border-b flex items-center justify-between gap-2 px-3 py-2">
					<p className="text-muted-foreground text-[11px]">
						{authenticated
							? `Signed in as ${session.data?.user?.email ?? "account"}`
							: "Not signed in"}
					</p>
					{authenticated ? (
						<Button
							size="sm"
							variant="outline"
							className="h-7 text-xs"
							onClick={() => void authClient.signOut()}
						>
							Sign out
						</Button>
					) : (
						<Button
							size="sm"
							variant="default"
							className="h-7 text-xs"
							onClick={() =>
								void authClient.signIn.social({
									provider: "google",
									callbackURL: window.location.href,
								})
							}
						>
							Google
						</Button>
					)}
				</div>
			) : null}

			<div className="border-b flex flex-wrap items-center gap-1.5 px-3 py-2">
				<div className="bg-muted flex rounded-md p-0.5 text-xs">
					<button
						type="button"
						className={cn(
							"rounded px-2 py-1",
							viewMode === "final" && "bg-background shadow-sm",
						)}
						onClick={() =>
							executeCommand({
								name: "ai_set_view_mode",
								args: { mode: "final" },
							})
						}
					>
						Final
					</button>
					<button
						type="button"
						className={cn(
							"rounded px-2 py-1",
							viewMode === "shadow" && "bg-background shadow-sm",
							!hasShadow && "opacity-50",
						)}
						disabled={!hasShadow}
						onClick={() =>
							executeCommand({
								name: "ai_set_view_mode",
								args: { mode: "shadow" },
							})
						}
					>
						AI Preview
					</button>
				</div>
				<Button
					size="sm"
					variant="default"
					className="h-7 text-xs"
					disabled={!hasShadow}
					onClick={() => executeCommand({ name: "ai_accept_preview" })}
				>
					Accept
				</Button>
				<Button
					size="sm"
					variant="outline"
					className="h-7 text-xs"
					disabled={!hasShadow}
					onClick={() => executeCommand({ name: "ai_reject_preview" })}
				>
					Reject
				</Button>
				<Button
					size="sm"
					variant="outline"
					className="h-7 text-xs"
					disabled={!hasShadow}
					onClick={() => executeCommand({ name: "ai_reset_preview" })}
				>
					Reset
				</Button>
			</div>

			{diverged ? (
				<p className="bg-accent text-muted-foreground px-3 py-2 text-[11px]">
					Final timeline changed. Accept, Reject, or Reset AI Preview before
					continuing.
				</p>
			) : null}

			<div className="px-3 py-2">
				<label className="text-muted-foreground text-[11px]" htmlFor="ai-model">
					Model
				</label>
				<input
					id="ai-model"
					className="border-input bg-background mt-1 w-full rounded-md border px-2 py-1.5 text-xs"
					value={model}
					onChange={(e) => setModel(e.target.value)}
					disabled={isStreaming}
				/>
			</div>

			<div
				ref={listRef}
				className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-2"
			>
				{messages.length === 0 ? (
					<p className="text-muted-foreground text-xs leading-relaxed">
						Ask me to import clips from folders, cut, arrange, grade, or compile
						— I&apos;ll stage changes in AI Preview.
					</p>
				) : null}
				{messages.map((message) => (
					<div key={message.id} className="space-y-1.5">
						<p
							className={cn(
								"text-xs font-medium",
								message.role === "user"
									? "text-foreground"
									: "text-muted-foreground",
							)}
						>
							{message.role === "user" ? "You" : "Assistant"}
						</p>
						{message.toolCalls?.length ? (
							<div className="flex flex-wrap gap-1">
								{message.toolCalls.map((chip) => (
									<span
										key={chip.id}
										className={cn(
											"rounded-full border px-2 py-0.5 text-[10px]",
											chip.status === "error" &&
												"border-destructive text-destructive",
											chip.status === "done" && "border-muted-foreground/40",
											chip.status === "running" && "border-primary/50",
										)}
										title={chip.detail}
									>
										{chip.name}
									</span>
								))}
							</div>
						) : null}
						<p className="text-xs whitespace-pre-wrap leading-relaxed">
							{message.content}
						</p>
					</div>
				))}
			</div>

			{error ? (
				<p className="text-destructive px-3 pb-1 text-[11px]">{error}</p>
			) : null}

			<div className="border-t flex items-end gap-2 p-3">
				<textarea
					className="border-input bg-background min-h-[2.5rem] max-h-28 flex-1 resize-none rounded-md border px-2 py-1.5 text-xs"
					placeholder={
						canUseAi ? "Ask Mangocut AI…" : "Sign in to use AI on web…"
					}
					value={input}
					disabled={isStreaming || !canUseAi}
					onChange={(e) => setInput(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							void onSend();
						}
					}}
				/>
				<Button
					size="icon"
					className="size-8 shrink-0"
					disabled={isStreaming || !input.trim() || !canUseAi}
					onClick={() => void onSend()}
					aria-label="Send"
				>
					<Send className="size-3.5" />
				</Button>
			</div>
		</aside>
	);
}
