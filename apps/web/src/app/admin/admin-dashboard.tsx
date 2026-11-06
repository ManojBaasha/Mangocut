"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BasePage } from "@/app/base-page";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { formatUsd } from "@/lib/ai/project-usage";
import type { AdminUsageReport } from "@/lib/ai/admin-usage";

type AdminPayload = AdminUsageReport & {
	turnLimit: number;
	spendLimitUsd: number | null;
};

export function AdminDashboard() {
	return (
		<BasePage
			title="Admin"
			description="Signed-in users and OpenRouter trial spend for this Mangocut host."
			maxWidth="6xl"
		>
			<AdminContent />
		</BasePage>
	);
}

function AdminContent() {
	const [data, setData] = useState<AdminPayload | null>(null);
	const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");

	useEffect(() => {
		void (async () => {
			try {
				const res = await fetch("/api/admin/usage", { credentials: "include" });
				if (!res.ok) {
					setStatus("error");
					return;
				}
				setData((await res.json()) as AdminPayload);
				setStatus("ok");
			} catch {
				setStatus("error");
			}
		})();
	}, []);

	if (status === "loading") {
		return <p className="text-muted-foreground text-sm">Loading…</p>;
	}

	if (status === "error" || !data) {
		return (
			<div className="flex flex-col gap-3 text-left">
				<p className="text-destructive text-sm">Failed to load usage.</p>
				<Button asChild size="sm" variant="outline">
					<Link href="/settings">Back to Settings</Link>
				</Button>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-10 text-left">
			<section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				<Stat label="Users" value={String(data.totals.userCount)} />
				<Stat label="Total AI turns" value={String(data.totals.totalTurns)} />
				<Stat
					label="Total OpenRouter spend"
					value={formatUsd({ amount: data.totals.totalCostUsd })}
				/>
				<Stat
					label="Trial exhausted"
					value={String(data.totals.exhaustedCount)}
				/>
			</section>

			<Separator />

			<section className="flex flex-col gap-3">
				<p className="text-muted-foreground text-sm">
					Turn limit {data.turnLimit}
					{data.spendLimitUsd != null
						? ` · spend cap ${formatUsd({ amount: data.spendLimitUsd })}`
						: " · spend cap off"}
				</p>
				<div className="overflow-x-auto rounded-lg border">
					<table className="w-full text-left text-sm">
						<thead className="bg-muted/50 text-muted-foreground">
							<tr>
								<th className="px-3 py-2 font-medium">Email</th>
								<th className="px-3 py-2 font-medium">Name</th>
								<th className="px-3 py-2 font-medium">Turns</th>
								<th className="px-3 py-2 font-medium">Spend</th>
								<th className="px-3 py-2 font-medium">Left</th>
								<th className="px-3 py-2 font-medium">Status</th>
								<th className="px-3 py-2 font-medium">Last AI</th>
							</tr>
						</thead>
						<tbody>
							{data.rows.length === 0 ? (
								<tr>
									<td
										colSpan={7}
										className="text-muted-foreground px-3 py-4 text-sm"
									>
										No signed-in users yet.
									</td>
								</tr>
							) : (
								data.rows.map((row) => (
									<tr key={row.userId} className="border-t">
										<td className="px-3 py-2">{row.email}</td>
										<td className="px-3 py-2">{row.name}</td>
										<td className="px-3 py-2">{row.turns}</td>
										<td className="px-3 py-2">
											{formatUsd({ amount: row.costUsd })}
										</td>
										<td className="px-3 py-2">{row.remainingTurns}</td>
										<td className="px-3 py-2">
											{row.trialExhausted ? "Exhausted" : "Active"}
										</td>
										<td className="text-muted-foreground px-3 py-2">
											{row.usageUpdatedAt
												? new Date(row.usageUpdatedAt).toLocaleString()
												: "—"}
										</td>
									</tr>
								))
							)}
						</tbody>
					</table>
				</div>
			</section>
		</div>
	);
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-lg border px-4 py-3">
			<p className="text-muted-foreground text-xs">{label}</p>
			<p className="mt-1 text-xl font-semibold tracking-tight">{value}</p>
		</div>
	);
}
