import * as wasm from "mangocut-wasm";
import { createTimelineApi } from "./timeline-core";

export {
	type ApplyTimelineOpOptions,
	type OpOutput,
	type SceneTracks,
	type TimelineOp,
	TimelineOpError,
} from "./timeline-core";

export const { applyTimelineOp, validateTimelineTracks } =
	createTimelineApi(wasm);
