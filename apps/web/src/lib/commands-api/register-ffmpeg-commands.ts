import { z } from "zod";
import type { EditorCore } from "@/core";
import { registerCommand } from "@/lib/commands-api/registry";
import { getDesktopApi } from "@/lib/ai/desktop";
import { findGradePreset, listGradePresets } from "@/lib/ai/grades";
import { executeCommand } from "@/lib/commands-api/registry";

function requireDesktop() {
	const api = getDesktopApi();
	if (!api?.ai) {
		throw new Error("ffmpeg tools require Mangocut desktop");
	}
	return api.ai;
}

export function registerFfmpegCommands({
	editor,
}: {
	editor: EditorCore;
}): void {
	registerCommand({
		definition: {
			name: "list_grades",
			description: "List available color grade presets from ai-video-dev",
			category: "ffmpeg",
			argsSchema: z.object({}),
			exposeToAgent: true,
		},
		handler: () => ({
			grades: listGradePresets().map((g) => ({
				name: g.name,
				bestFor: g.bestFor,
			})),
		}),
	});

	registerCommand({
		definition: {
			name: "ffmpeg_status",
			description: "Check whether ffmpeg is available on this machine",
			category: "ffmpeg",
			argsSchema: z.object({}),
			exposeToAgent: true,
		},
		handler: async () => requireDesktop().ffmpegAvailable(),
	});

	registerCommand({
		definition: {
			name: "extract_frames",
			description: "Extract preview frames from a local video path",
			category: "ffmpeg",
			argsSchema: z.object({
				inputPath: z.string().min(1),
				outputDir: z.string().min(1),
			}),
			exposeToAgent: true,
		},
		handler: async ({ inputPath, outputDir }) =>
			requireDesktop().extractFrames({ inputPath, outputDir }),
	});

	registerCommand({
		definition: {
			name: "apply_grade",
			description:
				"Apply a color grade preset to a local video file via ffmpeg",
			category: "ffmpeg",
			argsSchema: z.object({
				inputPath: z.string().min(1),
				outputPath: z.string().min(1),
				gradeName: z.string().min(1),
				importResult: z.boolean().optional(),
			}),
			exposeToAgent: true,
		},
		handler: async ({ inputPath, outputPath, gradeName, importResult }, ctx) => {
			const grade = findGradePreset({ name: gradeName });
			const result = await requireDesktop().applyGrade({
				inputPath,
				outputPath,
				filterChain: grade.filterChain,
			});
			if (importResult !== false) {
				await executeCommand({
					name: "import_media_paths",
					args: { paths: [result.outputPath], placeOnTimeline: true },
					target: ctx.target,
				});
			}
			return { ...result, grade: grade.name };
		},
	});

	registerCommand({
		definition: {
			name: "compile_clips",
			description: "Concatenate local video clips into one file with ffmpeg",
			category: "ffmpeg",
			argsSchema: z.object({
				inputs: z.array(z.string()).min(1),
				outputPath: z.string().min(1),
				importResult: z.boolean().optional(),
			}),
			exposeToAgent: true,
		},
		handler: async ({ inputs, outputPath, importResult }, ctx) => {
			const result = await requireDesktop().compileClips({
				inputs,
				outputPath,
			});
			if (importResult !== false) {
				await executeCommand({
					name: "import_media_paths",
					args: { paths: [result.outputPath], placeOnTimeline: true },
					target: ctx.target,
				});
			}
			return result;
		},
	});

	registerCommand({
		definition: {
			name: "add_audio_bed",
			description: "Mix a music bed under a video with fade in/out",
			category: "ffmpeg",
			argsSchema: z.object({
				videoPath: z.string().min(1),
				audioPath: z.string().min(1),
				outputPath: z.string().min(1),
				fadeIn: z.number().optional(),
				fadeOut: z.number().optional(),
				importResult: z.boolean().optional(),
			}),
			exposeToAgent: true,
		},
		handler: async (args, ctx) => {
			const result = await requireDesktop().addAudioBed({
				videoPath: args.videoPath,
				audioPath: args.audioPath,
				outputPath: args.outputPath,
				fadeIn: args.fadeIn,
				fadeOut: args.fadeOut,
			});
			if (args.importResult !== false) {
				await executeCommand({
					name: "import_media_paths",
					args: { paths: [result.outputPath], placeOnTimeline: true },
					target: ctx.target,
				});
			}
			return result;
		},
	});

	registerCommand({
		definition: {
			name: "analyze_grade",
			description:
				"Recommend a grade for a clip by listing grades and metadata (frames extracted for follow-up)",
			category: "ffmpeg",
			argsSchema: z.object({
				inputPath: z.string().min(1),
				outputDir: z.string().min(1),
			}),
			exposeToAgent: true,
		},
		handler: async ({ inputPath, outputDir }) => {
			const frames = await requireDesktop().extractFrames({
				inputPath,
				outputDir,
			});
			return {
				frames: frames.frames,
				grades: listGradePresets().map((g) => ({
					name: g.name,
					bestFor: g.bestFor,
				})),
				hint: "Pick the grade whose bestFor matches the footage, then call apply_grade.",
			};
		},
	});

	registerCommand({
		definition: {
			name: "add_text_overlay",
			description: "Burn a timed text overlay into a video with ffmpeg drawtext",
			category: "ffmpeg",
			argsSchema: z.object({
				inputPath: z.string().min(1),
				outputPath: z.string().min(1),
				text: z.string().min(1),
				start: z.number().optional(),
				end: z.number().optional(),
				importResult: z.boolean().optional(),
			}),
			exposeToAgent: true,
		},
		handler: async (args, ctx) => {
			const result = await requireDesktop().addTextOverlay({
				inputPath: args.inputPath,
				outputPath: args.outputPath,
				text: args.text,
				start: args.start,
				end: args.end,
			});
			if (args.importResult !== false) {
				await executeCommand({
					name: "import_media_paths",
					args: { paths: [result.outputPath], placeOnTimeline: true },
					target: ctx.target,
				});
			}
			return result;
		},
	});

	void editor;
}
