"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useAiChatStore } from "@/stores/ai-chat-store";
import { runAgentTurn } from "@/lib/ai/agent";
import { executeCommand } from "@/lib/commands-api";
import { useEditor } from "@/hooks/use-editor";
import { cn } from "@/utils/ui";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Send, Trash2 } from "lucide-react";
import { authClient } from "@/lib/auth/client";
import {
	aiFetch,
	clearStoredAiBearer,
	getStoredAiBearer,
	openDesktopAiBridge,
} from "@/lib/ai/cloud-fetch";
import { formatUsd, recordProjectAiUsage } from "@/lib/ai/project-usage";
import { isMangocutDesktop } from "@/lib/ai/desktop";
import { isCloudAiMode } from "@/lib/site/cloud";

function isAffirmativeMerge({ text }: { text: string }): boolean {
	const t = text.trim().toLowerCase();
	if (!t) return false;
	return /^(yes|y|yeah|yep|approve|accept|merge|lgtm|looks good|ship it|ok)\b/.test(
		t,
	);
}

function withReviewPrompt({ text }: { text: string }): string {
	const base = text.trim() || "Done.";
	if (/ai (preview|changes)|timeline|merge|looks good/i.test(base)) {
		return base;
	}
	return `${base}\n\nPlease review the AI changes on the timeline (Main vs AI changes). If it looks good, reply “yes” here or click Merge on the timeline.`;
}

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
	const [spentUsd, setSpentUsd] = useState<number | null>(null);
	const [spendLimitUsd, setSpendLimitUsd] = useState<number | null>(null);
	const [trialExhausted, setTrialExhausted] = useState(false);
	const [googleConfigured, setGoogleConfigured] = useState(false);
	const [authenticated, setAuthenticated] = useState(false);
	const listRef = useRef<HTMLDivElement>(null);
	const editor = useEditor();
	const hasShadow = useEditor((e) => e.shadow.hasShadow());
	const diverged = useEditor((e) => e.shadow.isFinalDiverged());
	const session = authClient.useSession();

	useEffect(() => {
		if (!isOpen) return;
		void refreshEntitlements();
	}, [isOpen, session.data?.user?.id]);

	async function refreshEntitlements() {
		try {
			const res = await aiFetch("/api/ai/entitlements", {
				method: "GET",
			});
			const data = (await res.json()) as {
				remaining?: number;
				limit?: number;
				spentUsd?: number;
				spendLimitUsd?: number | null;
				trialExhausted?: boolean;
				googleConfigured?: boolean;
				authenticated?: boolean;
			};
			setRemaining(data.remaining ?? null);
			setLimit(data.limit ?? null);
			setSpentUsd(typeof data.spentUsd === "number" ? data.spentUsd : null);
			setSpendLimitUsd(
				typeof data.spendLimitUsd === "number" ? data.spendLimitUsd : null,
			);
			setTrialExhausted(Boolean(data.trialExhausted));
			setGoogleConfigured(Boolean(data.googleConfigured));
			setAuthenticated(Boolean(data.authenticated));
		} catch {
			// non-fatal
		}
	}

	if (!isOpen) return null;

	const signedIn = Boolean(session.data?.user?.id) || authenticated;
	const needsCloudBridge =
		isCloudAiMode() && Boolean(session.data?.user?.id) && !getStoredAiBearer();
	const canUseAi = signedIn && !trialExhausted && !needsCloudBridge;

	async function onSend() {
		const text = input.trim();
		if (!text || isStreaming) return;
		if (!authenticated) {
			setError("Sign in with Google to start your free AI trial.");
			return;
		}
		if (trialExhausted) {
			setError(
				"Free AI trial is over. Manual editing still works — AI is paused.",
			);
			return;
		}

		if (hasShadow && isAffirmativeMerge({ text })) {
			setInput("");
			setError(null);
			addMessage({ role: "user", content: text });
			try {
				await executeCommand({ name: "ai_accept_preview" });
				addMessage({
					role: "assistant",
					content: "Merged AI changes into the main timeline.",
				});
			} catch (err) {
				setError(err instanceof Error ? err.message : "Merge failed");
			}
			return;
		}

		if (diverged) {
			setError(
				"Main timeline changed while AI changes exist. Merge or Discard on the timeline first.",
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

			const { assistantText, toolChips, costUsd } = await runAgentTurn({
				userMessage: text,
				history,
				model,
				sessionId: useAiChatStore.getState().sessionId,
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
				content: withReviewPrompt({ text: assistantText }),
				toolCalls: toolChips,
			});
			const projectId = editor.project.getActiveOrNull()?.metadata.id;
			if (projectId) {
				recordProjectAiUsage({ projectId, costUsd });
			}
			if (editor.shadow.hasShadow()) {
				editor.shadow.setViewMode({ mode: "shadow" });
			}
			void refreshEntitlements();
		} catch (err) {
			const message = err instanceof Error ? err.message : "Agent failed";
			setError(message);
			updateMessage(assistantId, {
				content: `Error: ${message}`,
			});
			void refreshEntitlements();
		} finally {
			setStreaming(false);
			listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
		}
	}

	const trialLabel =
		remaining != null && limit != null
			? `${remaining}/${limit} free AI turns left`
			: "Free AI trial";

	return (
		<aside className="bg-background border-l flex h-full w-[min(100%,22rem)] shrink-0 flex-col">
			<div className="border-b flex items-center justify-between gap-2 px-3 py-2">
				<div className="min-w-0">
					<p className="text-sm font-medium">Mangocut AI</p>
					<p className="text-muted-foreground truncate text-[11px]">
						{authenticated ? (
							trialExhausted ? (
								<Link
									href="/settings"
									className="hover:text-foreground underline-offset-2 hover:underline"
								>
									Free trial ended
								</Link>
							) : (
								<Link
									href="/settings"
									className="hover:text-foreground underline-offset-2 hover:underline"
								>
									{trialLabel}
								</Link>
							)
						) : (
							"Sign in for free AI trial"
						)}
					</p>
				</div>
				<div className="flex items-center gap-1">
					<Button
						variant="ghost"
						size="icon"
						className="size-7"
						onClick={() => clearMessages()}
						aria-label="Clear chat"
						disabled={!canUseAi}
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

			{!signedIn ? (
				<div className="flex flex-1 flex-col items-start justify-center gap-3 px-4 py-6">
					<p className="text-sm font-medium">Start your free AI trial</p>
					<p className="text-muted-foreground text-xs leading-relaxed">
						Sign in with Google to use Mangocut AI. There is no payment —
						AI pauses when your free trial quota is used up. Manual editing
						always works.
					</p>
					{googleConfigured ? (
						<Button
							size="sm"
							onClick={() =>
								void authClient.signIn.social({
									provider: "google",
									callbackURL: window.location.href,
								})
							}
						>
							Sign in with Google
						</Button>
					) : (
						<p className="text-muted-foreground text-xs">
							Google sign-in is not configured on this server.
						</p>
					)}
				</div>
			) : needsCloudBridge ? (
				<div className="flex flex-1 flex-col items-start justify-center gap-3 px-4 py-6">
					<p className="text-sm font-medium">Connect AI session</p>
					<p className="text-muted-foreground text-xs leading-relaxed">
						Finish linking this app to the hosted Mangocut AI trial. A browser
						window will open; sign in if asked, then return here.
					</p>
					<Button size="sm" onClick={() => openDesktopAiBridge()}>
						Connect AI session
					</Button>
				</div>
			) : trialExhausted ? (
				<div className="flex flex-1 flex-col items-start justify-center gap-3 px-4 py-6">
					<p className="text-sm font-medium">Free AI trial is over</p>
					<p className="text-muted-foreground text-xs leading-relaxed">
						You&apos;ve used your free AI quota
						{spentUsd != null
							? ` (${formatUsd({ amount: spentUsd })} OpenRouter spend`
							: ""}
						{spendLimitUsd != null
							? ` of ${formatUsd({ amount: spendLimitUsd })} limit)`
							: spentUsd != null
								? ")"
								: ""}
						. Keep editing manually — timeline, media, and export still work.
						There is no payment flow in this version.
					</p>
					<Button asChild size="sm" variant="outline">
						<Link href="/settings">View usage in Settings</Link>
					</Button>
				</div>
			) : (
				<>
					<div className="border-b flex items-center justify-between gap-2 px-3 py-2">
						<p className="text-muted-foreground truncate text-[11px]">
							{session.data?.user?.email ?? "Signed in"}
						</p>
						<Button
							size="sm"
							variant="outline"
							className="h-7 text-xs"
							onClick={() => {
								clearStoredAiBearer();
								void authClient.signOut();
							}}
						>
							Sign out
						</Button>
					</div>

					{diverged ? (
						<p className="bg-accent text-muted-foreground px-3 py-2 text-[11px]">
							Main timeline changed while AI changes exist. Use Merge or
							Discard on the timeline toolbar.
						</p>
					) : null}

					<div className="px-3 py-2">
						<label
							className="text-muted-foreground text-[11px]"
							htmlFor="ai-model"
						>
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
								Ask me to cut, arrange, grade, or package clips. Free trial —
								no payment. Changes stage as AI changes on the timeline; review
								Main vs AI changes, then merge or reply “yes”.
								{!isMangocutDesktop() ? (
									<>
										{" "}
										On web, upload media in the app — folder import and some AI
										tools need the desktop app.
									</>
								) : null}
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
													chip.status === "done" &&
														"border-muted-foreground/40",
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
							placeholder="Ask Mangocut AI…"
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
				</>
			)}
		</aside>
	);
}
