import type { SceneTracks } from "../../src/lib/timeline/types";
import type { TimelineOp } from "./harness";
import type { ElementAnimations } from "../../src/lib/animation/types";

// App modules must load after the harness has installed its wasm plugin and
// id mock, so import them dynamically, harness first.
await import("./harness");
const { updateScalarKeyframeCurve, upsertElementKeyframe, upsertPathKeyframe } =
	await import("../../src/lib/animation");

export interface ParityCase {
	name: string;
	input: SceneTracks;
	op: TimelineOp;
	newIds: string[];
	ripple?: boolean;
	/**
	 * Error code the Rust engine must return for this case. Set where TS
	 * silently no-ops on an unknown id, or where Rust is deliberately stricter
	 * than TS (e.g. `invalid_result` for an overlap). The golden still records
	 * what TS did.
	 */
	expectedError?: string;
}

export const FIXED_TRANSFORM = {
	scaleX: 1,
	scaleY: 1,
	position: { x: 0, y: 0 },
	rotate: 0,
};

export function videoElement({
	id,
	startTime = 0,
	duration = 120000,
}: {
	id: string;
	startTime?: number;
	duration?: number;
}) {
	return {
		type: "video" as const,
		id,
		mediaId: "media-1",
		name: "clip.mp4",
		duration,
		startTime,
		trimStart: 0,
		trimEnd: 0,
		sourceDuration: duration,
		muted: false,
		isSourceAudioEnabled: true,
		hidden: false,
		transform: FIXED_TRANSFORM,
		opacity: 1,
		blendMode: "normal" as const,
		volume: 0,
	};
}

export function scene({
	overlay = [],
	main,
	audio = [],
}: {
	overlay?: SceneTracks["overlay"];
	main: SceneTracks["main"];
	audio?: SceneTracks["audio"];
}): SceneTracks {
	return { overlay, main, audio };
}

const simpleScene: SceneTracks = scene({
	main: {
		id: "main",
		name: "Main Track",
		type: "video",
		elements: [videoElement({ id: "el-1" })],
		muted: false,
		hidden: false,
	} as SceneTracks["main"],
});

const overlayScene: SceneTracks = scene({
	overlay: [
		{
			id: "text-1",
			name: "Text track",
			type: "text",
			elements: [],
			hidden: false,
		},
	] as SceneTracks["overlay"],
	main: simpleScene.main,
	audio: [
		{
			id: "audio-1",
			name: "Audio track",
			type: "audio",
			elements: [],
			muted: false,
		},
	] as SceneTracks["audio"],
});

const videoInput = {
	type: "video" as const,
	mediaId: "media-2",
	name: "new.mp4",
	startTime: 0,
	duration: 60000,
	sourceDuration: 60000,
	muted: false,
	isSourceAudioEnabled: true,
	hidden: false,
	transform: FIXED_TRANSFORM,
	opacity: 1,
	blendMode: "normal" as const,
	volume: 0,
};

const emptyMainScene: SceneTracks = scene({
	main: {
		id: "main",
		name: "Main Track",
		type: "video",
		elements: [],
		muted: false,
		hidden: false,
	} as SceneTracks["main"],
});

function mainTrack(elements: unknown[]): SceneTracks["main"] {
	return {
		id: "main",
		name: "Main Track",
		type: "video",
		elements,
		muted: false,
		hidden: false,
	} as SceneTracks["main"];
}

const splitScene: SceneTracks = scene({
	main: mainTrack([
		videoElement({ id: "el-1" }),
		videoElement({ id: "el-2", startTime: 120000, duration: 60000 }),
	]),
	audio: [
		{
			id: "audio-1",
			name: "Audio track",
			type: "audio",
			elements: [
				{
					type: "audio",
					sourceType: "library",
					sourceUrl: "https://example.com/a.mp3",
					name: "Song",
					id: "au-1",
					startTime: 10000,
					duration: 50000,
					trimStart: 500,
					trimEnd: 700,
					volume: 1,
				},
			],
			muted: false,
		},
	] as SceneTracks["audio"],
});

function retimedScene({
	rate,
	duration,
	trimStart,
	trimEnd,
}: {
	rate: number;
	duration: number;
	trimStart: number;
	trimEnd: number;
}): SceneTracks {
	return scene({
		main: mainTrack([
			{
				...videoElement({ id: "el-1", duration }),
				trimStart,
				trimEnd,
				sourceDuration: 400000,
				retime: { rate, maintainPitch: true },
			},
		]),
	});
}

/**
 * Real keyframe data built with the app's own helpers (explicit keyframe ids so
 * the fixture is deterministic). Bindings are inserted non-alphabetically so
 * the golden proves boundary-id consumption follows insertion order.
 */
function buildSplitAnimations(): ElementAnimations | undefined {
	let animations: ElementAnimations | undefined;
	const scalarKeys: [string, number, number, "linear" | "bezier"][] = [
		["px-0", 0, 0, "linear"],
		["px-1", 30000, 100, "bezier"],
		["px-2", 90000, 200, "linear"],
		["px-3", 120000, 50, "linear"],
	];
	for (const [keyframeId, time, value, interpolation] of scalarKeys) {
		animations = upsertElementKeyframe({
			animations,
			propertyPath: "transform.positionX",
			time,
			value,
			interpolation,
			keyframeId,
		});
	}
	animations = updateScalarKeyframeCurve({
		animations,
		propertyPath: "transform.positionX",
		componentKey: "value",
		keyframeId: "px-1",
		patch: { rightHandle: { dt: 20000, dv: 80 } },
	});
	animations = updateScalarKeyframeCurve({
		animations,
		propertyPath: "transform.positionX",
		componentKey: "value",
		keyframeId: "px-2",
		patch: { leftHandle: { dt: -10000, dv: -30 } },
	});
	animations = upsertElementKeyframe({
		animations,
		propertyPath: "opacity",
		time: 10000,
		value: 1,
		interpolation: "linear",
		keyframeId: "op-0",
	});
	animations = upsertElementKeyframe({
		animations,
		propertyPath: "opacity",
		time: 100000,
		value: 0.25,
		interpolation: "linear",
		keyframeId: "op-1",
	});
	for (const [keyframeId, time, value] of [
		["c-0", 20000, "#ff0000"],
		["c-1", 70000, "#0000ff"],
	] as const) {
		animations = upsertElementKeyframe({
			animations,
			propertyPath: "color",
			time,
			value,
			interpolation: "linear",
			keyframeId,
		});
	}
	for (const [keyframeId, time, value] of [
		["m-0", 0, "a"],
		["m-1", 45000, "b"],
		["m-2", 80000, "c"],
	] as const) {
		animations = upsertPathKeyframe({
			animations,
			propertyPath: "params.mode",
			time,
			value,
			keyframeId,
			kind: "discrete",
			defaultInterpolation: "hold",
			coerceValue: ({ value: next }) => next,
		});
	}
	return animations;
}

const animatedScene: SceneTracks = scene({
	main: mainTrack([
		{ ...videoElement({ id: "el-1" }), animations: buildSplitAnimations() },
	]),
});

const moveScene: SceneTracks = scene({
	overlay: [
		{
			id: "video-2",
			name: "Overlay",
			type: "video",
			elements: [videoElement({ id: "el-b", startTime: 0, duration: 120000 })],
			muted: false,
			hidden: false,
		},
	] as SceneTracks["overlay"],
	main: mainTrack([videoElement({ id: "el-1" })]),
});

const splitEl1 = [{ trackId: "main", elementId: "el-1" }];

export const cases: ParityCase[] = [
	{
		name: "add_track_video_default",
		input: overlayScene,
		op: { type: "addTrack", trackType: "video" },
		newIds: ["new-track"],
	},
	{
		name: "add_track_audio_index_0",
		input: overlayScene,
		op: { type: "addTrack", trackType: "audio", index: 0 },
		newIds: ["new-track"],
	},
	{
		name: "remove_track_overlay",
		input: overlayScene,
		op: { type: "removeTrack", trackId: "text-1" },
		newIds: [],
	},
	{
		name: "toggle_visibility_text",
		input: overlayScene,
		op: { type: "toggleTrackVisibility", trackId: "text-1" },
		newIds: [],
	},
	{
		name: "toggle_mute_main",
		input: simpleScene,
		op: { type: "toggleTrackMute", trackId: "main" },
		newIds: [],
	},
	{
		name: "insert_video_auto_empty",
		input: emptyMainScene,
		op: {
			type: "insertElement",
			element: videoInput,
			placement: { mode: "auto" },
		},
		newIds: ["new-el"],
	},
	{
		name: "insert_video_auto_after_existing",
		input: simpleScene,
		op: {
			type: "insertElement",
			element: { ...videoInput, startTime: 120000 },
			placement: { mode: "auto" },
		},
		newIds: ["new-el"],
	},
	{
		name: "insert_text_auto_new_overlay",
		input: simpleScene,
		op: {
			type: "insertElement",
			element: {
				type: "text",
				name: "Title",
				content: "Hello",
				startTime: 0,
				fontSize: 15,
				fontFamily: "Arial",
				color: "#ffffff",
				background: { enabled: false },
				textAlign: "center",
				fontWeight: "normal",
				fontStyle: "normal",
				textDecoration: "none",
				transform: FIXED_TRANSFORM,
				opacity: 1,
			},
			placement: { mode: "auto" },
		},
		newIds: ["new-el", "new-track"],
	},
	{
		name: "insert_audio_explicit_track",
		input: overlayScene,
		op: {
			type: "insertElement",
			element: {
				type: "audio",
				sourceType: "library",
				sourceUrl: "https://example.com/a.mp3",
				name: "Song",
				startTime: 30000,
				volume: 1,
			},
			placement: { mode: "explicit", trackId: "audio-1" },
		},
		newIds: ["new-el"],
	},
	{
		name: "insert_image_on_occupied_span",
		input: simpleScene,
		op: {
			type: "insertElement",
			element: {
				type: "image",
				mediaId: "media-3",
				name: "pic.png",
				startTime: 0,
				duration: 60000,
				hidden: false,
				transform: FIXED_TRANSFORM,
				opacity: 1,
			},
			placement: { mode: "auto" },
		},
		newIds: ["new-el", "new-track"],
	},
	{
		name: "insert_video_explicit_incompatible_track",
		input: overlayScene,
		op: {
			type: "insertElement",
			element: videoInput,
			placement: { mode: "explicit", trackId: "text-1" },
		},
		newIds: ["new-el"],
	},
	{
		name: "split_plain_both",
		input: splitScene,
		op: {
			type: "splitElements",
			elements: [
				{ trackId: "audio-1", elementId: "au-1" },
				{ trackId: "main", elementId: "el-1" },
			],
			splitTime: 30000,
		},
		newIds: ["right-main", "right-audio"],
	},
	{
		name: "split_left",
		input: splitScene,
		op: {
			type: "splitElements",
			elements: splitEl1,
			splitTime: 30000,
			retainSide: "left",
		},
		newIds: [],
	},
	{
		name: "split_right",
		input: splitScene,
		op: {
			type: "splitElements",
			elements: splitEl1,
			splitTime: 30000,
			retainSide: "right",
		},
		newIds: ["right-1"],
	},
	{
		name: "split_retimed_rate_2",
		input: retimedScene({ rate: 2, duration: 60000, trimStart: 1000, trimEnd: 2000 }),
		op: { type: "splitElements", elements: splitEl1, splitTime: 25000 },
		newIds: ["right-1"],
	},
	{
		name: "split_retimed_fractional",
		input: retimedScene({ rate: 1.1, duration: 100000, trimStart: 1000, trimEnd: 2000 }),
		op: { type: "splitElements", elements: splitEl1, splitTime: 33333 },
		newIds: ["right-1"],
	},
	{
		name: "split_at_start_unchanged",
		input: splitScene,
		op: { type: "splitElements", elements: splitEl1, splitTime: 0 },
		newIds: ["right-1"],
	},
	{
		name: "split_at_end_unchanged",
		input: splitScene,
		op: { type: "splitElements", elements: splitEl1, splitTime: 120000 },
		newIds: ["right-1"],
	},
	{
		name: "split_keeps_keyframes_on_correct_side",
		input: animatedScene,
		op: { type: "splitElements", elements: splitEl1, splitTime: 60000 },
		newIds: [
			"px-left",
			"px-right",
			"op-left",
			"op-right",
			"c-left",
			"c-right",
			"m-left",
			"m-right",
			"right-1",
		],
	},
	// --- Task 7: trim, retime, move, delete, duplicate, update, ripple ---
	{
		name: "trim_start_end",
		input: splitScene,
		op: { type: "trimElement", elementId: "el-1", trimStart: 10000, trimEnd: 5000 },
		newIds: [],
	},
	{
		name: "trim_with_start_and_duration",
		input: splitScene,
		op: {
			type: "trimElement",
			elementId: "el-2",
			trimStart: 10000,
			trimEnd: 0,
			startTime: 130000,
			duration: 50000,
		},
		newIds: [],
	},
	{
		name: "trim_clamps_animations",
		input: animatedScene,
		op: { type: "trimElement", elementId: "el-1", trimStart: 0, trimEnd: 60000, duration: 60000 },
		newIds: ["px-left", "px-right", "op-left", "op-right", "c-left", "c-right", "m-left", "m-right"],
	},
	{
		name: "retime_rate_half",
		input: scene({ main: mainTrack([videoElement({ id: "el-1" })]) }),
		op: {
			type: "retimeElement",
			trackId: "main",
			elementId: "el-1",
			retime: { rate: 0.5, maintainPitch: true },
		},
		newIds: [],
	},
	{
		name: "retime_clear",
		input: retimedScene({ rate: 2, duration: 60000, trimStart: 1000, trimEnd: 2000 }),
		op: { type: "retimeElement", trackId: "main", elementId: "el-1", retime: null },
		newIds: [],
	},
	{
		name: "move_same_track",
		input: splitScene,
		op: {
			type: "moveElement",
			sourceTrackId: "main",
			targetTrackId: "main",
			elementId: "el-2",
			newStartTime: 200000,
		},
		newIds: [],
	},
	{
		name: "move_to_other_track",
		input: moveScene,
		op: {
			type: "moveElement",
			sourceTrackId: "main",
			targetTrackId: "video-2",
			elementId: "el-1",
			newStartTime: 130000,
		},
		newIds: [],
	},
	{
		name: "move_create_track",
		input: moveScene,
		op: {
			type: "moveElement",
			sourceTrackId: "main",
			targetTrackId: "created-track",
			elementId: "el-1",
			newStartTime: 7000,
			createTrack: { type: "video", index: 0 },
		},
		newIds: [],
	},
	{
		name: "move_onto_occupied",
		input: moveScene,
		op: {
			type: "moveElement",
			sourceTrackId: "main",
			targetTrackId: "video-2",
			elementId: "el-1",
			newStartTime: 150000,
		},
		newIds: [],
	},
	{
		name: "delete_one",
		input: splitScene,
		op: { type: "deleteElements", elements: [{ trackId: "main", elementId: "el-2" }] },
		newIds: [],
	},
	{
		name: "delete_many_across_tracks",
		input: splitScene,
		op: {
			type: "deleteElements",
			elements: [
				{ trackId: "main", elementId: "el-1" },
				{ trackId: "audio-1", elementId: "au-1" },
			],
		},
		newIds: [],
	},
	{
		name: "delete_ripple",
		input: splitScene,
		op: { type: "deleteElements", elements: [{ trackId: "main", elementId: "el-1" }] },
		newIds: [],
		ripple: true,
	},
	{
		name: "duplicate_two",
		input: splitScene,
		op: {
			type: "duplicateElements",
			elements: [
				{ trackId: "audio-1", elementId: "au-1" },
				{ trackId: "main", elementId: "el-1" },
			],
		},
		newIds: ["dup-main", "dup-main-track", "dup-audio", "dup-audio-track"],
	},
	{
		name: "duplicate_regenerates_keyframe_ids",
		input: animatedScene,
		op: { type: "duplicateElements", elements: splitEl1 },
		newIds: [
			"dup-el",
			"k1",
			"k2",
			"k3",
			"k4",
			"k5",
			"k6",
			"k7",
			"k8",
			"k9",
			"k10",
			"k11",
			"dup-track",
		],
	},
	{
		name: "update_transform",
		input: splitScene,
		op: {
			type: "updateElements",
			updates: [
				{
					trackId: "main",
					elementId: "el-1",
					patch: {
						transform: { scaleX: 1.5, scaleY: 1.5, position: { x: 10, y: -20 }, rotate: 15 },
					},
				},
			],
		},
		newIds: [],
	},
	{
		name: "update_opacity_and_volume",
		input: splitScene,
		op: {
			type: "updateElements",
			updates: [
				{ trackId: "main", elementId: "el-1", patch: { opacity: 0.5, volume: -6 } },
				{ trackId: "audio-1", elementId: "au-1", patch: { volume: 0.25 } },
			],
		},
		newIds: [],
	},
	// --- Task 8: agent error contract (TS no-ops, Rust returns typed errors) ---
	{
		name: "move_overlapping_is_invalid_result",
		input: moveScene,
		op: {
			type: "moveElement",
			sourceTrackId: "main",
			targetTrackId: "video-2",
			elementId: "el-1",
			newStartTime: 100000,
		},
		newIds: [],
		// TS lets the move overlap el-b; Rust refuses the invalid result.
		expectedError: "invalid_result",
	},
	{
		name: "split_unknown_element",
		input: splitScene,
		op: {
			type: "splitElements",
			elements: [{ trackId: "main", elementId: "missing" }],
			splitTime: 30000,
		},
		newIds: ["right"],
		expectedError: "element_not_found",
	},
	{
		name: "delete_unknown_element",
		input: splitScene,
		op: {
			type: "deleteElements",
			elements: [{ trackId: "main", elementId: "missing" }],
		},
		newIds: [],
		expectedError: "element_not_found",
	},
	{
		name: "delete_unknown_track",
		input: splitScene,
		op: {
			type: "deleteElements",
			elements: [{ trackId: "nope", elementId: "el-1" }],
		},
		newIds: [],
		expectedError: "track_not_found",
	},
	{
		name: "update_unknown_element",
		input: splitScene,
		op: {
			type: "updateElements",
			updates: [{ trackId: "main", elementId: "missing", patch: { opacity: 0 } }],
		},
		newIds: [],
		expectedError: "element_not_found",
	},
	{
		name: "update_unknown_track",
		input: splitScene,
		op: {
			type: "updateElements",
			updates: [{ trackId: "nope", elementId: "el-1", patch: { opacity: 0 } }],
		},
		newIds: [],
		expectedError: "track_not_found",
	},
	{
		name: "trim_unknown_element",
		input: splitScene,
		op: { type: "trimElement", elementId: "missing", trimStart: 0, trimEnd: 0 },
		newIds: [],
		expectedError: "element_not_found",
	},
	{
		name: "retime_unknown_element",
		input: splitScene,
		op: {
			type: "retimeElement",
			trackId: "main",
			elementId: "missing",
			retime: { rate: 2, maintainPitch: true },
		},
		newIds: [],
		expectedError: "element_not_found",
	},
	{
		name: "duplicate_unknown_element",
		input: splitScene,
		op: {
			type: "duplicateElements",
			elements: [{ trackId: "main", elementId: "missing" }],
		},
		newIds: ["copy", "track"],
		expectedError: "element_not_found",
	},
];
