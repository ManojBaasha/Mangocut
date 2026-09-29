const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("mangocutDesktop", {
	platform: process.platform,
	isDesktop: true,
});
