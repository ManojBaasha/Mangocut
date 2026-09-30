import { describe, expect, test } from "bun:test";
import {
	diffPlanCriteria,
	parseEditPlan,
	type EditPlan,
} from "@/lib/ai/agent/plan";

describe("parseEditPlan", () => {
	test("parses valid plan JSON", () => {
		const plan = parseEditPlan({
			raw: JSON.stringify({
				steps: ["Search ocean B-roll", "Place on timeline"],
				successCriteria: ["ocean clip on main", "duration > 2s"],
			}),
		});
		expect(plan?.steps).toHaveLength(2);
		expect(plan?.successCriteria[0]).toContain("ocean");
	});

	test("returns null for invalid", () => {
		expect(parseEditPlan({ raw: "not json" })).toBeNull();
		expect(parseEditPlan({ raw: JSON.stringify({ steps: [] }) })).toBeNull();
	});
});

describe("diffPlanCriteria", () => {
	test("lists unmet criteria", () => {
		const plan: EditPlan = {
			steps: ["a"],
			successCriteria: ["has elements", "ocean visible"],
		};
		const unmet = diffPlanCriteria({
			plan,
			qaResults: [
				{ check: "has elements", pass: true },
				{ check: "ocean visible", pass: false, detail: "not found" },
			],
		});
		expect(unmet).toEqual(["ocean visible"]);
	});
});
