"use client";

import { create } from "zustand";

export type AiChatRole = "user" | "assistant" | "system" | "tool";

export interface AiToolCallChip {
	id: string;
	name: string;
	status: "running" | "done" | "error";
	detail?: string;
}

export interface AiChatMessage {
	id: string;
	role: AiChatRole;
	content: string;
	toolCalls?: AiToolCallChip[];
	createdAt: number;
}

interface AiUiState {
	isOpen: boolean;
	isStreaming: boolean;
	model: string;
	messages: AiChatMessage[];
	error: string | null;
	setOpen: (open: boolean) => void;
	toggleOpen: () => void;
	setModel: (model: string) => void;
	setStreaming: (streaming: boolean) => void;
	setError: (error: string | null) => void;
	addMessage: (message: Omit<AiChatMessage, "id" | "createdAt"> & { id?: string }) => string;
	updateMessage: (id: string, patch: Partial<AiChatMessage>) => void;
	clearMessages: () => void;
}

export const useAiChatStore = create<AiUiState>((set) => ({
	isOpen: false,
	isStreaming: false,
	model: "openai/gpt-4.1-mini",
	messages: [],
	error: null,
	setOpen: (open) => set({ isOpen: open }),
	toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),
	setModel: (model) => set({ model }),
	setStreaming: (isStreaming) => set({ isStreaming }),
	setError: (error) => set({ error }),
	addMessage: (message) => {
		const id = message.id ?? crypto.randomUUID();
		set((s) => ({
			messages: [
				...s.messages,
				{
					...message,
					id,
					createdAt: Date.now(),
				},
			],
		}));
		return id;
	},
	updateMessage: (id, patch) =>
		set((s) => ({
			messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
		})),
	clearMessages: () => set({ messages: [], error: null }),
}));
