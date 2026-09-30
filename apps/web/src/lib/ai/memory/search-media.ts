import type { MediaAssetData } from "@/services/storage/types";

export interface MediaSearchHit {
	mediaId: string;
	name: string;
	score: number;
	snippet: string;
	reasons: string[];
}

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
]);

export function tokenizeQuery({ query }: { query: string }): string[] {
	return query
		.toLowerCase()
		.split(/[^a-z0-9]+/g)
		.map((t) => t.trim())
		.filter((t) => t.length >= 2 && !STOP.has(t));
}

function collectCorpus({ asset }: { asset: MediaAssetData }): {
	name: string;
	vision: string;
	transcript: string;
	tags: string;
} {
	const visionParts = [
		asset.vision?.summary ?? "",
		...(asset.vision?.frames?.map((f) => f.description) ?? []),
	];
	const transcriptParts = asset.transcript?.segments.map((s) => s.text) ?? [];
	return {
		name: asset.name.toLowerCase(),
		vision: visionParts.join(" ").toLowerCase(),
		transcript: transcriptParts.join(" ").toLowerCase(),
		tags: (asset.tags ?? []).join(" ").toLowerCase(),
	};
}

export function searchMediaAssets({
	assets,
	query,
	limit = 8,
}: {
	assets: MediaAssetData[];
	query: string;
	limit?: number;
}): MediaSearchHit[] {
	const tokens = tokenizeQuery({ query });
	if (tokens.length === 0) return [];

	const hits: MediaSearchHit[] = [];
	for (const asset of assets) {
		const corpus = collectCorpus({ asset });
		let score = 0;
		const reasons: string[] = [];
		const matchedIn = new Set<string>();

		for (const token of tokens) {
			if (corpus.name.includes(token)) {
				score += 3;
				matchedIn.add("name");
			}
			if (corpus.tags.includes(token)) {
				score += 4;
				matchedIn.add("tags");
			}
			if (corpus.vision.includes(token)) {
				score += 5;
				matchedIn.add("vision");
			}
			if (corpus.transcript.includes(token)) {
				score += 5;
				matchedIn.add("transcript");
			}
		}

		if (score <= 0) continue;

		for (const reason of matchedIn) reasons.push(reason);

		let snippet = asset.vision?.summary || "";
		if (!snippet && asset.transcript?.segments[0]) {
			snippet = asset.transcript.segments[0].text;
		}
		if (!snippet) snippet = asset.name;

		hits.push({
			mediaId: asset.id,
			name: asset.name,
			score,
			snippet: snippet.slice(0, 180),
			reasons,
		});
	}

	hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
	return hits.slice(0, Math.max(1, limit));
}
