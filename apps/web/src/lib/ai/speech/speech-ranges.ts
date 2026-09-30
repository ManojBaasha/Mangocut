export interface SpeechSegment {
	start: number;
	end: number;
	text: string;
}

export interface TimeRange {
	start: number;
	end: number;
}

export function buildKeepRanges({
	segments,
	minGapSeconds = 0.35,
}: {
	segments: SpeechSegment[];
	minGapSeconds?: number;
}): TimeRange[] {
	const sorted = [...segments]
		.filter((s) => s.end > s.start)
		.sort((a, b) => a.start - b.start);
	if (sorted.length === 0) return [];

	const ranges: TimeRange[] = [
		{ start: sorted[0].start, end: sorted[0].end },
	];
	for (let i = 1; i < sorted.length; i++) {
		const current = sorted[i];
		const last = ranges[ranges.length - 1];
		if (current.start - last.end <= minGapSeconds) {
			last.end = Math.max(last.end, current.end);
		} else {
			ranges.push({ start: current.start, end: current.end });
		}
	}
	return ranges;
}

export function buildSilenceCutPoints({
	segments,
	minGapSeconds = 0.75,
	mediaDurationSeconds,
}: {
	segments: SpeechSegment[];
	minGapSeconds?: number;
	mediaDurationSeconds?: number;
}): number[] {
	const ranges = buildKeepRanges({ segments, minGapSeconds: 0 });
	const cuts: number[] = [];
	for (let i = 0; i < ranges.length - 1; i++) {
		const gapStart = ranges[i].end;
		const gapEnd = ranges[i + 1].start;
		if (gapEnd - gapStart >= minGapSeconds) {
			cuts.push((gapStart + gapEnd) / 2);
		}
	}
	if (
		mediaDurationSeconds != null &&
		ranges.length > 0 &&
		mediaDurationSeconds - ranges[ranges.length - 1].end >= minGapSeconds
	) {
		// trailing silence: no mid cut needed for split_on_gaps
	}
	if (ranges.length > 0 && ranges[0].start >= minGapSeconds) {
		// leading silence: optional cut after leading silence start
	}
	return cuts.map((t) => Math.round(t * 1000) / 1000);
}

export function mediaTimeToTimelineTime({
	mediaTimeSeconds,
	elementStartSeconds,
	trimStartSeconds,
}: {
	mediaTimeSeconds: number;
	elementStartSeconds: number;
	trimStartSeconds: number;
}): number {
	return elementStartSeconds + (mediaTimeSeconds - trimStartSeconds);
}

/** Ranges of media time that should be deleted (silence between keep ranges). */
export function buildDeleteRanges({
	keepRanges,
	mediaDurationSeconds,
}: {
	keepRanges: TimeRange[];
	mediaDurationSeconds: number;
}): TimeRange[] {
	if (keepRanges.length === 0) {
		return mediaDurationSeconds > 0
			? [{ start: 0, end: mediaDurationSeconds }]
			: [];
	}
	const deletes: TimeRange[] = [];
	if (keepRanges[0].start > 0) {
		deletes.push({ start: 0, end: keepRanges[0].start });
	}
	for (let i = 0; i < keepRanges.length - 1; i++) {
		deletes.push({
			start: keepRanges[i].end,
			end: keepRanges[i + 1].start,
		});
	}
	const last = keepRanges[keepRanges.length - 1];
	if (last.end < mediaDurationSeconds) {
		deletes.push({ start: last.end, end: mediaDurationSeconds });
	}
	return deletes.filter((r) => r.end - r.start > 1e-3);
}
