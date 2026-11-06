import type { SceneTracks } from "../../src/lib/timeline/types";
import type { TimelineOp } from "./harness";

export interface ParityCase {
	name: string;
	input: SceneTracks;
	op: TimelineOp;
	newIds: string[];
	ripple?: boolean;
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
];
