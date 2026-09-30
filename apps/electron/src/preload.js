const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mangocutDesktop", {
	platform: process.platform,
	isDesktop: true,
	ai: {
		chat: (payload) => ipcRenderer.invoke("ai:chat", payload),
		listDir: (payload) => ipcRenderer.invoke("ai:list-dir", payload),
		globMedia: (payload) => ipcRenderer.invoke("ai:glob-media", payload),
		stat: (payload) => ipcRenderer.invoke("ai:stat", payload),
		pickFolder: () => ipcRenderer.invoke("ai:pick-folder"),
		importPaths: (payload) => ipcRenderer.invoke("ai:import-paths", payload),
		ffmpegAvailable: () => ipcRenderer.invoke("ai:ffmpeg-available"),
		runFfmpeg: (payload) => ipcRenderer.invoke("ai:run-ffmpeg", payload),
		extractFrames: (payload) => ipcRenderer.invoke("ai:extract-frames", payload),
		applyGrade: (payload) => ipcRenderer.invoke("ai:apply-grade", payload),
		compileClips: (payload) => ipcRenderer.invoke("ai:compile-clips", payload),
		addAudioBed: (payload) => ipcRenderer.invoke("ai:add-audio-bed", payload),
		addTextOverlay: (payload) => ipcRenderer.invoke("ai:add-text-overlay", payload),
	},
});
