import { z } from "zod";
import type { EditorCore } from "@/core";
import { registerCommand } from "@/lib/commands-api/registry";
import { diffPlanCriteria, parseEditPlan } from "@/lib/ai/agent/plan";
import { executeCommand } from "@/lib/commands-api/registry";
import { EDIT_SKILLS } from "@/lib/ai/skills";

function listSkillFiles(): Array<{ id: string; title: string }> {
	return Object.keys(EDIT_SKILLS)
		.sort()
		.map((id) => ({
			id,
			title: id
				.split("-")
				.map((p) => p.charAt(0).toUpperCase() + p.slice(1))
				.join(" "),
		}));
}

function readSkill({ id }: { id: string }): string | null {
	const safe = id.replace(/[^a-z0-9-]/gi, "");
	if (!safe) return null;
	return EDIT_SKILLS[safe] ?? null;
}

export function registerAgentMetaCommands({
	editor: _editor,
}: {
	editor: EditorCore;
}): void {
	registerCommand({
		definition: {
			name: "propose_edit_plan",
			description:
				"Record a short multi-step edit plan with success criteria before acting. Prefer for complex requests.",
			category: "project",
			argsSchema: z.object({
				steps: z.array(z.string()).min(1),
				successCriteria: z.array(z.string()).min(1),
			}),
			exposeToAgent: true,
		},
		handler: ({ steps, successCriteria }) => {
			const plan = parseEditPlan({ raw: { steps, successCriteria } });
			if (!plan) return { ok: false, reason: "Invalid plan" };
			return { ok: true, plan };
		},
	});

	registerCommand({
		definition: {
			name: "verify_edit_plan",
			description:
				"Run assert_edit_quality and compare against a plan's successCriteria. Returns unmet criteria.",
			category: "project",
			argsSchema: z.object({
				steps: z.array(z.string()).optional(),
				successCriteria: z.array(z.string()).min(1),
				extraChecks: z.array(z.string()).optional(),
			}),
			exposeToAgent: true,
		},
		handler: async ({ steps, successCriteria, extraChecks }) => {
			const plan = parseEditPlan({
				raw: {
					steps: steps?.length ? steps : ["verify"],
					successCriteria,
				},
			});
			if (!plan) return { ok: false, reason: "Invalid plan" };
			const qa = (await executeCommand({
				name: "assert_edit_quality",
				args: { checks: extraChecks ?? successCriteria },
				target: "shadow",
			})) as {
				ok?: boolean;
				results?: Array<{ check: string; pass: boolean; detail?: string }>;
			};
			const results = qa.results ?? [];
			const unmet = diffPlanCriteria({ plan, qaResults: results });
			return {
				ok: true,
				passed: unmet.length === 0,
				unmet,
				results,
			};
		},
	});

	registerCommand({
		definition: {
			name: "list_edit_skills",
			description: "List reusable Mangocut edit skill packs (recipes).",
			category: "project",
			argsSchema: z.object({}),
			exposeToAgent: true,
		},
		handler: () => ({ ok: true, skills: listSkillFiles() }),
	});

	registerCommand({
		definition: {
			name: "get_edit_skill",
			description:
				"Load an edit skill pack's instructions. Follow them for the current user request.",
			category: "project",
			argsSchema: z.object({ id: z.string().min(1) }),
			exposeToAgent: true,
		},
		handler: ({ id }) => {
			const body = readSkill({ id });
			if (!body) return { ok: false, reason: `Unknown skill ${id}` };
			return { ok: true, id, instructions: body };
		},
	});
}
