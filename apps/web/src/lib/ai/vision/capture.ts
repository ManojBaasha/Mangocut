import type { MediaAsset } from "@/lib/media/types";
import { videoCache } from "@/services/video-cache/service";
import { getDesktopApi } from "@/lib/ai/desktop";

export interface CapturedFrame {
	timeSeconds: number;
	dataUrl: string;
}

function canvasToJpegDataUrl({
	canvas,
	quality = 0.72,
}: {
	canvas: HTMLCanvasElement | OffscreenCanvas;
	quality?: number;
}): string {
	if (canvas instanceof HTMLCanvasElement) {
		return canvas.toDataURL("image/jpeg", quality);
	}
	// OffscreenCanvas in environments that support convertToBlob sync via temporary canvas
	const tmp = document.createElement("canvas");
	tmp.width = canvas.width;
	tmp.height = canvas.height;
	const ctx = tmp.getContext("2d");
	if (!ctx) throw new Error("Could not create canvas context for frame encode");
	ctx.drawImage(canvas as unknown as CanvasImageSource, 0, 0);
	return tmp.toDataURL("image/jpeg", quality);
}

async function captureImageAsset({
	asset,
}: {
	asset: MediaAsset;
}): Promise<CapturedFrame[]> {
	if (asset.thumbnailUrl?.startsWith("data:")) {
		return [{ timeSeconds: 0, dataUrl: asset.thumbnailUrl }];
	}
	if (asset.url || asset.file) {
		const url = asset.url ?? URL.createObjectURL(asset.file);
		try {
			const dataUrl = await loadImageAsJpegDataUrl({ url });
			return [{ timeSeconds: 0, dataUrl }];
		} finally {
			if (!asset.url) URL.revokeObjectURL(url);
		}
	}
	throw new Error("Image asset has no readable source");
}

function loadImageAsJpegDataUrl({ url }: { url: string }): Promise<string> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => {
			const canvas = document.createElement("canvas");
			const maxW = 640;
			const scale = Math.min(1, maxW / Math.max(1, img.naturalWidth));
			canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
			canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
			const ctx = canvas.getContext("2d");
			if (!ctx) {
				reject(new Error("Could not create canvas for image"));
				return;
			}
			ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
			resolve(canvas.toDataURL("image/jpeg", 0.72));
		};
		img.onerror = () => reject(new Error("Failed to load image for vision"));
		img.src = url;
	});
}

export async function captureAssetFrames({
	asset,
	timesSeconds,
}: {
	asset: MediaAsset;
	timesSeconds: number[];
}): Promise<CapturedFrame[]> {
	if (asset.type === "image") {
		return captureImageAsset({ asset });
	}
	if (asset.type === "audio") {
		throw new Error("Cannot capture frames from an audio asset");
	}

	const frames: CapturedFrame[] = [];
	for (const timeSeconds of timesSeconds) {
		const wrapped = await videoCache.getFrameAt({
			mediaId: asset.id,
			file: asset.file,
			time: timeSeconds,
		});
		if (!wrapped?.canvas) continue;
		frames.push({
			timeSeconds,
			dataUrl: canvasToJpegDataUrl({ canvas: wrapped.canvas }),
		});
	}

	if (frames.length > 0) return frames;

	const desktop = getDesktopApi()?.ai;
	if (!desktop) {
		throw new Error("Could not capture frames from video asset");
	}
	// Last resort: requires a filesystem path — not available for OPFS imports.
	throw new Error(
		"Could not capture in-project video frames. Try re-importing the clip.",
	);
}
