import {
	mergeVisionMemory,
	parseVisionResponse,
	type MediaVisionMemory,
	type VisionFrameMemory,
} from "./merge";
import type { CapturedFrame } from "./capture";
import { aiRequestHeaders } from "@/lib/ai/device-id";

const DEFAULT_VISION_MODEL = "google/gemini-2.5-flash";

export async function describeCapturedFrames({
	frames,
	prompt,
	model,
	assetName,
}: {
	frames: CapturedFrame[];
	prompt?: string;
	model?: string;
	assetName: string;
}): Promise<{
	vision: MediaVisionMemory;
	rawText: string;
}> {
	if (frames.length === 0) {
		throw new Error("No frames to describe");
	}

	const timesList = frames.map((f) => f.timeSeconds.toFixed(2)).join(", ");
	const userText =
		prompt?.trim() ||
		`Describe these frames from the video/image "${assetName}" at times [${timesList}] seconds. Return JSON: {"summary":"...","frames":[{"timeSeconds":number,"description":"..."}]}`;

	const content: Array<
		| { type: "text"; text: string }
		| { type: "image_url"; image_url: { url: string } }
	> = [{ type: "text", text: userText }];
	for (const frame of frames) {
		content.push({
			type: "text",
			text: `Frame at t=${frame.timeSeconds.toFixed(2)}s`,
		});
		content.push({
			type: "image_url",
			image_url: { url: frame.dataUrl },
		});
	}

	const res = await fetch("/api/ai/vision", {
		method: "POST",
		headers: aiRequestHeaders(),
		credentials: "include",
		body: JSON.stringify({
			model: model || DEFAULT_VISION_MODEL,
			messages: [
				{
					role: "user",
					content,
				},
			],
		}),
	});

	const data = (await res.json()) as {
		error?: string;
		text?: string;
	};
	if (!res.ok) {
		throw new Error(data.error || "Vision request failed");
	}
	const rawText = data.text?.trim() || "";
	const parsed = parseVisionResponse({ text: rawText });
	const now = new Date().toISOString();
	const frameMemories: VisionFrameMemory[] =
		parsed.frames.length > 0
			? parsed.frames.map((frame) => ({
					timeSeconds: frame.timeSeconds,
					description: frame.description,
					capturedAt: now,
				}))
			: frames.map((frame, index) => ({
					timeSeconds: frame.timeSeconds,
					description:
						index === 0 && parsed.summary
							? parsed.summary
							: `Frame at ${frame.timeSeconds.toFixed(2)}s`,
					capturedAt: now,
				}));

	return {
		rawText,
		vision: mergeVisionMemory({
			existing: null,
			incoming: {
				summary: parsed.summary,
				frames: frameMemories,
			},
			now,
		}),
	};
}

export function applyVisionMerge({
	existing,
	incoming,
}: {
	existing?: MediaVisionMemory | null;
	incoming: MediaVisionMemory;
}): MediaVisionMemory {
	return mergeVisionMemory({
		existing,
		incoming: {
			summary: incoming.summary,
			frames: incoming.frames ?? [],
		},
		now: incoming.updatedAt ?? new Date().toISOString(),
	});
}
