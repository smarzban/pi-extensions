/**
 * pi-statusline: session/model stats footer
 *
 *   [model · effort] [ctx …] [usage] [branch/diff] [#pr]
 *
 * Install:
 *   pi install /path/to/pi-extensions/packages/pi-statusline
 *
 * Commands:
 *   /statusline [on|off|refresh]
 *   /statusline usage [on|off]   Opt in/out of provider quota (off by default; reads auth + network)
 */

import { execFile, execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { hyperlink, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// ── types ────────────────────────────────────────────────────────────

interface RateWindow {
	label: string;
	/** Used percent 0–100 (display as remaining = 100 - used when preferred). */
	usedPercent: number;
	resetsIn?: string;
}

interface UsageSnapshot {
	provider: string;
	windows: RateWindow[];
	error?: string;
	fetchedAt: number;
}

interface GitState {
	branch: string | null;
	ahead: number;
	behind: number;
	/** Staged index changes (+) */
	staged: number;
	/** Unstaged worktree changes (*) */
	unstaged: number;
	/** Untracked files (?) */
	untracked: number;
}

interface PullRequest {
	number: number;
	url: string;
}

// ── constants ────────────────────────────────────────────────────────

const USAGE_REFRESH_MS = 5 * 60_000;
const PR_REFRESH_MS = 30_000;
const STATUS_KEY = "statusline";

// ── persisted settings ───────────────────────────────────────────────

interface PersistedState {
	/** Custom footer enabled (default true). */
	enabled?: boolean;
	/**
	 * Provider quota display. OFF by default: while off, no auth files are read and no
	 * network calls are made. Turn on with `/statusline usage on`.
	 */
	usageEnabled?: boolean;
	/** Session name segment [⚑ name] (default true). */
	sessionName?: boolean;
	/** Tokens/sec segment (default true). */
	tps?: boolean;
	/** Time-to-first-token segment (default true). */
	ttft?: boolean;
}

function statePath(): string {
	return join(getAgentDir(), "statusline.json");
}

function loadState(): PersistedState {
	const path = statePath();
	if (!existsSync(path)) return {};
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as PersistedState;
	} catch {
		return {};
	}
}

function saveState(state: PersistedState): void {
	const path = statePath();
	try {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${JSON.stringify(state, null, "\t")}\n`, "utf-8");
	} catch {
		// Non-fatal: statusline still works without persistence.
	}
}

// ── auth helpers ─────────────────────────────────────────────────────
//
// Everything below (reading auth files, resolving `!cmd`/ENV auth values, and the network
// fetchers) is reached ONLY when the user has opted into provider usage via
// `/statusline usage on`. With usage off (the default), none of this runs.

function loadAuthJson(): Record<string, any> {
	const path = join(homedir(), ".pi", "agent", "auth.json");
	try {
		if (existsSync(path)) return JSON.parse(readFileSync(path, "utf-8"));
	} catch {
		// ignore
	}
	return {};
}

function resolveAuthValue(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	if (trimmed.startsWith("!")) {
		try {
			return (
				execSync(trimmed.slice(1), {
					encoding: "utf-8",
					stdio: ["pipe", "pipe", "pipe"],
					timeout: 2000,
				}).trim() || undefined
			);
		} catch {
			return undefined;
		}
	}
	if (/^[A-Z][A-Z0-9_]*$/.test(trimmed) && process.env[trimmed]) {
		return process.env[trimmed];
	}
	return trimmed;
}

function authField(provider: string, ...keys: string[]): string | undefined {
	const entry = loadAuthJson()[provider];
	if (!entry) return undefined;
	if (typeof entry === "string") return resolveAuthValue(entry);
	for (const k of keys) {
		const v = resolveAuthValue(entry[k]);
		if (v) return v;
	}
	return undefined;
}

function getCodexCreds(): { token: string; accountId?: string } | undefined {
	const access = authField("openai-codex", "access", "key");
	if (access) {
		const accountId = authField("openai-codex", "accountId");
		return { token: access, accountId };
	}
	const codexPath = join(process.env.CODEX_HOME || join(homedir(), ".codex"), "auth.json");
	try {
		if (!existsSync(codexPath)) return undefined;
		const data = JSON.parse(readFileSync(codexPath, "utf-8"));
		if (data.OPENAI_API_KEY) return { token: data.OPENAI_API_KEY };
		if (data.tokens?.access_token) {
			return {
				token: data.tokens.access_token,
				accountId: data.tokens.account_id,
			};
		}
	} catch {
		// ignore
	}
	return undefined;
}

// ── formatting ───────────────────────────────────────────────────────

function formatResetTime(date: Date): string {
	const diffMs = date.getTime() - Date.now();
	if (diffMs < 0) return "now";
	const mins = Math.floor(diffMs / 60_000);
	if (mins < 60) return `${mins}m`;
	const hours = Math.floor(mins / 60);
	const rem = mins % 60;
	if (hours < 24) return rem > 0 ? `${hours}h${rem}m` : `${hours}h`;
	const days = Math.floor(hours / 24);
	const rh = hours % 24;
	return rh > 0 ? `${days}d${rh}h` : `${days}d`;
}

function clampPercent(n: number): number {
	if (!Number.isFinite(n)) return 0;
	return Math.max(0, Math.min(100, n));
}

function formatTokens(n: number): string {
	if (!Number.isFinite(n) || n < 0) return "?";
	if (n >= 1_000_000) {
		const m = n / 1_000_000;
		return m % 1 === 0 ? `${m}M` : `${m.toFixed(1).replace(/\.0$/, "")}M`;
	}
	if (n >= 1000) return `${Math.round(n / 1000)}k`;
	return `${Math.round(n)}`;
}

function abbreviateCwd(cwd: string): string {
	const home = process.env.HOME || process.env.USERPROFILE;
	if (home && cwd.startsWith(home)) return `~${cwd.slice(home.length)}`;
	return cwd;
}

function windowLabel(seconds: number | undefined, fallback: string): string {
	if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return fallback;
	const hour = 3600;
	const day = 24 * hour;
	if (Math.abs(seconds - 5 * hour) <= 2 * hour) return "5h";
	if (Math.abs(seconds - day) <= 2 * hour) return "Day";
	if (Math.abs(seconds - 7 * day) <= 2 * hour) return "Week";
	if (seconds < hour) return `${Math.max(1, Math.round(seconds / 60))}m`;
	if (seconds < 48 * hour) return `${Math.round(seconds / hour)}h`;
	return `${Math.round(seconds / day)}d`;
}

async function fetchWithTimeout(
	url: string,
	init: RequestInit,
	timeoutMs = 5000,
): Promise<Response> {
	const controller = new AbortController();
	const t = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(url, {
			...init,
			signal: controller.signal,
			headers: {
				Accept: "application/json",
				"User-Agent": "pi-statusline",
				...(init.headers as Record<string, string> | undefined),
			},
		});
	} finally {
		clearTimeout(t);
	}
}

// ── usage fetchers ───────────────────────────────────────────────────

async function fetchCodexUsage(): Promise<UsageSnapshot> {
	const creds = getCodexCreds();
	if (!creds) {
		return { provider: "Codex", windows: [], error: "no-auth", fetchedAt: Date.now() };
	}
	try {
		const headers: Record<string, string> = {
			Authorization: `Bearer ${creds.token}`,
		};
		if (creds.accountId) headers["ChatGPT-Account-Id"] = creds.accountId;

		const res = await fetchWithTimeout("https://chatgpt.com/backend-api/wham/usage", {
			method: "GET",
			headers,
		});
		if (!res.ok) {
			return {
				provider: "Codex",
				windows: [],
				error: `HTTP ${res.status}`,
				fetchedAt: Date.now(),
			};
		}
		const data = (await res.json()) as any;
		const windows: RateWindow[] = [];

		const push = (w: any, fallback: string) => {
			if (!w) return;
			const resetDate = w.reset_at ? new Date(w.reset_at * 1000) : undefined;
			windows.push({
				label: windowLabel(w.limit_window_seconds, fallback),
				usedPercent: clampPercent(w.used_percent || 0),
				resetsIn: resetDate ? formatResetTime(resetDate) : undefined,
			});
		};
		push(data.rate_limit?.primary_window, "5h");
		push(data.rate_limit?.secondary_window, "Week");

		return { provider: "Codex", windows, fetchedAt: Date.now() };
	} catch (e) {
		return { provider: "Codex", windows: [], error: String(e), fetchedAt: Date.now() };
	}
}

/** Only Codex exposes a reliable remaining-% API with pi auth. */
const PROVIDER_MAP: Record<string, string> = {
	"openai-codex": "codex",
};

async function fetchUsageFor(key: string): Promise<UsageSnapshot> {
	if (key === "codex") return fetchCodexUsage();
	return {
		provider: "Unknown",
		windows: [],
		error: "unknown-provider",
		fetchedAt: Date.now(),
	};
}

// ── git + PR ─────────────────────────────────────────────────────────

function parseGitStatus(output: string): GitState {
	let branch: string | null = null;
	let ahead = 0;
	let behind = 0;
	let staged = 0;
	let unstaged = 0;
	let untracked = 0;

	for (const line of output.split("\n")) {
		if (!line) continue;
		if (line.startsWith("# branch.head ")) {
			const head = line.slice("# branch.head ".length).trim();
			branch = head && head !== "(detached)" ? head : null;
			continue;
		}
		if (line.startsWith("# branch.ab ")) {
			const m = line.match(/^# branch\.ab \+(\d+) -(\d+)$/);
			if (m) {
				ahead = parseInt(m[1]!, 10) || 0;
				behind = parseInt(m[2]!, 10) || 0;
			}
			continue;
		}
		// Untracked
		if (line.startsWith("? ")) {
			untracked++;
			continue;
		}
		// Ordinary / rename / copy: "1 XY ..." or "2 XY ..."
		if (line.startsWith("1 ") || line.startsWith("2 ")) {
			const xy = line.slice(2, 4); // two status chars
			const x = xy[0] ?? ".";
			const y = xy[1] ?? ".";
			if (x !== ".") staged++;
			if (y !== ".") unstaged++;
			continue;
		}
		// Unmerged
		if (line.startsWith("u ")) {
			unstaged++;
		}
	}
	return { branch, ahead, behind, staged, unstaged, untracked };
}

function readGit(cwd: string): GitState | null {
	try {
		const out = execFileSync(
			"git",
			["status", "--porcelain=v2", "--branch"],
			{
				cwd,
				encoding: "utf8",
				timeout: 1500,
				stdio: ["pipe", "pipe", "pipe"],
			},
		);
		return parseGitStatus(out);
	} catch {
		return null;
	}
}

/**
 * Async so the TUI event loop never blocks on a GitHub API round-trip.
 * Result tri-state: `undefined` = lookup failed (caller keeps the current
 * value), `null` = definitively no open PR (merged/closed/none — caller
 * clears the segment), PullRequest = open PR.
 */
function readPr(cwd: string, branch: string): Promise<PullRequest | null | undefined> {
	return new Promise((resolve) => {
		execFile(
			"gh",
			["pr", "list", "--head", branch, "--state", "open", "--json", "number,url", "--limit", "1"],
			{ cwd, encoding: "utf8", timeout: 5000 },
			(error, stdout) => {
				// `gh pr list` returns [] when this branch has no open PR, so a
				// merged or closed PR is distinguishable from a failed lookup.
				if (error) return resolve(undefined);
				try {
					const data = JSON.parse(stdout.trim() || "[]") as Array<{
						number?: unknown;
						url?: unknown;
					}>;
					if (data.length === 0) return resolve(null);
					const number = Number(data[0]?.number);
					const url = data[0]?.url;
					resolve(
						Number.isFinite(number) && typeof url === "string" && url
							? { number, url }
							: undefined,
					);
				} catch {
					resolve(undefined);
				}
			},
		);
	});
}

// ── extension ────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	const saved = loadState();
	let enabled = saved.enabled !== false;
	// Provider quota is opt-in: nothing is read or fetched until the user turns it on.
	let usageEnabled = saved.usageEnabled === true;
	let sessionNameEnabled = saved.sessionName !== false;
	let tpsEnabled = saved.tps !== false;
	let ttftEnabled = saved.ttft !== false;
	let thinkingLevel = "off";
	let sessionName: string | undefined;
	let git: GitState | null = null;
	/** Wall-clock start of the assistant message currently streaming. */
	let msgStartAt: number | null = null;
	/** Wall clock of the first streamed update (≈ first token) of that message. */
	let firstTokenAt: number | null = null;
	/** Wall clock of the current turn's start (≈ when the provider request went out). */
	let turnStartAt: number | null = null;
	/** Output tokens/sec of the last finished assistant message. */
	let lastTps: number | null = null;
	/** Time-to-first-token (ms) of the last assistant message. */
	let lastTtftMs: number | null = null;
	let pr: PullRequest | null = null;
	/** Branch that `pr` was resolved for. */
	let prBranch: string | null = null;
	/** Last PR lookup, used to debounce the per-turn refresh. */
	let lastPrLookupAt = 0;
	/** True while an async `gh pr list` is running; prevents overlapping lookups. */
	let prLookupInFlight = false;
	let latestUsage: UsageSnapshot | null = null;
	let activeUsageKey: string | null = null;
	let refreshTimer: ReturnType<typeof setInterval> | null = null;
	let tuiRef: { requestRender: () => void } | null = null;
	const usageCache = new Map<string, UsageSnapshot>();

	const persist = () =>
		saveState({
			enabled,
			usageEnabled,
			sessionName: sessionNameEnabled,
			tps: tpsEnabled,
			ttft: ttftEnabled,
		});

	const stopTimer = () => {
		if (refreshTimer) {
			clearInterval(refreshTimer);
			refreshTimer = null;
		}
	};

	const startTimer = () => {
		stopTimer();
		refreshTimer = setInterval(() => {
			if (activeUsageKey) pullUsage(activeUsageKey, true);
		}, USAGE_REFRESH_MS);
	};

	const pullUsage = (key: string, force = false) => {
		activeUsageKey = key;
		const cached = usageCache.get(key);
		if (cached?.windows.length && !force) {
			latestUsage = cached;
			tuiRef?.requestRender();
		}
		fetchUsageFor(key)
			.then((u) => {
				if (activeUsageKey !== key) return;
				// Keep prior good windows on transient empty errors
				if (u.windows.length === 0 && u.error && cached?.windows.length) {
					return;
				}
				if (u.windows.length > 0) usageCache.set(key, u);
				latestUsage = u;
				tuiRef?.requestRender();
			})
			.catch(() => {});
	};

	const detectUsageKey = (provider: string | undefined): string | null => {
		if (!provider) return null;
		return PROVIDER_MAP[provider] ?? null;
	};

	// Local git status is cheap: safe to run every turn.
	const refreshGit = (cwd: string) => {
		git = readGit(cwd);
		tuiRef?.requestRender();
	};

	// PR lookup spawns `gh pr list` asynchronously (a GitHub API round-trip that must
	// never block the TUI). Check on turns, but debounce lookups so rapid-fire turns do
	// not create a request for every turn, and never stack overlapping lookups. Branch
	// changes and explicit refreshes always bypass the debounce. Merged/closed PRs
	// return null and clear the segment; failed lookups keep the current value.
	const refreshPr = (cwd: string, force = false) => {
		const branch = git?.branch ?? null;
		const branchChanged = branch !== prBranch;
		if (branchChanged && pr !== null) {
			pr = null;
			tuiRef?.requestRender();
		}
		if (!force && !branchChanged && Date.now() - lastPrLookupAt < PR_REFRESH_MS) return;
		if (prLookupInFlight) return;
		prBranch = branch;
		lastPrLookupAt = Date.now();
		if (!branch) return;
		prLookupInFlight = true;
		readPr(cwd, branch)
			.then((nextPr) => {
				prLookupInFlight = false;
				if ((git?.branch ?? null) !== branch) {
					refreshPr(cwd, true);
					return; // branch moved on; discard and refresh it
				}
				if (
					nextPr === undefined ||
					(nextPr?.number === pr?.number && nextPr?.url === pr?.url)
				)
					return; // failed or unchanged
				pr = nextPr;
				tuiRef?.requestRender();
			})
			.catch(() => {
				prLookupInFlight = false;
			});
	};

	const bracket = (theme: any, inner: string) =>
		theme.fg("dim", "[") + inner + theme.fg("dim", "]");

	/**
	 * Stats under the editor.
	 *   [model · effort] [ctx …] [usage] [branch/diff] [#pr]
	 */
	const renderFooterLines = (
		ctx: ExtensionContext,
		theme: any,
		width: number,
		footerData?: { getGitBranch(): string | null },
	): string[] => {
		const dim = (s: string) => theme.fg("dim", s);

		const level = (() => {
			try {
				return pi.getThinkingLevel?.() ?? thinkingLevel;
			} catch {
				return thinkingLevel;
			}
		})();
		if (level) thinkingLevel = level;

		// model · effort
		const modelId = ctx.model?.id?.split("/").pop() || "no-model";
		const effort = level && level !== "off" ? level : undefined;
		const modelInner = effort
			? theme.fg("accent", modelId) + dim(" · ") + theme.fg("accent", effort)
			: theme.fg("accent", modelId);
		const modelSeg = bracket(theme, modelInner);

		// context color: default <50%, warning ≥50%, error ≥70%
		const cu = ctx.getContextUsage?.();
		const total = cu?.contextWindow ?? ctx.model?.contextWindow ?? 0;
		const used = cu?.tokens ?? null;
		const pct =
			cu?.percent != null
				? Math.round(cu.percent)
				: used != null && total > 0
					? Math.round((used / total) * 100)
					: null;
		const ctxColor =
			pct == null ? "dim" : pct >= 70 ? "error" : pct >= 50 ? "warning" : "success";
		let ctxInner = dim("ctx ?");
		if (pct != null && used != null && total > 0) {
			ctxInner =
				theme.fg(ctxColor, `ctx ${pct}%`) +
				dim(" · ") +
				theme.fg(ctxColor, `${formatTokens(used)}/${formatTokens(total)}`);
		} else if (total > 0) {
			ctxInner = dim(`ctx ?/${formatTokens(total)}`);
		}
		const ctxSeg = bracket(theme, ctxInner);

		// session $ cost (from assistant usage.cost.total across the session)
		let totalCost = 0;
		try {
			for (const e of ctx.sessionManager.getEntries()) {
				if (e.type === "message" && (e as any).message?.role === "assistant") {
					totalCost += Number((e as any).message?.usage?.cost?.total) || 0;
				}
			}
		} catch {
			// ignore
		}
		const costSeg =
			totalCost > 0
				? bracket(theme, dim(`$${totalCost.toFixed(3)}`))
				: "";

		// output tokens/sec of the last assistant response (average over the whole
		// message, so time-to-first-token is included)
		const tpsSeg =
			tpsEnabled && lastTps != null
				? bracket(theme, dim(`${lastTps >= 10 ? Math.round(lastTps) : lastTps.toFixed(1)} t/s`))
				: "";

		// time-to-first-token of the last assistant response (wait before the
		// reply started appearing)
		const ttftSeg =
			ttftEnabled && lastTtftMs != null
				? bracket(
						theme,
						dim(
							lastTtftMs < 1000
								? `ttft ${Math.round(lastTtftMs)}ms`
								: `ttft ${(lastTtftMs / 1000).toFixed(1)}s`,
						),
					)
				: "";

		// provider usage: Codex only (when windows available)
		const usageSegs: string[] = [];
		if (latestUsage?.windows.length) {
			for (const w of latestUsage.windows) {
				const rem = Math.round(100 - w.usedPercent);
				const color =
					w.usedPercent >= 90 ? "error" : w.usedPercent >= 70 ? "warning" : "success";
				const body =
					theme.fg(color, `${w.label} ${rem}% rem`) +
					(w.resetsIn ? dim(" · ") + dim(w.resetsIn) : "");
				usageSegs.push(bracket(theme, body));
			}
		}

		// branch + staged(+) / unstaged(*) / untracked(?)
		// A successful Git read with no branch (detached HEAD) must not fall back
		// to footerData's cached branch, or a deleted/old branch can linger.
		const branch = git !== null ? git.branch : footerData?.getGitBranch() || null;
		let gitSeg = "";
		if (branch) {
			const dirty =
				(git?.staged ?? 0) + (git?.unstaged ?? 0) + (git?.untracked ?? 0) > 0;
			const color = dirty ? "warning" : "success";
			// branch sign + name
			let g = theme.fg(color, `⎇ ${branch}`);
			const bits: string[] = [];
			if (git?.staged) bits.push(theme.fg("success", `+${git.staged}`));
			if (git?.unstaged) bits.push(theme.fg("warning", `*${git.unstaged}`));
			if (git?.untracked) bits.push(theme.fg("muted", `?${git.untracked}`));
			if (bits.length) g += " " + bits.join(" ");
			if (git?.ahead) g += theme.fg("success", ` ↑${git.ahead}`);
			if (git?.behind) g += theme.fg("error", ` ↓${git.behind}`);
			gitSeg = bracket(theme, g);
		}

		// Open PR only; merged and closed PRs are omitted. Always emit OSC 8 so
		// hyperlink-capable terminals can follow the PR even when auto-detection is conservative.
		const prText = pr ? theme.fg("accent", `#${pr.number}`) : "";
		const prSeg = pr ? bracket(theme, hyperlink(prText, pr.url)) : "";

		// Session name (first segment, when named and enabled): ⚑ name
		// Live session first: the module-level cache is shared by every session in this
		// process, so an unnamed session could otherwise inherit another one's name.
		const nameNow = ctx.sessionManager.getSessionName() || sessionName || undefined;
		const nameSeg =
			sessionNameEnabled && nameNow
				? bracket(theme, theme.fg("accent", `⚑ ${nameNow}`))
				: "";

		const sep = "  ";
		const parts = [nameSeg, modelSeg, ctxSeg, costSeg, tpsSeg, ttftSeg, ...usageSegs, gitSeg, prSeg].filter(Boolean);
		const lines: string[] = [];
		let current = "";
		for (const p of parts) {
			const candidate = current ? current + sep + p : p;
			if (visibleWidth(candidate) <= width) {
				current = candidate;
			} else {
				if (current) lines.push(truncateToWidth(current, width));
				current = truncateToWidth(p, width);
			}
		}
		if (current) lines.push(truncateToWidth(current, width));
		return lines.length ? lines : [dim("")];
	};

	const applyFooter = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		if (!enabled) {
			ctx.ui.setFooter(undefined);
			return;
		}

		ctx.ui.setFooter((tui, theme, footerData) => {
			tuiRef = tui;
			const unsubBranch = footerData.onBranchChange(() => {
				refreshGit(ctx.cwd);
				refreshPr(ctx.cwd);
			});

			refreshGit(ctx.cwd);
			refreshPr(ctx.cwd, true);
			if (usageEnabled) {
				const key = detectUsageKey(ctx.model?.provider);
				if (key) {
					pullUsage(key);
					startTimer();
				}
			}

			return {
				dispose: () => {
					unsubBranch();
					tuiRef = null;
					stopTimer();
				},
				invalidate() {},
				render(width: number): string[] {
					return renderFooterLines(ctx, theme, width, footerData);
				},
			};
		});
	};

	const applyAll = (ctx: ExtensionContext) => {
		applyFooter(ctx);
	};

	// ── events ───────────────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		sessionName = ctx.sessionManager.getSessionName() ?? pi.getSessionName();
		try {
			thinkingLevel = pi.getThinkingLevel?.() ?? thinkingLevel;
		} catch {
			// ignore
		}
		applyAll(ctx);
	});

	pi.on("session_info_changed", async (event) => {
		sessionName = event.name;
		tuiRef?.requestRender();
	});

	pi.on("thinking_level_select", async (event, _ctx) => {
		thinkingLevel = event.level ?? "off";
		tuiRef?.requestRender();
	});

	pi.on("model_select", async (event, ctx) => {
		if (usageEnabled) {
			const key = detectUsageKey(event.model?.provider);
			if (key) {
				pullUsage(key, true);
				startTimer();
			} else {
				activeUsageKey = null;
				latestUsage = null;
				stopTimer();
			}
		}
		tuiRef?.requestRender();
		// ensure UI bound after restore
		if (enabled && ctx.hasUI && !tuiRef) applyAll(ctx);
	});

	// tokens/sec: decode-only rate, matching how Ollama / LM Studio / llama.cpp
	// report it. The clock starts at the first streamed update (≈ first token),
	// so prompt-processing time (TTFT) is excluded; output tokens are divided by
	// the streaming wall clock. Falls back to message_start if no update fires.
	//
	// TTFT is anchored to turn_start (≈ when the provider request went out), not
	// message_start: pi only creates the assistant message once the stream begins,
	// so message_start → first update is ~0ms and useless as a wait measure.
	pi.on("turn_start", async () => {
		turnStartAt = Date.now();
	});

	pi.on("message_start", async (event) => {
		if (event.message.role !== "assistant") return;
		msgStartAt = Date.now();
		firstTokenAt = null;
	});

	pi.on("message_update", async (event) => {
		if (event.message.role !== "assistant") return;
		if (firstTokenAt == null) {
			firstTokenAt = Date.now();
			if (turnStartAt != null) {
				lastTtftMs = firstTokenAt - turnStartAt;
				turnStartAt = null; // one TTFT per turn
				tuiRef?.requestRender();
			}
		}
	});

	pi.on("message_end", async (event) => {
		if (event.message.role !== "assistant") return;
		const startedAt = firstTokenAt ?? msgStartAt;
		msgStartAt = null;
		firstTokenAt = null;
		if (startedAt == null) return;
		const elapsedMs = Date.now() - startedAt;
		const output = Number((event.message as any).usage?.output) || 0;
		// Sub-second blips and zero-token messages produce junk rates; skip them
		// and keep the previous reading.
		if (output <= 0 || elapsedMs < 500) return;
		lastTps = output / (elapsedMs / 1000);
		tuiRef?.requestRender();
	});

	pi.on("turn_end", async (_event, ctx) => {
		refreshGit(ctx.cwd);
		refreshPr(ctx.cwd);
	});

	// ── command ──────────────────────────────────────────────────────

	pi.registerCommand("statusline", {
		description:
			"Statusline footer: on | off | usage on|off | session on|off | tps on|off | ttft on|off | refresh",
		handler: async (args, ctx) => {
			const cmd = args.trim().toLowerCase();
			if (!cmd || cmd === "status") {
				const usageStr = !usageEnabled
					? "off"
					: `${latestUsage?.provider ?? "…"} ${latestUsage?.windows.map((w) => `${w.label}:${Math.round(100 - w.usedPercent)}%`).join(",") || latestUsage?.error || "…"}`;
				const segs = [
					`enabled=${enabled}`,
					`session=${sessionName || ctx.sessionManager.getSessionName() || "(unnamed)"}`,
					`model=${ctx.model?.provider}/${ctx.model?.id ?? "?"}`,
					`effort=${thinkingLevel}`,
					`usage=${usageStr}`,
					`branch=${git?.branch ?? "none"}`,
					`pr=${pr?.number ?? "none"}`,
				];
				ctx.ui.notify(segs.join(" · "), "info");
				return;
			}
			if (cmd === "on" || cmd === "enable") {
				enabled = true;
				persist();
				applyAll(ctx);
				ctx.ui.notify("Statusline on", "info");
				return;
			}
			if (cmd === "off" || cmd === "disable" || cmd === "default") {
				enabled = false;
				persist();
				stopTimer();
				ctx.ui.setFooter(undefined);
				ctx.ui.notify("Default footer restored", "info");
				return;
			}
			// Provider quota display is opt-in (reads auth + calls the provider). Codex only.
			if (cmd === "usage" || cmd.startsWith("usage ")) {
				const arg = cmd.slice("usage".length).trim();
				if (arg === "" || arg === "status") {
					ctx.ui.notify(
						`Provider usage: ${usageEnabled ? "on" : "off"} (off = no tokens read, no network). Toggle: /statusline usage on|off`,
						"info",
					);
					return;
				}
				if (arg === "on" || arg === "enable") {
					usageEnabled = true;
					persist();
					const key = detectUsageKey(ctx.model?.provider);
					if (key) {
						pullUsage(key, true);
						startTimer();
					}
					tuiRef?.requestRender();
					ctx.ui.notify(
						"Provider usage on. Reads ~/.pi/agent/auth.json and calls the provider's usage API (Codex only).",
						"info",
					);
					return;
				}
				if (arg === "off" || arg === "disable") {
					usageEnabled = false;
					activeUsageKey = null;
					latestUsage = null;
					stopTimer();
					persist();
					tuiRef?.requestRender();
					ctx.ui.notify("Provider usage off. No tokens read, no network calls.", "info");
					return;
				}
				ctx.ui.notify("Usage: /statusline usage [on|off]", "error");
				return;
			}
			if (cmd === "refresh") {
				refreshGit(ctx.cwd);
				refreshPr(ctx.cwd, true);
				if (usageEnabled) {
					const key = detectUsageKey(ctx.model?.provider);
					if (key) pullUsage(key, true);
				}
				tuiRef?.requestRender();
				ctx.ui.notify("Statusline refreshed", "info");
				return;
			}
			// Speed segments: [N t/s] and [ttft …]
			if (cmd === "tps" || cmd.startsWith("tps ")) {
				const arg = cmd.slice("tps".length).trim();
				if (arg === "" || arg === "status") {
					ctx.ui.notify(`Tokens/sec segment: ${tpsEnabled ? "on" : "off"}. Toggle: /statusline tps on|off`, "info");
					return;
				}
				if (arg === "on" || arg === "enable") tpsEnabled = true;
				else if (arg === "off" || arg === "disable") tpsEnabled = false;
				else {
					ctx.ui.notify("Usage: /statusline tps [on|off]", "error");
					return;
				}
				persist();
				tuiRef?.requestRender();
				ctx.ui.notify(`Tokens/sec segment: ${tpsEnabled ? "on" : "off"}`, "info");
				return;
			}
			if (cmd === "ttft" || cmd.startsWith("ttft ")) {
				const arg = cmd.slice("ttft".length).trim();
				if (arg === "" || arg === "status") {
					ctx.ui.notify(`Time-to-first-token segment: ${ttftEnabled ? "on" : "off"}. Toggle: /statusline ttft on|off`, "info");
					return;
				}
				if (arg === "on" || arg === "enable") ttftEnabled = true;
				else if (arg === "off" || arg === "disable") ttftEnabled = false;
				else {
					ctx.ui.notify("Usage: /statusline ttft [on|off]", "error");
					return;
				}
				persist();
				tuiRef?.requestRender();
				ctx.ui.notify(`Time-to-first-token segment: ${ttftEnabled ? "on" : "off"}`, "info");
				return;
			}
			// Session name segment: [⚑ name]
			if (cmd === "session") {
				ctx.ui.notify(`Session name segment: ${sessionNameEnabled ? "on" : "off"}. Toggle: /statusline session on|off`, "info");
				return;
			}
			if (cmd.startsWith("session ")) {
				const arg = cmd.slice("session".length).trim();
				if (arg === "on" || arg === "enable") {
					sessionNameEnabled = true;
				} else if (arg === "off" || arg === "disable") {
					sessionNameEnabled = false;
				} else {
					ctx.ui.notify("Usage: /statusline session [on|off]", "error");
					return;
				}
				persist();
				tuiRef?.requestRender();
				ctx.ui.notify(`Session name segment: ${sessionNameEnabled ? "on" : "off"}`, "info");
				return;
			}
			ctx.ui.notify("Usage: /statusline [on|off|usage on|off|session on|off|tps on|off|ttft on|off|refresh]", "error");
		},
	});
}
