import type { SpeechSegment } from "@/lib/ai/speech/speech-ranges";

const DEFAULT_FILLERS = new Set([
	"um",
	"uh",
	"uhm",
	"erm",
	"ah",
	"like",
	"youknow",
	"you",
	"know",
]);

function normalizeToken(text: string): string {
	return text.toLowerCase().replace(/[^a-z']/g, "");
}

export function findFillerRanges({
	segments,
	fillers = DEFAULT_FILLERS,
}: {
	segments: SpeechSegment[];
	fillers?: Set<string>;
}): Array<SpeechSegment> {
	const out: SpeechSegment[] = [];
	for (const segment of segments) {
		const tokens = segment.text
			.trim()
			.split(/\s+/)
			.map(normalizeToken)
			.filter(Boolean);
		if (tokens.length === 0) continue;
		// Whole segment is filler words only (um / uh / like)
		if (tokens.every((t) => fillers.has(t))) {
			out.push(segment);
			continue;
		}
		// Special-case "you know" as two tokens spanning the segment
		if (
			tokens.length === 2 &&
			tokens[0] === "you" &&
			tokens[1] === "know"
		) {
			out.push(segment);
		}
	}
	return out;
}
