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

export const cases: ParityCase[] = [
	{
		name: "toggle_mute_main",
		input: simpleScene,
		op: { type: "toggleTrackMute", trackId: "main" },
		newIds: [],
	},
];
