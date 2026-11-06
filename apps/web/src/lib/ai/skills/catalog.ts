export interface EditSkillMeta {
	id: string;
	title: string;
}

const SKILLS: Record<string, string> = {
	"talking-head-cleanup": `Talking-head cleanup skill for Mangocut AI.

1. propose_edit_plan with steps: transcribe → remove fillers → cut silence gaps → captions optional → verify.
2. Prefer search_media / get_project_summary to find the interview clip.
3. place_media if not on timeline.
4. transcribe_media, then remove_filler_words / cut_on_speech keep_speech.
5. assert_edit_quality + inspect_playhead near mid-talking section.
6. Summarize for the user; they Accept AI Preview.
`,
	"highlight-reel": `Highlight reel / Shorts skill for Mangocut AI.

1. propose_edit_plan: find_highlights → package_highlights → captions → verify duration.
2. Transcribe the source interview/vlog if needed.
3. find_highlights with maxClips 3 and targetSeconds ~30–45.
4. package_highlights onto AI Preview.
5. insert_captions if speech-heavy.
6. assert_edit_quality; report clip quotes to the user for Accept.
`,
	"broll-pace": `B-roll pacing skill for Mangocut AI.

1. search_media for each beat the user describes.
2. place_media in story order with short durations.
3. Optional list_grades / apply_grade for look consistency.
4. inspect_playhead on each cut; assert_edit_quality.
5. Keep narration audio if present; don't overwrite without asking.
`,
};

function titleFromId({ id }: { id: string }): string {
	return id
		.split("-")
		.map((p) => p.charAt(0).toUpperCase() + p.slice(1))
		.join(" ");
}

export function listEditSkills(): EditSkillMeta[] {
	return Object.keys(SKILLS).map((id) => ({
		id,
		title: titleFromId({ id }),
	}));
}

export function getEditSkill({ id }: { id: string }): string | null {
	const safe = id.replace(/[^a-z0-9-]/gi, "");
	return SKILLS[safe] ?? null;
}
