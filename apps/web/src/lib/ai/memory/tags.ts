const STOP = new Set([
	"a",
	"an",
	"the",
	"and",
	"or",
	"to",
	"of",
	"in",
	"on",
	"at",
	"for",
	"with",
	"from",
	"is",
	"are",
	"was",
	"were",
	"this",
	"that",
	"it",
	"as",
	"by",
	"be",
	"mp4",
	"mov",
	"wav",
	"mp3",
]);

const MAX_TAGS = 12;

export function deriveMediaTags({
	name,
	visionSummary,
	transcriptText,
}: {
	name?: string;
	visionSummary?: string;
	transcriptText?: string;
}): string[] {
	const blob = [name, visionSummary, transcriptText]
		.filter(Boolean)
		.join(" ")
		.toLowerCase();
	const counts = new Map<string, number>();
	for (const raw of blob.split(/[^a-z0-9]+/g)) {
		const token = raw.trim();
		if (token.length < 3 || STOP.has(token)) continue;
		counts.set(token, (counts.get(token) ?? 0) + 1);
	}
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.slice(0, MAX_TAGS)
		.map(([tag]) => tag);
}
