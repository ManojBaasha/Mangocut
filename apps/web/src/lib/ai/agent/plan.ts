export interface EditPlan {
	steps: string[];
	successCriteria: string[];
}

export interface QaCheckResult {
	check: string;
	pass: boolean;
	detail?: string;
}

export function parseEditPlan({ raw }: { raw: unknown }): EditPlan | null {
	try {
		const data =
			typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
		if (!data || typeof data !== "object") return null;
		const steps = (data as { steps?: unknown }).steps;
		const successCriteria = (data as { successCriteria?: unknown })
			.successCriteria;
		if (!Array.isArray(steps) || steps.length === 0) return null;
		const parsedSteps = steps.map(String).map((s) => s.trim()).filter(Boolean);
		if (parsedSteps.length === 0) return null;
		const criteria = Array.isArray(successCriteria)
			? successCriteria.map(String).map((s) => s.trim()).filter(Boolean)
			: [];
		return {
			steps: parsedSteps,
			successCriteria: criteria.length > 0 ? criteria : ["has_elements"],
		};
	} catch {
		return null;
	}
}

export function diffPlanCriteria({
	plan,
	qaResults,
}: {
	plan: EditPlan;
	qaResults: QaCheckResult[];
}): string[] {
	const byCheck = new Map(
		qaResults.map((r) => [r.check.toLowerCase(), r] as const),
	);
	const unmet: string[] = [];
	for (const criterion of plan.successCriteria) {
		const key = criterion.toLowerCase();
		const hit = byCheck.get(key);
		if (hit) {
			if (!hit.pass) unmet.push(criterion);
			continue;
		}
		// Fuzzy: criterion contained in a failed check label
		const fuzzy = qaResults.find((r) =>
			r.check.toLowerCase().includes(key) || key.includes(r.check.toLowerCase()),
		);
		if (fuzzy && !fuzzy.pass) unmet.push(criterion);
		else if (!fuzzy) {
			// No matching automated check — leave unmet so agent re-inspects
			unmet.push(criterion);
		}
	}
	return unmet;
}
