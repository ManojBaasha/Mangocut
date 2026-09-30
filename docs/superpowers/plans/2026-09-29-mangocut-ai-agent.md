# Mangocut AI Agent Implementation Plan

> **For agentic workers:** Implement task-by-task. Spec: `docs/superpowers/specs/2026-09-29-mangocut-ai-agent-design.md`

**Goal:** Electron AI chat agent with Command API, shadow timeline, proxied OpenRouter, FS import, and ffmpeg grade tools.

**Architecture:** Shared Command API in renderer; shadow timeline store; Electron main agent + FS/ffmpeg IPC; Next.js OpenRouter proxy.

**Tech Stack:** TypeScript, Electron, Next.js App Router, Zustand, OpenRouter, ffmpeg CLI.

## Tasks

1. Command API registry + editor command definitions + wire ACTIONS
2. Shadow timeline manager + Accept/Reject + view mode
3. AI chat UI + store + Electron IPC agent bridge
4. OpenRouter proxy API routes
5. FS IPC tools + import into project/shadow
6. ffmpeg grades pack + tools
