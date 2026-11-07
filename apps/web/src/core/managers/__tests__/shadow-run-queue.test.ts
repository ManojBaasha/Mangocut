import { describe, expect, mock, test } from "bun:test";

// shadow-manager imports the timeline command module, which pulls in wasm;
// these tests only exercise runOnShadow's scene swapping.
mock.module("@/lib/commands/timeline", () => ({
	TracksSnapshotCommand: class {},
}));

const { ShadowManager } = await import("../shadow-manager");

type Tracks = { main: { id: string; elements: { id: string }[] } };

function fakeEditor(initial: Tracks) {
	let scene = { id: "s1", tracks: initial };
	const scenes = {
		getActiveScene: () => scene,
		getActiveSceneOrNull: () => scene,
		getScenes: () => [scene],
		setScenes: ({ scenes: list }: { scenes: (typeof scene)[] }) => {
			scene = list[0];
		},
	};
	return { scenes, current: () => scene.tracks } as const;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

describe("ShadowManager.runOnShadow", () => {
	test("overlapping runs do not overwrite the preview with the final timeline", async () => {
		const editor = fakeEditor({ main: { id: "main", elements: [] } });
		const shadow = new ShadowManager(editor as never);

		// Run 1 adds a clip to the preview after an await, like an import.
		const addClip = shadow.runOnShadow(async () => {
			await tick();
			const tracks = editor.current();
			tracks.main.elements.push({ id: "clip-1" });
			editor.scenes.setScenes({
				scenes: [{ id: "s1", tracks: structuredClone(tracks) }],
			});
		});
		// Run 2 starts before run 1 finishes, like two parallel reads.
		const read = shadow.runOnShadow(async () => {
			await tick();
			return editor.current().main.elements.length;
		});

		await addClip;
		expect(await read).toBe(1);
		expect(shadow.getShadowTracks()?.main.elements.map((e) => e.id)).toEqual([
			"clip-1",
		]);
		// The user's (final) timeline is untouched.
		expect(editor.current().main.elements).toEqual([]);
	});

	test("a failing run does not block later runs", async () => {
		const editor = fakeEditor({ main: { id: "main", elements: [] } });
		const shadow = new ShadowManager(editor as never);
		await expect(
			shadow.runOnShadow(() => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		expect(await shadow.runOnShadow(() => "next")).toBe("next");
	});
});
