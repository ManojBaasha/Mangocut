"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";
import { BasePage } from "@/app/base-page";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { authClient } from "@/lib/auth/client";
import { isAdminEmail } from "@/lib/auth/admin";
import { aiFetch } from "@/lib/ai/cloud-fetch";
import {
	formatUsd,
	getProjectAiUsageMap,
} from "@/lib/ai/project-usage";
import { SOCIAL_LINKS } from "@/lib/site/social";
import { useEditor } from "@/hooks/use-editor";
import { formatDate } from "@/utils/date";
import { mediaTimeToSeconds } from "mangocut-wasm";

export default function SettingsPage() {
	return (
		<BasePage
			title="Settings"
			description="Free trial account, appearance, AI usage, and project overview for Mangocut."
			maxWidth="6xl"
		>
			<SettingsContent />
		</BasePage>
	);
}

function SettingsContent() {
	const { theme, setTheme, resolvedTheme } = useTheme();
	const session = authClient.useSession();
	const editor = useEditor();
	const [mounted, setMounted] = useState(false);
	const [remaining, setRemaining] = useState<number | null>(null);
	const [limit, setLimit] = useState<number | null>(null);
	const [spentUsd, setSpentUsd] = useState<number | null>(null);
	const [spendLimitUsd, setSpendLimitUsd] = useState<number | null>(null);
	const [trialExhausted, setTrialExhausted] = useState(false);
	const [authenticated, setAuthenticated] = useState(false);
	const [googleConfigured, setGoogleConfigured] = useState(false);
	const [feedback, setFeedback] = useState("");
	const [featureRequest, setFeatureRequest] = useState("");
	const [projectUsage, setProjectUsage] = useState(getProjectAiUsageMap());

	const isLoading = useEditor((e) => e.project.getIsLoading());
	const isInitialized = useEditor((e) => e.project.getIsInitialized());
	const projects = useEditor((e) =>
		e.project.getFilteredAndSortedProjects({
			searchQuery: "",
			sortOption: "updatedAt-desc",
		}),
	);

	useEffect(() => {
		setMounted(true);
		setProjectUsage(getProjectAiUsageMap());
	}, []);

	useEffect(() => {
		if (!editor.project.getIsInitialized()) {
			void editor.project.loadAllProjects();
		}
	}, [editor.project]);

	useEffect(() => {
		void (async () => {
			try {
				const res = await aiFetch("/api/ai/entitlements", {
					method: "GET",
				});
				const data = (await res.json()) as {
					remaining?: number;
					limit?: number;
					spentUsd?: number;
					spendLimitUsd?: number | null;
					trialExhausted?: boolean;
					authenticated?: boolean;
					googleConfigured?: boolean;
				};
				setRemaining(data.remaining ?? null);
				setLimit(data.limit ?? null);
				setSpentUsd(
					typeof data.spentUsd === "number" ? data.spentUsd : null,
				);
				setSpendLimitUsd(
					typeof data.spendLimitUsd === "number" ? data.spendLimitUsd : null,
				);
				setTrialExhausted(Boolean(data.trialExhausted));
				setAuthenticated(Boolean(data.authenticated));
				setGoogleConfigured(Boolean(data.googleConfigured));
			} catch {
				// non-fatal
			}
		})();
	}, [session.data?.user?.id]);

	const usedTurns =
		remaining != null && limit != null ? Math.max(0, limit - remaining) : 0;

	const projectRows = useMemo(() => {
		return projects.map((p) => {
			const turns = projectUsage[p.id]?.turns ?? 0;
			const costUsd = projectUsage[p.id]?.costUsd ?? 0;
			return {
				id: p.id,
				name: p.name,
				updatedAt: p.updatedAt,
				durationSeconds: mediaTimeToSeconds({ time: p.duration }),
				turns,
				costUsd,
			};
		});
	}, [projects, projectUsage]);

	const totalLocalProjectTurns = projectRows.reduce((n, r) => n + r.turns, 0);
	const totalLocalProjectCost = projectRows.reduce((n, r) => n + r.costUsd, 0);

	function openMailto({
		subject,
		body,
	}: {
		subject: string;
		body: string;
	}) {
		const url = `mailto:oss@mangocut.app?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
		window.location.href = url;
	}

	return (
		<div className="flex flex-col gap-12 text-left">
			<section className="flex flex-col gap-4">
				<h2 className="text-2xl font-semibold">What works where</h2>
				<p className="text-muted-foreground text-sm">
					Mangocut does not sync projects to the cloud. Web keeps files in this
					browser; desktop keeps them on this Mac. Free AI trial uses the hosted
					AI service when cloud mode is configured.
				</p>
				<ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
					<li>Web + desktop: manual editing, timeline AI preview, upload media, Google free AI trial</li>
					<li>Desktop only: folder pick / disk import, ffmpeg agent tools</li>
					<li>Neither: cloud project backup or multi-device sync</li>
				</ul>
			</section>

			<Separator />

			<section className="flex flex-col gap-4">
				<h2 className="text-2xl font-semibold">Appearance</h2>
				<p className="text-muted-foreground text-sm">
					Switch between light and dark. Current:{" "}
					{mounted ? resolvedTheme ?? theme ?? "system" : "…"}
				</p>
				<div className="flex flex-wrap gap-2">
					<Button
						variant={resolvedTheme === "light" ? "default" : "outline"}
						size="sm"
						onClick={() => setTheme("light")}
					>
						Light
					</Button>
					<Button
						variant={resolvedTheme === "dark" ? "default" : "outline"}
						size="sm"
						onClick={() => setTheme("dark")}
					>
						Dark
					</Button>
					<Button
						variant={theme === "system" ? "default" : "outline"}
						size="sm"
						onClick={() => setTheme("system")}
					>
						System
					</Button>
				</div>
			</section>

			<Separator />

			<section className="flex flex-col gap-4">
				<h2 className="text-2xl font-semibold">Account &amp; free AI trial</h2>
				<p className="text-muted-foreground text-sm">
					Mangocut is free to use. AI is a free trial with no payment — when
					your quota is used up, AI pauses and manual editing continues.
				</p>
				{trialExhausted ? (
					<p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
						Free AI trial is over. Timeline editing and export still work; AI
						chat is paused in this version.
					</p>
				) : null}
				{authenticated ? (
					<div className="flex flex-col items-start gap-2">
						<p className="text-sm">
							Signed in as{" "}
							<span className="font-medium">
								{session.data?.user?.email ?? "account"}
							</span>
						</p>
						{isAdminEmail({ email: session.data?.user?.email }) ? (
							<Button asChild size="sm" variant="outline">
								<Link href="/admin">Admin usage dashboard</Link>
							</Button>
						) : null}
					</div>
				) : (
					<div className="flex flex-col items-start gap-2">
						<p className="text-muted-foreground text-sm">
							Sign in with Google to start your free AI trial.
						</p>
						{googleConfigured ? (
							<Button
								size="sm"
								onClick={() =>
									void authClient.signIn.social({
										provider: "google",
										callbackURL: "/settings",
									})
								}
							>
								Sign in with Google
							</Button>
						) : (
							<p className="text-muted-foreground text-xs">
								Google sign-in is not configured on this server.
							</p>
						)}
					</div>
				)}

				<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
					<StatCard
						label="Free AI turns left"
						value={
							remaining != null && limit != null
								? `${remaining} / ${limit}`
								: "—"
						}
					/>
					<StatCard label="AI turns used" value={String(usedTurns)} />
					<StatCard
						label="AI spend (OpenRouter)"
						value={
							spentUsd != null ? formatUsd({ amount: spentUsd }) : "—"
						}
						hint="Exact cost from OpenRouter"
					/>
					<StatCard
						label="Spend limit"
						value={
							spendLimitUsd != null
								? formatUsd({ amount: spendLimitUsd })
								: "Turns only"
						}
						hint={
							spendLimitUsd != null
								? "AI stops when spend hits this cap"
								: "Optional USD cap not set"
						}
					/>
				</div>
			</section>

			<Separator />

			<section className="flex flex-col gap-4">
				<div className="flex items-end justify-between gap-3">
					<div>
						<h2 className="text-2xl font-semibold">Projects</h2>
						<p className="text-muted-foreground text-sm">
							Local projects on this device, with OpenRouter cost attributed
							from AI turns in this browser.
						</p>
					</div>
					<Button asChild size="sm" variant="outline">
						<Link href="/projects">Open projects</Link>
					</Button>
				</div>

				{isLoading || !isInitialized ? (
					<p className="text-muted-foreground text-sm">Loading projects…</p>
				) : projectRows.length === 0 ? (
					<p className="text-muted-foreground text-sm">No projects yet.</p>
				) : (
					<div className="overflow-x-auto rounded-lg border">
						<table className="w-full text-left text-sm">
							<thead className="bg-muted/50 text-muted-foreground">
								<tr>
									<th className="px-3 py-2 font-medium">Project</th>
									<th className="px-3 py-2 font-medium">Updated</th>
									<th className="px-3 py-2 font-medium">Duration</th>
									<th className="px-3 py-2 font-medium">AI turns</th>
									<th className="px-3 py-2 font-medium">Cost</th>
								</tr>
							</thead>
							<tbody>
								{projectRows.map((row) => (
									<tr key={row.id} className="border-t">
										<td className="px-3 py-2">
											<Link
												href={`/editor/${row.id}`}
												className="text-primary hover:underline"
											>
												{row.name}
											</Link>
										</td>
										<td className="text-muted-foreground px-3 py-2">
											{formatDate({ date: row.updatedAt })}
										</td>
										<td className="text-muted-foreground px-3 py-2">
											{formatDuration(row.durationSeconds)}
										</td>
										<td className="px-3 py-2">{row.turns}</td>
										<td className="px-3 py-2">
											{formatUsd({ amount: row.costUsd })}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>

			<Separator />

			<section className="flex flex-col gap-4">
				<h2 className="text-2xl font-semibold">Overview stats</h2>
				<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					<StatCard label="Projects on device" value={String(projectRows.length)} />
					<StatCard
						label="Project AI turns (local)"
						value={String(totalLocalProjectTurns)}
					/>
					<StatCard
						label="Project AI spend (local)"
						value={formatUsd({ amount: totalLocalProjectCost })}
					/>
					<StatCard
						label="Total timeline duration"
						value={formatDuration(
							projectRows.reduce((n, r) => n + (r.durationSeconds || 0), 0),
						)}
					/>
					<StatCard
						label="Trial capacity used"
						value={
							limit
								? `${Math.min(100, Math.round((usedTurns / limit) * 100))}%`
								: "—"
						}
					/>
				</div>
			</section>

			<Separator />

			<section className="flex flex-col gap-6">
				<div className="flex flex-col gap-3">
					<h2 className="text-2xl font-semibold">Send feedback</h2>
					<textarea
						className="border-input bg-background min-h-24 w-full rounded-md border px-3 py-2 text-sm"
						placeholder="What worked? What felt off?"
						value={feedback}
						onChange={(e) => setFeedback(e.target.value)}
					/>
					<div className="flex flex-wrap gap-2">
						<Button
							size="sm"
							disabled={!feedback.trim()}
							onClick={() =>
								openMailto({
									subject: "Mangocut feedback",
									body: feedback.trim(),
								})
							}
						>
							Email feedback
						</Button>
						<Button asChild size="sm" variant="outline">
							<a href={SOCIAL_LINKS.discord} target="_blank" rel="noreferrer">
								Discord
							</a>
						</Button>
					</div>
				</div>

				<div className="flex flex-col gap-3">
					<h2 className="text-2xl font-semibold">Request a feature</h2>
					<textarea
						className="border-input bg-background min-h-24 w-full rounded-md border px-3 py-2 text-sm"
						placeholder="Describe the feature and why it matters…"
						value={featureRequest}
						onChange={(e) => setFeatureRequest(e.target.value)}
					/>
					<div className="flex flex-wrap gap-2">
						<Button
							size="sm"
							disabled={!featureRequest.trim()}
							onClick={() =>
								openMailto({
									subject: "Mangocut feature request",
									body: featureRequest.trim(),
								})
							}
						>
							Email request
						</Button>
						<Button asChild size="sm" variant="outline">
							<a
								href={`${SOCIAL_LINKS.github}/issues/new`}
								target="_blank"
								rel="noreferrer"
							>
								GitHub issue
							</a>
						</Button>
					</div>
				</div>
			</section>
		</div>
	);
}

function StatCard({
	label,
	value,
	hint,
}: {
	label: string;
	value: string;
	hint?: string;
}) {
	return (
		<div className="rounded-lg border px-4 py-3">
			<p className="text-muted-foreground text-xs">{label}</p>
			<p className="mt-1 text-xl font-semibold tracking-tight">{value}</p>
			{hint ? <p className="text-muted-foreground mt-1 text-[11px]">{hint}</p> : null}
		</div>
	);
}

function formatDuration(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds <= 0) return "—";
	const total = Math.round(seconds);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	if (h > 0) return `${h}h ${m}m`;
	if (m > 0) return `${m}m ${s}s`;
	return `${s}s`;
}
