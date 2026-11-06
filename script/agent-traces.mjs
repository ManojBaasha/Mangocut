#!/usr/bin/env node
// Inspect recorded Mangocut agent turns from the local Langfuse, as plain text
// or JSON, so a coding agent (or a human in a terminal) can see what happened.
//
//   bun run traces list [--limit 20] [--session ID] [--failed] [--json]
//   bun run traces show <traceId> [--full] [--json]
//   bun run traces failures [--limit 20] [--json]
//
// A turn "failed" when its status is not completed, a tool call errored, a
// model call returned an error, or any score (incl. eval/*) is below 0.5.
// Credentials come from LANGFUSE_* env vars or observability/langfuse/.env.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readEnvFile(file) {
	if (!existsSync(file)) return {};
	const out = {};
	for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
		const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
		if (match) out[match[1]] = match[2].replace(/^["']|["']$/g, "");
	}
	return out;
}

function config() {
	const stack = readEnvFile(path.join(repoRoot, "observability", "langfuse", ".env"));
	const web = readEnvFile(path.join(repoRoot, "apps", "web", ".env.local"));
	const publicKey =
		process.env.LANGFUSE_PUBLIC_KEY || web.LANGFUSE_PUBLIC_KEY || stack.LANGFUSE_INIT_PROJECT_PUBLIC_KEY;
	const secretKey =
		process.env.LANGFUSE_SECRET_KEY || web.LANGFUSE_SECRET_KEY || stack.LANGFUSE_INIT_PROJECT_SECRET_KEY;
	const baseUrl =
		process.env.LANGFUSE_BASE_URL ||
		web.LANGFUSE_BASE_URL ||
		`http://127.0.0.1:${stack.LANGFUSE_HOST_PORT || "3100"}`;
	if (!publicKey || !secretKey) {
		fail("No Langfuse keys. Run `bun run observability:setup && bun run observability:up`.");
	}
	return { baseUrl, auth: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}` };
}

function fail(message) {
	console.error(message);
	process.exit(1);
}

async function api(cfg, pathAndQuery) {
	let res;
	try {
		res = await fetch(`${cfg.baseUrl}${pathAndQuery}`, { headers: { Authorization: cfg.auth } });
	} catch {
		fail(`Langfuse is not reachable at ${cfg.baseUrl}. Start it with \`bun run observability:up\`.`);
	}
	if (!res.ok) fail(`Langfuse ${res.status} for ${pathAndQuery}: ${(await res.text()).slice(0, 300)}`);
	return res.json();
}

const meta = (o) => (o.metadata && typeof o.metadata === "object" ? o.metadata : {});
const short = (id) => (id ? id.slice(0, 12) : "-");
const oneLine = (v, max = 120) => {
	const s = typeof v === "string" ? v : JSON.stringify(v ?? "");
	const flat = s.replace(/\s+/g, " ").trim();
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};
const parseMaybe = (v) => {
	if (typeof v !== "string") return v;
	try {
		return JSON.parse(v);
	} catch {
		return v;
	}
};

async function loadTurn(cfg, traceId) {
	const [obs, scores] = await Promise.all([
		api(cfg, `/api/public/v2/observations?traceId=${traceId}&fields=core,basic,io,metadata,model,usage&limit=200`),
		api(cfg, `/api/public/v3/scores?traceId=${traceId}&fields=core,details&limit=100`),
	]);
	const all = obs.data ?? [];
	const root = all.find((o) => o.name === "agent-turn" && !o.parentObservationId) ?? all.find((o) => o.name === "agent-turn");
	const byStart = (a, b) => String(a.startTime).localeCompare(String(b.startTime));
	const calls = all.filter((o) => o.type === "GENERATION").sort(byStart);
	const tools = all.filter((o) => (o.name ?? "").startsWith("tool:")).sort(byStart);
	return { traceId, root, calls, tools, scores: scores.data ?? [] };
}

function summarize(turn) {
	const m = turn.root ? meta(turn.root) : {};
	const toolErrors = turn.tools.filter((t) => meta(t).status === "error" || t.level === "ERROR");
	const callErrors = turn.calls.filter((c) => c.level === "ERROR" || (meta(c).statusCode ?? 200) >= 400);
	const scores = Object.fromEntries(turn.scores.map((s) => [s.name, s.value]));
	const lowScores = turn.scores.filter((s) => typeof s.value === "number" && s.value < 0.5);
	const status = m.status ?? (turn.root ? "unknown" : "missing-root");
	const cost = turn.calls.reduce((sum, c) => sum + (c.totalCost ?? 0), 0);
	const tokens = turn.calls.reduce((sum, c) => sum + (c.usageDetails?.total ?? 0), 0);
	return {
		traceId: turn.traceId,
		sessionId: turn.root?.sessionId ?? null,
		startTime: turn.root?.startTime ?? null,
		status,
		error: m.error ?? null,
		platform: m.platform ?? null,
		model: m.model ?? null,
		steps: m.steps ?? turn.calls.length,
		modelCalls: turn.calls.length,
		toolCalls: turn.tools.length,
		toolErrors: toolErrors.map((t) => ({ tool: t.name.slice(5), step: meta(t).step, error: oneLine(meta(t).error ?? t.statusMessage ?? t.output, 300) })),
		modelErrors: callErrors.map((c) => ({ step: meta(c).step, statusCode: meta(c).statusCode, error: oneLine(meta(c).error ?? c.statusMessage ?? c.output, 300) })),
		tokens,
		cost: Number(cost.toFixed(6)),
		scores,
		failed: status !== "completed" || toolErrors.length > 0 || callErrors.length > 0 || lowScores.length > 0,
		request: turn.root?.input ?? null,
		reply: turn.root?.output ?? null,
	};
}

async function recentTurnIds(cfg, { limit, session }) {
	const q = new URLSearchParams({ name: "agent-turn", fields: "core,basic", limit: String(Math.min(limit, 100)) });
	if (session) q.set("sessionId", session);
	const res = await api(cfg, `/api/public/v2/observations?${q}`);
	return (res.data ?? [])
		.filter((o) => !o.parentObservationId)
		.sort((a, b) => String(b.startTime).localeCompare(String(a.startTime)))
		.slice(0, limit)
		.map((o) => o.traceId);
}

function printList(rows, emptyMessage) {
	if (rows.length === 0) return console.log(emptyMessage);
	for (const r of rows) {
		const flags = [
			r.toolErrors.length ? `${r.toolErrors.length} tool error(s)` : "",
			r.modelErrors.length ? `${r.modelErrors.length} model error(s)` : "",
			r.scores.preview_accepted === 0 ? "preview rejected" : r.scores.preview_accepted === 1 ? "preview accepted" : "",
		].filter(Boolean);
		console.log(
			`${r.failed ? "FAIL" : "ok  "}  ${r.startTime ?? "-"}  ${r.traceId}  ${r.status}  steps=${r.steps} tools=${r.toolCalls}${flags.length ? `  [${flags.join(", ")}]` : ""}`,
		);
		console.log(`      "${oneLine(r.request, 100)}"`);
	}
}

function printTurn(turn, { full }) {
	const s = summarize(turn);
	const limit = full ? 4000 : 240;
	console.log(`Turn ${s.traceId}  ${s.failed ? "FAILED" : "ok"}`);
	console.log(`  status: ${s.status}${s.error ? ` (${s.error})` : ""}   platform: ${s.platform ?? "-"}   model: ${s.model ?? "-"}`);
	console.log(`  session: ${s.sessionId ?? "-"}   started: ${s.startTime ?? "-"}`);
	console.log(`  steps: ${s.steps}   model calls: ${s.modelCalls}   tool calls: ${s.toolCalls}   tokens: ${s.tokens}   cost: $${s.cost}`);
	console.log(`  request: ${oneLine(s.request, limit)}`);
	console.log(`  reply:   ${oneLine(s.reply, limit)}`);
	console.log("\nTimeline (per step: the model call, then the tools it asked for):");
	const events = [
		...turn.calls.map((c) => ({ at: c.startTime, kind: "model", o: c })),
		...turn.tools.map((t) => ({ at: t.startTime, kind: "tool", o: t })),
	].sort((a, b) => {
		const step = (e) => Number(meta(e.o).step ?? Number.MAX_SAFE_INTEGER);
		if (step(a) !== step(b)) return step(a) - step(b);
		if (a.kind !== b.kind) return a.kind === "model" ? -1 : 1;
		return String(a.at).localeCompare(String(b.at));
	});
	for (const e of events) {
		const m = meta(e.o);
		if (e.kind === "model") {
			const out = parseMaybe(e.o.output) ?? {};
			const toolNames = (out.tool_calls ?? []).map((t) => t.function?.name).filter(Boolean);
			const said = toolNames.length ? `calls ${toolNames.join(", ")}` : `says: ${oneLine(out.content ?? out, limit)}`;
			const err = e.o.level === "ERROR" || (m.statusCode ?? 200) >= 400 ? `  ERROR ${m.statusCode ?? ""} ${oneLine(m.error ?? e.o.statusMessage ?? "", limit)}` : "";
			console.log(`  [step ${m.step ?? "?"}] model ${m.model ?? e.o.providedModelName ?? ""} (${e.o.usageDetails?.total ?? "?"} tok, ${m.latencyMs ?? "?"} ms) → ${said}${err}`);
		} else {
			const bad = m.status === "error" || e.o.level === "ERROR";
			console.log(`  [step ${m.step ?? "?"}]   tool ${e.o.name.slice(5)} ${bad ? "ERROR" : "ok"} (${m.durationMs ?? "?"} ms, ${m.target ?? "-"})`);
			console.log(`             args:   ${oneLine(parseMaybe(e.o.input), limit)}`);
			console.log(`             ${bad ? "error" : "result"}: ${oneLine(bad ? (m.error ?? e.o.statusMessage ?? e.o.output) : parseMaybe(e.o.output), limit)}`);
		}
	}
	console.log("\nScores:");
	if (turn.scores.length === 0) console.log("  (none)");
	for (const sc of turn.scores) console.log(`  ${sc.name} = ${sc.value}${sc.comment ? `  (${oneLine(sc.comment, 160)})` : ""}`);
}

function parseArgs(argv) {
	const args = { _: [] };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--json" || a === "--failed" || a === "--full") args[a.slice(2)] = true;
		else if (a === "--limit" || a === "--session") args[a.slice(2)] = argv[++i];
		else args._.push(a);
	}
	args.limit = Number(args.limit ?? 20);
	return args;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const [command = "list", traceId] = args._;
	const cfg = config();
	if (command === "show") {
		if (!traceId) fail("Usage: bun run traces show <traceId> [--full] [--json]");
		const turn = await loadTurn(cfg, traceId);
		if (!turn.root && turn.calls.length === 0 && turn.tools.length === 0) fail(`No observations for trace ${traceId}.`);
		if (args.json) return console.log(JSON.stringify({ summary: summarize(turn), modelCalls: turn.calls, tools: turn.tools, scores: turn.scores }, null, 2));
		return printTurn(turn, { full: Boolean(args.full) });
	}
	if (command === "list" || command === "failures") {
		const ids = await recentTurnIds(cfg, { limit: args.limit, session: args.session });
		const rows = [];
		for (const id of ids) rows.push(summarize(await loadTurn(cfg, id)));
		const shown = command === "failures" || args.failed ? rows.filter((r) => r.failed) : rows;
		if (args.json) return console.log(JSON.stringify(shown, null, 2));
		printList(shown, command === "failures" || args.failed ? `No failed turns in the last ${rows.length}.` : "No agent turns recorded.");
		if (command === "failures" && shown.length > 0) console.log(`\nInspect one with: bun run traces show ${shown[0].traceId}`);
		return;
	}
	fail("Commands: list | show <traceId> | failures   (flags: --limit N --session ID --failed --full --json)");
}

main();
