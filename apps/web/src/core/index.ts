import { PlaybackManager } from "./managers/playback-manager";
import { TimelineManager } from "./managers/timeline-manager";
import { ScenesManager } from "./managers/scenes-manager";
import { ProjectManager } from "./managers/project-manager";
import { MediaManager } from "./managers/media-manager";
import { RendererManager } from "./managers/renderer-manager";
import { CommandManager } from "./managers/commands";
import { SaveManager } from "./managers/save-manager";
import { AudioManager } from "./managers/audio-manager";
import { SelectionManager } from "./managers/selection-manager";
import { ClipboardManager } from "./managers/clipboard-manager";
import { DiagnosticsManager } from "./managers/diagnostics-manager";
import { ShadowManager } from "./managers/shadow-manager";
import { registerDefaultEffects } from "@/lib/effects";
import { registerDefaultMasks } from "@/lib/masks";
import { registerTranscriptionDiagnostics } from "@/lib/transcription/diagnostics";
import {
	clearCommandRegistry,
	isCommandRegistered,
	registerEditorCommands,
	setShadowCommandGuard,
} from "@/lib/commands-api";
import { registerFsCommands } from "@/lib/commands-api/register-fs-commands";
import { registerFfmpegCommands } from "@/lib/commands-api/register-ffmpeg-commands";
import { registerVisionCommands } from "@/lib/commands-api/register-vision-commands";
import { registerTranscriptionCommands } from "@/lib/commands-api/register-transcription-commands";
import { registerMemoryCommands } from "@/lib/commands-api/register-memory-commands";
import { registerAgentMetaCommands } from "@/lib/commands-api/register-agent-meta-commands";

export class EditorCore {
	private static instance: EditorCore | null = null;
	public readonly timeline: TimelineManager;
	public readonly command: CommandManager;
	public readonly playback: PlaybackManager;
	public readonly scenes: ScenesManager;
	public readonly project: ProjectManager;
	public readonly media: MediaManager;
	public readonly renderer: RendererManager;
	public readonly save: SaveManager;
	public readonly audio: AudioManager;
	public readonly selection: SelectionManager;
	public readonly clipboard: ClipboardManager;
	public readonly diagnostics: DiagnosticsManager;
	public readonly shadow: ShadowManager;

	private constructor() {
		registerDefaultEffects();
		registerDefaultMasks();
		this.command = new CommandManager(this);
		this.timeline = new TimelineManager(this);
		this.playback = new PlaybackManager(this);
		this.scenes = new ScenesManager(this);
		this.project = new ProjectManager(this);
		this.media = new MediaManager(this);
		this.renderer = new RendererManager(this);
		this.save = new SaveManager(this);
		this.audio = new AudioManager(this);
		this.selection = new SelectionManager(this);
		this.clipboard = new ClipboardManager(this);
		this.diagnostics = new DiagnosticsManager(this);
		this.shadow = new ShadowManager(this);
		registerTranscriptionDiagnostics({ diagnostics: this.diagnostics });
		this.playback.bindTimelineScope();
		this.command.registerReactor(() => {
			const activeScene = this.scenes.getActiveSceneOrNull();
			if (!activeScene) {
				return;
			}

			const tracks = activeScene.tracks;
			const prunedTracks = {
				...tracks,
				overlay: tracks.overlay.filter((track) => track.elements.length > 0),
				audio: tracks.audio.filter((track) => track.elements.length > 0),
			};
			if (
				prunedTracks.overlay.length !== tracks.overlay.length ||
				prunedTracks.audio.length !== tracks.audio.length
			) {
				this.timeline.updateTracks(prunedTracks);
			}
		});
		this.save.start();
		setShadowCommandGuard({
			guard: () => {
				if (this.shadow.isFinalDiverged()) {
					throw new Error(
						"Final timeline changed while AI Preview exists. Accept, Reject, or Reset preview before continuing.",
					);
				}
			},
		});
		if (!isCommandRegistered({ name: "get_project_summary" })) {
			registerEditorCommands({ editor: this });
			registerFsCommands({ editor: this });
			registerFfmpegCommands({ editor: this });
		}
		if (!isCommandRegistered({ name: "describe_media" })) {
			registerVisionCommands({ editor: this });
		}
		if (!isCommandRegistered({ name: "transcribe_media" })) {
			registerTranscriptionCommands({ editor: this });
		}
		if (!isCommandRegistered({ name: "search_media" })) {
			registerMemoryCommands({ editor: this });
		}
		if (!isCommandRegistered({ name: "propose_edit_plan" })) {
			registerAgentMetaCommands({ editor: this });
		}
	}

	static getInstance(): EditorCore {
		if (!EditorCore.instance) {
			EditorCore.instance = new EditorCore();
		}
		return EditorCore.instance;
	}

	static reset(): void {
		clearCommandRegistry();
		EditorCore.instance = null;
	}
}
