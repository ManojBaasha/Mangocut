import type { SpeechSegment } from "@/lib/ai/speech/speech-ranges";

export interface HighlightCandidate {
	start: number;
	end: number;
	score: number;
	quote: string;
}

const BOOST = ["important", "breakthrough", "secret", "tip", "why", "how", "never", "always"];

export function rankHighlights({
	segments,
	maxClips = 3,
	targetSeconds = 30,
	minSeconds = 4,
}: {
	segments: SpeechSegment[];
	maxClips?: number;
	targetSeconds?: number;
	minSeconds?: number;
}): HighlightCandidate[] {
	const sorted = [...segments]
		.filter((s) => s.end > s.start && s.text.trim().length > 0)
		.sort((a, b) => a.start - b.start);

	const windows: HighlightCandidate[] = [];
	for (let i = 0; i < sorted.length; i++) {
		let endIdx = i;
		let end = sorted[i].end;
		const parts = [sorted[i].text.trim()];
		while (
			endIdx + 1 < sorted.length &&
			end - sorted[i].start < targetSeconds
		) {
			endIdx += 1;
			end = sorted[endIdx].end;
			parts.push(sorted[endIdx].text.trim());
		}
		const start = sorted[i].start;
		const duration = end - start;
		if (duration < minSeconds) continue;
		const quote = parts.join(" ");
		const lower = quote.toLowerCase();
		let score = Math.min(duration, targetSeconds);
		if (quote.includes("?")) score += 4;
		for (const word of BOOST) {
			if (lower.includes(word)) score += 2;
		}
		if (/^\s*(um|uh|okay|ok|so)\b/i.test(quote)) score -= 2;
		windows.push({
			start,
			end,
			score,
			quote: quote.slice(0, 220),
		});
	}

	windows.sort((a, b) => b.score - a.score);
	const picked: HighlightCandidate[] = [];
	for (const candidate of windows) {
		const overlaps = picked.some(
			(p) => !(candidate.end <= p.start || candidate.start >= p.end),
		);
		if (overlaps) continue;
		picked.push(candidate);
		if (picked.length >= maxClips) break;
	}
	return picked;
}
