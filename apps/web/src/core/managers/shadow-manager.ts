import type { EditorCore } from "@/core";
import type { SceneTracks } from "@/lib/timeline";
import { TracksSnapshotCommand } from "@/lib/commands/timeline";

export type TimelineViewMode = "final" | "shadow";

function cloneTracks(tracks: SceneTracks): SceneTracks {
	return structuredClone(tracks);
}

/**
 * AI Preview staging: agent edits land on a shadow copy of the active scene
 * tracks. Accept commits shadow → final; Reject discards shadow.
 */
export class ShadowManager {
	private shadowTracks: SceneTracks | null = null;
	/** Final tracks as of last ensure/accept while a shadow session is open. */
	private finalTracks: SceneTracks | null = null;
	private viewMode: TimelineViewMode = "final";
	private listeners = new Set<() => void>();
	private executingShadow = false;
	/** Monotonic counter of final-timeline mutations while a shadow session exists. */
	private finalGeneration = 0;
	/** Generation captured when the current shadow session was created/reset. */
	private shadowBaseGeneration = 0;

	constructor(private editor: EditorCore) {}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		this.listeners.forEach((fn) => {
			fn();
		});
	}

	hasShadow(): boolean {
		return this.shadowTracks !== null;
	}

	getViewMode(): TimelineViewMode {
		return this.viewMode;
	}

	getShadowTracks(): SceneTracks | null {
		return this.shadowTracks;
	}

	getFinalGeneration(): number {
		return this.finalGeneration;
	}

	getShadowBaseGeneration(): number {
		return this.shadowBaseGeneration;
	}

	/**
	 * Call when the final timeline is mutated while a preview session is open.
	 * Ignored during shadow execution or when viewing the shadow timeline.
	 */
	noteFinalMutation(): void {
		if (!this.shadowTracks || this.executingShadow) return;
		if (this.viewMode === "shadow") return;
		this.finalGeneration += 1;
		this.notify();
	}

	isFinalDiverged(): boolean {
		if (!this.shadowTracks) return false;
		return this.finalGeneration !== this.shadowBaseGeneration;
	}

	ensureShadow(): SceneTracks {
		const active = this.editor.scenes.getActiveScene();
		if (!this.shadowTracks) {
			this.finalTracks = cloneTracks(active.tracks);
			this.shadowTracks = cloneTracks(active.tracks);
			this.shadowBaseGeneration = this.finalGeneration;
			this.notify();
		}
		return this.shadowTracks;
	}

	setViewMode({ mode }: { mode: TimelineViewMode }): void {
		if (mode === this.viewMode) return;

		if (mode === "shadow") {
			this.ensureShadow();
			if (this.shadowTracks) {
				this.captureFinalFromScene();
				this.applyTracksToSceneSilent({ tracks: this.shadowTracks });
			}
		} else if (this.finalTracks) {
			if (this.shadowTracks && this.viewMode === "shadow") {
				this.shadowTracks = cloneTracks(
					this.editor.scenes.getActiveScene().tracks,
				);
			}
			this.applyTracksToSceneSilent({ tracks: this.finalTracks });
		}

		this.viewMode = mode;
		this.notify();
	}

	/**
	 * Run a mutation against the shadow timeline without flipping the user's
	 * visible view mode (unless they are already previewing shadow).
	 */
	async runOnShadow<T>(fn: () => T | Promise<T>): Promise<T> {
		this.ensureShadow();
		const wasViewingShadow = this.viewMode === "shadow";
		const sceneBefore = cloneTracks(this.editor.scenes.getActiveScene().tracks);

		if (!wasViewingShadow && this.shadowTracks) {
			this.applyTracksToSceneSilent({ tracks: this.shadowTracks });
		}

		this.executingShadow = true;
		try {
			const result = await fn();
			this.shadowTracks = cloneTracks(
				this.editor.scenes.getActiveScene().tracks,
			);
			return result;
		} finally {
			this.executingShadow = false;
			if (!wasViewingShadow) {
				this.applyTracksToSceneSilent({ tracks: sceneBefore });
			}
			this.notify();
		}
	}

	isExecutingShadow(): boolean {
		return this.executingShadow;
	}

	accept(): void {
		if (!this.shadowTracks) return;

		if (this.viewMode === "shadow") {
			this.shadowTracks = cloneTracks(
				this.editor.scenes.getActiveScene().tracks,
			);
		}

		const before = cloneTracks(
			this.finalTracks ?? this.editor.scenes.getActiveScene().tracks,
		);
		const after = cloneTracks(this.shadowTracks);

		const command = new TracksSnapshotCommand(before, after);
		this.editor.command.execute({ command });

		this.finalTracks = cloneTracks(after);
		this.shadowTracks = null;
		this.shadowBaseGeneration = this.finalGeneration;
		this.viewMode = "final";
		this.notify();
	}

	reject(): void {
		if (this.finalTracks) {
			this.applyTracksToSceneSilent({ tracks: this.finalTracks });
		}
		this.shadowTracks = null;
		this.finalTracks = null;
		this.shadowBaseGeneration = this.finalGeneration;
		this.viewMode = "final";
		this.notify();
	}

	resetFromFinal(): void {
		const active = this.editor.scenes.getActiveScene();
		this.finalTracks = cloneTracks(active.tracks);
		this.shadowTracks = cloneTracks(active.tracks);
		this.shadowBaseGeneration = this.finalGeneration;
		if (this.viewMode === "shadow") {
			this.applyTracksToSceneSilent({ tracks: this.shadowTracks });
		}
		this.notify();
	}

	private captureFinalFromScene(): void {
		if (this.viewMode === "final") {
			this.finalTracks = cloneTracks(
				this.editor.scenes.getActiveScene().tracks,
			);
		}
	}

	/** Update in-memory scene tracks without undo / project dirty side effects beyond notify. */
	private applyTracksToSceneSilent({ tracks }: { tracks: SceneTracks }): void {
		const scenes = this.editor.scenes;
		const active = scenes.getActiveSceneOrNull();
		if (!active) return;

		const updated = {
			...active,
			tracks: cloneTracks(tracks),
			updatedAt: new Date(),
		};
		const list = scenes.getScenes().map((s) =>
			s.id === active.id ? updated : s,
		);
		scenes.setScenes({ scenes: list, activeSceneId: active.id });
	}
}
