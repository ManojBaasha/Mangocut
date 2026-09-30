import type { EditorCore } from "@/core";
import { toast } from "sonner";
import type { MediaAsset } from "@/lib/media/types";
import type {
	MediaTranscriptMemory,
	MediaVisionMemory,
} from "@/services/storage/types";
import { storageService } from "@/services/storage/service";
import { generateUUID } from "@/utils/id";
import { videoCache } from "@/services/video-cache/service";
import { BatchCommand, RemoveMediaAssetCommand } from "@/lib/commands";

export class MediaManager {
	private assets: MediaAsset[] = [];
	private isLoading = false;
	private listeners = new Set<() => void>();

	constructor(private editor: EditorCore) {}

	async addMediaAsset({
		projectId,
		asset,
	}: {
		projectId: string;
		asset: Omit<MediaAsset, "id">;
	}): Promise<MediaAsset | null> {
		const newAsset: MediaAsset = {
			...asset,
			id: generateUUID(),
		};

		this.assets = [...this.assets, newAsset];
		this.notify();

		try {
			await storageService.saveMediaAsset({ projectId, mediaAsset: newAsset });
			this.editor.project.ratchetFpsForImportedMedia({
				importedAssets: [newAsset],
			});
			return newAsset;
		} catch (error) {
			console.error("Failed to save media asset:", error);
			this.assets = this.assets.filter((asset) => asset.id !== newAsset.id);
			this.notify();

			if (storageService.isQuotaExceededError({ error })) {
				toast.error("Not enough browser storage", {
					description: error instanceof Error ? error.message : undefined,
				});
			}

			return null;
		}
	}

	removeMediaAsset({ projectId, id }: { projectId: string; id: string }): void {
		this.removeMediaAssets({ projectId, ids: [id] });
	}

	removeMediaAssets({
		projectId,
		ids,
	}: {
		projectId: string;
		ids: string[];
	}): void {
		const uniqueIds = [...new Set(ids)];
		if (uniqueIds.length === 0) {
			return;
		}

		const command =
			uniqueIds.length === 1
				? new RemoveMediaAssetCommand(projectId, uniqueIds[0])
				: new BatchCommand(
						uniqueIds.map((id) => new RemoveMediaAssetCommand(projectId, id)),
					);

		this.editor.command.execute({ command });
	}

	async loadProjectMedia({ projectId }: { projectId: string }): Promise<void> {
		this.isLoading = true;
		this.notify();

		try {
			const mediaAssets = await storageService.loadAllMediaAssets({
				projectId,
			});
			this.assets = mediaAssets;
			this.notify();
		} catch (error) {
			console.error("Failed to load media assets:", error);
		} finally {
			this.isLoading = false;
			this.notify();
		}
	}

	async clearProjectMedia({ projectId }: { projectId: string }): Promise<void> {
		this.assets.forEach((asset) => {
			if (asset.url) {
				URL.revokeObjectURL(asset.url);
			}
			if (asset.thumbnailUrl) {
				URL.revokeObjectURL(asset.thumbnailUrl);
			}
		});

		const mediaIds = this.assets.map((asset) => asset.id);
		this.assets = [];
		this.notify();

		try {
			await Promise.all(
				mediaIds.map((id) =>
					storageService.deleteMediaAsset({ projectId, id }),
				),
			);
		} catch (error) {
			console.error("Failed to clear media assets from storage:", error);
		}
	}

	clearAllAssets(): void {
		videoCache.clearAll();

		this.assets.forEach((asset) => {
			if (asset.url) {
				URL.revokeObjectURL(asset.url);
			}
			if (asset.thumbnailUrl) {
				URL.revokeObjectURL(asset.thumbnailUrl);
			}
		});

		this.assets = [];
		this.notify();
	}

	getAssets(): MediaAsset[] {
		return this.assets;
	}

	getAsset({ id }: { id: string }): MediaAsset | null {
		return this.assets.find((asset) => asset.id === id) ?? null;
	}

	setAssets({ assets }: { assets: MediaAsset[] }): void {
		this.assets = assets;
		this.notify();
	}

	async updateAssetMemory({
		projectId,
		mediaId,
		vision,
		transcript,
		tags,
	}: {
		projectId: string;
		mediaId: string;
		vision?: MediaVisionMemory;
		transcript?: MediaTranscriptMemory;
		tags?: string[];
	}): Promise<MediaAsset | null> {
		const index = this.assets.findIndex((asset) => asset.id === mediaId);
		if (index < 0) return null;
		const current = this.assets[index];
		const next: MediaAsset = {
			...current,
			...(vision !== undefined ? { vision } : {}),
			...(transcript !== undefined ? { transcript } : {}),
			...(tags !== undefined ? { tags } : {}),
		};
		this.assets = [
			...this.assets.slice(0, index),
			next,
			...this.assets.slice(index + 1),
		];
		this.notify();
		try {
			await storageService.saveMediaAsset({ projectId, mediaAsset: next });
			return next;
		} catch (error) {
			console.error("Failed to persist media memory:", error);
			this.assets = [
				...this.assets.slice(0, index),
				current,
				...this.assets.slice(index + 1),
			];
			this.notify();
			return null;
		}
	}

	isLoadingMedia(): boolean {
		return this.isLoading;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		this.listeners.forEach((fn) => {
			fn();
		});
	}
}
