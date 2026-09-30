export interface MangocutDesktopApi {
	platform: NodeJS.Platform;
	isDesktop: true;
	ai?: {
		chat: (payload: {
			messages: Array<{ role: string; content: string }>;
			model: string;
			tools: unknown[];
			deviceId?: string;
		}) => Promise<{
			message: {
				role: string;
				content: string | null;
				tool_calls?: Array<{
					id: string;
					type: "function";
					function: { name: string; arguments: string };
				}>;
			};
		}>;
		listDir: (payload: { path: string }) => Promise<{
			entries: Array<{ name: string; path: string; isDirectory: boolean }>;
		}>;
		globMedia: (payload: {
			path: string;
			recursive?: boolean;
		}) => Promise<{ files: string[] }>;
		stat: (payload: { path: string }) => Promise<{
			size: number;
			mtimeMs: number;
			isFile: boolean;
			isDirectory: boolean;
		}>;
		pickFolder: () => Promise<{ path: string | null }>;
		importPaths: (payload: {
			paths: string[];
		}) => Promise<{ files: Array<{ path: string; name: string; buffer: ArrayBuffer }> }>;
		ffmpegAvailable: () => Promise<{ available: boolean; path: string | null }>;
		runFfmpeg: (payload: {
			args: string[];
			cwd?: string;
		}) => Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null }>;
		extractFrames: (payload: {
			inputPath: string;
			outputDir: string;
		}) => Promise<{ frames: string[] }>;
		applyGrade: (payload: {
			inputPath: string;
			outputPath: string;
			filterChain: string;
		}) => Promise<{ outputPath: string }>;
		compileClips: (payload: {
			inputs: string[];
			outputPath: string;
		}) => Promise<{ outputPath: string }>;
		addAudioBed: (payload: {
			videoPath: string;
			audioPath: string;
			outputPath: string;
			fadeIn?: number;
			fadeOut?: number;
		}) => Promise<{ outputPath: string }>;
		addTextOverlay: (payload: {
			inputPath: string;
			outputPath: string;
			text: string;
			start?: number;
			end?: number;
		}) => Promise<{ outputPath: string }>;
	};
}

declare global {
	interface Window {
		mangocutDesktop?: MangocutDesktopApi;
	}
}

export function isMangocutDesktop(): boolean {
	return typeof window !== "undefined" && Boolean(window.mangocutDesktop?.isDesktop);
}

export function getDesktopApi(): MangocutDesktopApi | null {
	if (typeof window === "undefined") return null;
	return window.mangocutDesktop ?? null;
}
