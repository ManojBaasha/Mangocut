# Mangocut AI Agent Design

**Date:** 2026-09-29  
**Status:** Approved  
**Product:** Mangocut (Electron)

## Goal

Ship an AI-first editing loop in Electron: a chat sidebar agent that can do everything the UI can, import media from arbitrary local folders, run ai-video-dev-style ffmpeg tools, and always stage work on a **shadow timeline** until the user **Accepts** into final. Manual editing remains first-class via the same Command API.

## Locked decisions

| Decision | Choice |
|---|---|
| Agent host | Electron main process |
| Edit staging | Always shadow timeline; Accept commits to final |
| Capability surface | Shared Command API (UI + agent) |
| Models | Mangocut-proxied OpenRouter (server-held key) |
| Platforms (v1) | Electron-only; web stays manual |
| Scope | Full current UI action parity + ported ai-video-dev extras |

## Architecture

```
Electron main: agent loop, FS tools, ffmpeg tools, IPC
Electron renderer: EditorCore, Command API, shadow store, chat UI
Next API: /api/ai/chat OpenRouter proxy (+ model list)
```

- Chat UI ↔ main agent via IPC.
- Mutating editor tools always use `target: "shadow"`.
- Main asks renderer to execute Command API tools via IPC.
- FS/ffmpeg run in main; results import through Command API into shadow.

## Command API

`command.execute(name, args, { target: "final" | "shadow" })`

- Typed registry with JSON Schema (name, description, args, result).
- Implemented by wrapping existing `EditorCore` managers.
- UI `ACTIONS` invoke the same registry (`target: "final"`).
- Agent tools invoke the same registry (`target: "shadow"`).

## Shadow timeline

- Clone active scene tracks into a shadow store on first AI edit / chat open.
- UI toggle: Final | AI Preview.
- Accept: commit shadow → final as one undoable batch.
- Reject/Reset: discard shadow; optional re-clone from final.
- If final diverges while shadow exists: warn; require Reset or Accept before further AI work.

## Tool packs

### Pack 1 — Editor parity

Project/media, timeline edit, playback/selection, text/effects already in UI, undo/redo.

### Pack 2 — Local FS

`listDir`, `globMedia`, `stat`, `importPaths`, folder picker. Copy into project storage, then Pack 1 import on shadow.

### Pack 3 — ai-video-dev (ffmpeg)

Port grade presets; tools: `list_grades`, `extract_frames`, `analyze_grade`, `apply_grade`, `compile_clips`, `add_audio_bed`, overlays. Outputs → media → shadow.

## UI

- Top-right AI button opens right chat sidebar (Electron only).
- Streaming messages + tool-call chips.
- Accept / Reject + Final | AI Preview controls.
- Model picker from proxy allowlist; no client API key.

## Proxy

- `POST /api/ai/chat` — OpenRouter chat completions with tools.
- `GET /api/ai/models` — allowed models.
- Server holds `OPENROUTER_API_KEY`.
- Simple app token now; Google auth / trial limits later (hooks only).

## Out of scope (v1)

- Google sign-in / enforced free trial
- Web AI chat
- Standalone CLI
- Persistent image-description memory
- Dedicated Whisper cut-on-speech UX

## Success criteria

In Electron, a user can chat to import clips from disk folders, perform full current editor operations, run grade/compile/audio/overlay tools, preview on shadow, and Accept into final without leaving the app.
