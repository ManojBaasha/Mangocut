import type { MediaType } from "@/lib/media/types";
import type {
	TProject,
	TProjectMetadata,
	TTimelineViewState,
} from "@/lib/project/types";
import type { TScene } from "@/lib/timeline";

export interface StorageAdapter<T> {
	get(key: string): Promise<T | null>;
	set(key: string, value: T): Promise<void>;
	remove(key: string): Promise<void>;
	list(): Promise<string[]>;
	clear(): Promise<void>;
}

export interface VisionFrameMemory {
	timeSeconds: number;
	description: string;
	capturedAt: string;
}

export interface MediaVisionMemory {
	summary?: string;
	updatedAt?: string;
	frames?: VisionFrameMemory[];
}

export interface MediaTranscriptSegment {
	start: number;
	end: number;
	text: string;
}

export interface MediaTranscriptMemory {
	modelId: string;
	segments: MediaTranscriptSegment[];
	updatedAt: string;
}

export interface MediaAssetData {
	id: string;
	name: string;
	type: MediaType;
	size: number;
	lastModified: number;
	width?: number;
	height?: number;
	duration?: number;
	fps?: number;
	hasAudio?: boolean;
	ephemeral?: boolean;
	thumbnailUrl?: string;
	/** AI vision descriptions persisted across sessions. */
	vision?: MediaVisionMemory;
	/** Whisper transcript persisted so cut/caption tools can reuse it. */
	transcript?: MediaTranscriptMemory;
	/** Lightweight search tags derived from vision/transcript/name. */
	tags?: string[];
}

export type SerializedScene = Omit<TScene, "createdAt" | "updatedAt"> & {
	createdAt: string;
	updatedAt: string;
};

export type SerializedProjectMetadata = Omit<
	TProjectMetadata,
	"createdAt" | "updatedAt"
> & {
	createdAt: string;
	updatedAt: string;
};

export type SerializedProject = Omit<TProject, "metadata" | "scenes"> & {
	metadata: SerializedProjectMetadata;
	scenes: SerializedScene[];
	timelineViewState?: TTimelineViewState;
};

export interface StorageConfig {
	projectsDb: string;
	mediaDb: string;
	savedSoundsDb: string;
	version: number;
}

// TypeScript type augmentation to add async iterator methods to FileSystemDirectoryHandle
// These methods are part of the File System Access API spec but may not be in all type definitions
declare global {
	interface FileSystemDirectoryHandle {
		keys(): AsyncIterableIterator<string>;
		values(): AsyncIterableIterator<FileSystemHandle>;
		entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
	}
}
