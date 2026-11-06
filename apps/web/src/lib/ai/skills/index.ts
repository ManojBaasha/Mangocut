/**
 * Edit skill packs the agent loads with get_edit_skill.
 * Inlined so they bundle for the browser and Electron (no fs at runtime).
 */
export const EDIT_SKILLS: Record<string, string> = {
	"broll-pace": "B-roll pacing skill for Mangocut AI.\n\n1. search_media for each beat the user describes.\n2. place_media in story order with short durations.\n3. Optional list_grades / apply_grade for look consistency.\n4. inspect_playhead on each cut; assert_edit_quality.\n5. Keep narration audio if present; don't overwrite without asking.\n",
	"highlight-reel": "Highlight reel / Shorts skill for Mangocut AI.\n\n1. propose_edit_plan: find_highlights \u2192 package_highlights \u2192 captions \u2192 verify duration.\n2. Transcribe the source interview/vlog if needed.\n3. find_highlights with maxClips 3 and targetSeconds ~30\u201345.\n4. package_highlights onto AI Preview.\n5. insert_captions if speech-heavy.\n6. assert_edit_quality; report clip quotes to the user for Accept.\n",
	"talking-head-cleanup": "Talking-head cleanup skill for Mangocut AI.\n\n1. propose_edit_plan with steps: transcribe \u2192 remove fillers \u2192 cut silence gaps \u2192 captions optional \u2192 verify.\n2. Prefer search_media / get_project_summary to find the interview clip.\n3. place_media if not on timeline.\n4. transcribe_media, then remove_filler_words / cut_on_speech keep_speech.\n5. assert_edit_quality + inspect_playhead near mid-talking section.\n6. Summarize for the user; they Accept AI Preview.\n",
};
