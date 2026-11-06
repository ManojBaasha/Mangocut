/**
 * Generates the SerializedProject fixtures used by the Rust timeline crate's
 * round-trip tests (rust/crates/timeline/tests/fixtures/projects).
 *
 * Projects are built with the app's own element builders, keyframe helpers
 * and effect/mask registries, then serialized the way
 * `StorageService.saveProject` does (dates -> ISO strings).
 *
 * Run: bun run apps/web/scripts/timeline-parity/export-fixture-projects.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(
	here,
	"../../../../rust/crates/timeline/tests/fixtures/projects",
);

// The browser wasm package cannot initialise under bun; route app imports of
// `mangocut-wasm` to the node build of the same crate.
const nodeWasmPath = resolve(
	here,
	"../../../../rust/wasm/pkg-node/mangocut_wasm.js",
);
Bun.plugin({
	name: "mangocut-wasm-node",
	setup(build) {
		build.module("mangocut-wasm", async () => ({
			exports: await import(nodeWasmPath),
			loader: "object",
		}));
	},
});

const FIXED_DATE = "2026-01-01T00:00:00.000Z";
const FIXED_DATE_2 = "2026-01-02T12:30:00.000Z";

const { buildElementFromMedia, buildTextElement, buildEffectElement, buildStickerElement, buildGraphicElement, buildLibraryAudioElement } =
	await import("../../src/lib/timeline/element-utils");
const { upsertElementKeyframe } = await import("../../src/lib/animation/keyframes");
const { registerDefaultEffects, buildDefaultEffectInstance } = await import("../../src/lib/effects");
const { registerDefaultMasks, buildDefaultMaskInstance } = await import("../../src/lib/masks");

registerDefaultEffects();
registerDefaultMasks();

let counter = 0;
function withId<T extends object>(prefix: string, element: T): T & { id: string } {
	counter += 1;
	return { ...element, id: `${prefix}-${counter}` };
}

function buildProject({
	id,
	name,
	overlay,
	main,
	audio,
	bookmarks = [],
	settingsExtra = {},
}: {
	id: string;
	name: string;
	overlay: unknown[];
	main: unknown[];
	audio: unknown[];
	bookmarks?: unknown[];
	settingsExtra?: Record<string, unknown>;
}) {
	return {
		metadata: {
			id,
			name,
			duration: 1_000_000 * 10,
			createdAt: FIXED_DATE,
			updatedAt: FIXED_DATE_2,
		},
		scenes: [
			{
				id: `${id}-scene`,
				name: "Main scene",
				isMain: true,
				tracks: {
					overlay,
					main: {
						id: `${id}-main`,
						name: "Main Track",
						type: "video",
						elements: main,
						muted: false,
						hidden: false,
					},
					audio,
				},
				bookmarks,
				createdAt: FIXED_DATE,
				updatedAt: FIXED_DATE_2,
			},
		],
		currentSceneId: `${id}-scene`,
		settings: {
			fps: { numerator: 30, denominator: 1 },
			canvasSize: { width: 1920, height: 1080 },
			canvasSizeMode: "preset",
			originalCanvasSize: null,
			background: { type: "color", color: "#000000" },
			...settingsExtra,
		},
		version: 23,
		timelineViewState: { zoomLevel: 1, scrollLeft: 0, playheadTime: 0 },
	};
}

const T = 1_000_000;

// 1. keyframes on transform/opacity incl. a bezier segment
function keyframeProject() {
	counter = 0;
	const video = withId(
		"el",
		buildElementFromMedia({
			mediaId: "media-1",
			mediaType: "video",
			name: "clip.mp4",
			duration: 5 * T,
			startTime: 0,
		}),
	) as any;
	let animations = video.animations;
	animations = upsertElementKeyframe({ animations, propertyPath: "transform.positionX", time: 0, value: 0, keyframeId: "kf-1" });
	animations = upsertElementKeyframe({ animations, propertyPath: "transform.positionX", time: 2 * T, value: 120, interpolation: "bezier", keyframeId: "kf-2" });
	animations = upsertElementKeyframe({ animations, propertyPath: "transform.positionX", time: 4 * T, value: -40, interpolation: "hold", keyframeId: "kf-3" });
	animations = upsertElementKeyframe({ animations, propertyPath: "opacity", time: 0, value: 1, keyframeId: "kf-4" });
	animations = upsertElementKeyframe({ animations, propertyPath: "opacity", time: 3 * T, value: 0.25, interpolation: "linear", keyframeId: "kf-5" });
	animations = upsertElementKeyframe({ animations, propertyPath: "transform.rotate", time: T, value: 15, interpolation: "bezier", keyframeId: "kf-6" });
	animations = upsertElementKeyframe({ animations, propertyPath: "transform.rotate", time: 3 * T, value: 90, keyframeId: "kf-7" });
	video.animations = animations;
	video.retime = { rate: 1.5, maintainPitch: true };
	return buildProject({
		id: "fixture-keyframes",
		name: "Keyframes",
		overlay: [],
		main: [video],
		audio: [],
		bookmarks: [{ time: T, note: "intro", color: "#ff0000", duration: T / 2 }, { time: 3 * T }],
	});
}

// 2. effects and masks
function effectsMasksProject() {
	counter = 0;
	const video = withId(
		"el",
		buildElementFromMedia({ mediaId: "media-2", mediaType: "video", name: "b.mp4", duration: 6 * T, startTime: 0 }),
	) as any;
	const effect = { ...buildDefaultEffectInstance({ effectType: "blur" }), id: "effect-inst-1" };
	video.effects = [effect];
	const maskTypes = ["rectangle", "ellipse", "split", "heart"] as const;
	video.masks = maskTypes.map((maskType, i) => ({
		...buildDefaultMaskInstance({ maskType, elementSize: { width: 1920, height: 1080 } }),
		id: `mask-${i}`,
	}));
	video.blendMode = "multiply";
	const image = withId(
		"el",
		buildElementFromMedia({ mediaId: "media-3", mediaType: "image", name: "p.png", duration: 3 * T, startTime: 6 * T }),
	) as any;
	image.effects = [{ ...buildDefaultEffectInstance({ effectType: "blur" }), id: "effect-inst-2", enabled: false }];
	const effectElement = withId("el", buildEffectElement({ effectType: "blur", startTime: T, duration: 2 * T }));
	return buildProject({
		id: "fixture-effects-masks",
		name: "Effects and masks",
		overlay: [
			{ id: "track-effect", name: "Effects", type: "effect", elements: [effectElement], hidden: false },
		],
		main: [video, image],
		audio: [],
		settingsExtra: { background: { type: "blur", blurIntensity: 8 }, canvasSizeMode: "custom", lastCustomCanvasSize: { width: 1000, height: 1000 } },
	});
}

// 3. audio + text + sticker + graphic
function mixedProject() {
	counter = 0;
	const text = withId(
		"el",
		buildTextElement({ raw: { content: "Hello", fontSize: 24, background: { enabled: true, color: "#112233" } }, startTime: 0 }),
	) as any;
	text.animations = upsertElementKeyframe({ animations: undefined, propertyPath: "background.paddingX", time: 0, value: 10, keyframeId: "kf-t1" });
	const sticker = withId("el", buildStickerElement({ stickerId: "icons:heart-fill", startTime: T, intrinsicWidth: 64, intrinsicHeight: 64 }));
	let graphic: any;
	try {
		graphic = withId("el", buildGraphicElement({ definitionId: "rectangle", startTime: 2 * T }));
	} catch (e) {
		console.warn("graphic builder unavailable:", (e as Error).message);
	}
	const upload = withId(
		"el",
		buildElementFromMedia({ mediaId: "media-4", mediaType: "audio", name: "voice.wav", duration: 8 * T, startTime: 0 }),
	);
	const library = withId(
		"el",
		buildLibraryAudioElement({ sourceUrl: "https://example.com/song.mp3", name: "Song", duration: 4 * T, startTime: 8 * T }),
	) as any;
	library.retime = { rate: 0.75 };
	return buildProject({
		id: "fixture-audio-text",
		name: "Audio and text",
		overlay: [
			{ id: "track-text", name: "Text", type: "text", elements: [text], hidden: false },
			{ id: "track-graphic", name: "Graphics", type: "graphic", elements: [sticker, ...(graphic ? [graphic] : [])], hidden: true },
		],
		main: [],
		audio: [
			{ id: "track-audio-1", name: "Audio 1", type: "audio", elements: [upload], muted: false },
			{ id: "track-audio-2", name: "Audio 2", type: "audio", elements: [library], muted: true },
		],
	});
}

// 4. hand-written unknown fields (top-level and element-level)
function unknownFieldsProject() {
	const base: any = buildProject({
		id: "fixture-unknown",
		name: "Unknown fields",
		overlay: [],
		main: [
			{
				id: "el-1",
				type: "video",
				mediaId: "media-1",
				name: "x.mp4",
				duration: T,
				startTime: 0,
				trimStart: 0,
				trimEnd: 0,
				transform: { scaleX: 1, scaleY: 1, position: { x: 0, y: 0 }, rotate: 0 },
				opacity: 1,
				futureElementField: { nested: [1, 2, { three: 3 }], flag: true },
			},
		],
		audio: [],
	});
	base.scenes[0].tracks.audio.push({
		id: "track-audio",
		name: "Audio",
		type: "audio",
		muted: false,
		elements: [
			{
				id: "el-2",
				type: "audio",
				sourceType: "library",
				sourceUrl: "https://example.com/a.mp3",
				name: "a",
				duration: T,
				startTime: 0,
				trimStart: 0,
				trimEnd: 0,
				volume: 0.5,
				futureAudioField: [1, "two"],
			},
		],
	});
	base.futureField = { enabled: true, level: 3, tags: ["a", "b"] };
	base.metadata.futureMetadataField = "meta";
	base.settings.futureSettingsField = 42;
	base.scenes[0].futureSceneField = null;
	base.scenes[0].tracks.main.futureTrackField = "track";
	return base;
}

mkdirSync(outDir, { recursive: true });
const projects: Record<string, unknown> = {
	"keyframes.json": keyframeProject(),
	"effects-masks.json": effectsMasksProject(),
	"audio-text-graphics.json": mixedProject(),
	"unknown-fields.json": unknownFieldsProject(),
};
for (const [file, project] of Object.entries(projects)) {
	writeFileSync(resolve(outDir, file), `${JSON.stringify(project, null, "\t")}\n`);
	console.log(`wrote ${file}`);
}
