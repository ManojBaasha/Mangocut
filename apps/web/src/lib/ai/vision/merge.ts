export interface VisionFrameMemory {
	timeSeconds: number;
	description: string;
	capturedAt: string;
}

export interface MediaVisionMemory {
	summary?: string;
	updatedAt?: string;
	frames?: VisionFrameMemory[];
}

export const DEFAULT_FRAME_TIMES = [0, 0.5, 1] as const;

export function normalizeFrameTimes({
	timesSeconds,
	durationSeconds,
}: {
	timesSeconds?: number[];
	durationSeconds?: number | null;
}): number[] {
	const duration =
		durationSeconds != null && durationSeconds > 0 ? durationSeconds : 1;
	const raw =
		timesSeconds && timesSeconds.length > 0
			? timesSeconds
			: DEFAULT_FRAME_TIMES.map((fraction) => fraction * duration);
	const clamped = raw.map((t) => {
		const n = Number.isFinite(t) ? t : 0;
		return Math.min(Math.max(0, n), duration);
	});
	return [...new Set(clamped.map((t) => Math.round(t * 1000) / 1000))].sort(
		(a, b) => a - b,
	);
}

export function mergeVisionMemory({
	existing,
	incoming,
	now,
}: {
	existing?: MediaVisionMemory | null;
	incoming: {
		summary?: string;
		frames: VisionFrameMemory[];
	};
	now: string;
}): MediaVisionMemory {
	const byTime = new Map<number, VisionFrameMemory>();
	for (const frame of existing?.frames ?? []) {
		byTime.set(frame.timeSeconds, frame);
	}
	for (const frame of incoming.frames) {
		byTime.set(frame.timeSeconds, frame);
	}
	const frames = [...byTime.values()].sort(
		(a, b) => a.timeSeconds - b.timeSeconds,
	);
	return {
		summary: incoming.summary ?? existing?.summary,
		updatedAt: now,
		frames,
	};
}

export function parseVisionResponse({
	text,
}: {
	text: string;
}): {
	summary: string;
	frames: Array<{ timeSeconds: number; description: string }>;
} {
	const fenced = text.match(/```json\s*([\s\S]*?)```/i);
	const candidate = fenced?.[1]?.trim() ?? text.trim();
	try {
		const start = candidate.indexOf("{");
		const end = candidate.lastIndexOf("}");
		if (start >= 0 && end > start) {
			const json = JSON.parse(candidate.slice(start, end + 1)) as {
				summary?: unknown;
				frames?: unknown;
			};
			const frames = Array.isArray(json.frames)
				? json.frames
						.map((item) => {
							if (!item || typeof item !== "object") return null;
							const row = item as {
								timeSeconds?: unknown;
								description?: unknown;
							};
							if (
								typeof row.timeSeconds !== "number" ||
								typeof row.description !== "string"
							) {
								return null;
							}
							return {
								timeSeconds: row.timeSeconds,
								description: row.description,
							};
						})
						.filter(
							(item): item is { timeSeconds: number; description: string } =>
								item !== null,
						)
				: [];
			const summary =
				typeof json.summary === "string" && json.summary.trim()
					? json.summary.trim()
					: frames.map((f) => f.description).join(" ") || text.trim();
			return { summary, frames };
		}
	} catch {
		// fall through
	}
	return { summary: text.trim(), frames: [] };
}
