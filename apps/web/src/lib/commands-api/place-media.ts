import type { MediaType } from "@/lib/media/types";

export interface ProjectMediaRef {
	id: string;
	name: string;
	type: MediaType;
	duration?: number | null;
}

/** Resolve an already-imported project asset by id or case-insensitive name. */
export function findProjectMediaAsset({
	assets,
	mediaId,
	mediaName,
}: {
	assets: ProjectMediaRef[];
	mediaId?: string;
	mediaName?: string;
}): ProjectMediaRef | null {
	if (mediaId) {
		const byId = assets.find((a) => a.id === mediaId);
		if (byId) return byId;
	}
	if (mediaName) {
		const needle = mediaName.trim().toLowerCase();
		const byName = assets.find((a) => a.name.trim().toLowerCase() === needle);
		if (byName) return byName;
		const partial = assets.find((a) =>
			a.name.trim().toLowerCase().includes(needle),
		);
		if (partial) return partial;
	}
	return null;
}
