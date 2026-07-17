/**
 * pi-statusline — session name on the editor top border + stats footer
 *
 *   ─────────────── the-name ─
 *   text box
 *   ─────────────────────────
 *   [model · effort] [ctx …] [usage] [branch/diff] [#pr]
 *
 * Install:
 *   pi install /path/to/pi-extensions/packages/pi-statusline
 *
 * Commands:
 *   /statusline [on|off|refresh]
 */

import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	CustomEditor,
	type ExtensionAPI,
	type ExtensionContext,
	type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

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

// ── constants ────────────────────────────────────────────────────────

const USAGE_REFRESH_MS = 5 * 60_000;
const STATUS_KEY = "statusline";

// ── auth helpers ─────────────────────────────────────────────────────

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

function readPrNumber(cwd: string): number | null {
	try {
		const out = execFileSync(
			"gh",
			["pr", "view", "--json", "number", "-q", ".number"],
			{
				cwd,
				encoding: "utf8",
				timeout: 2500,
				stdio: ["pipe", "pipe", "pipe"],
			},
		).trim();
		const n = parseInt(out, 10);
		return Number.isFinite(n) ? n : null;
	} catch {
		return null;
	}
}

// ── editor top-border helper ─────────────────────────────────────────

/** Build a top/bottom border line with optional left/right labels. */
function fitBorder(
	left: string,
	right: string,
	width: number,
	border: (text: string) => string,
	fill: (text: string) => string = border,
): string {
	if (width <= 0) return "";
	if (width === 1) return border("─");

	let leftText = left;
	let rightText = right;
	const fixedWidth = 2; // leading + trailing ─
	const minimumGap = 3;

	while (
		fixedWidth + visibleWidth(leftText) + visibleWidth(rightText) + minimumGap > width &&
		visibleWidth(rightText) > 0
	) {
		rightText = truncateToWidth(rightText, Math.max(0, visibleWidth(rightText) - 1), "");
	}
	while (
		fixedWidth + visibleWidth(leftText) + visibleWidth(rightText) + minimumGap > width &&
		visibleWidth(leftText) > 0
	) {
		leftText = truncateToWidth(leftText, Math.max(0, visibleWidth(leftText) - 1), "");
	}

	const gapWidth = Math.max(
		0,
		width - fixedWidth - visibleWidth(leftText) - visibleWidth(rightText),
	);
	return `${border("─")}${leftText}${fill("─".repeat(gapWidth))}${rightText}${border("─")}`;
}

// ── extension ────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	let enabled = true;
	let thinkingLevel = "off";
	let sessionName: string | undefined;
	let git: GitState | null = null;
	let prNumber: number | null = null;
	let latestUsage: UsageSnapshot | null = null;
	let activeUsageKey: string | null = null;
	let refreshTimer: ReturnType<typeof setInterval> | null = null;
	let tuiRef: { requestRender: () => void } | null = null;
	const usageCache = new Map<string, UsageSnapshot>();

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

	const refreshGit = (cwd: string) => {
		git = readGit(cwd);
		prNumber = readPrNumber(cwd);
		tuiRef?.requestRender();
	};

	const resolveName = (ctx?: ExtensionContext): string | undefined => {
		const name =
			(ctx ? ctx.sessionManager.getSessionName() : undefined) ||
			pi.getSessionName() ||
			sessionName ||
			undefined;
		if (name) sessionName = name;
		return name;
	};

	const bracket = (theme: any, inner: string) =>
		theme.fg("dim", "[") + inner + theme.fg("dim", "]");

	/**
	 * Stats under the editor (session name lives on the editor top border).
	 *   [model · effort] [ctx …] [usage] [branch/diff] [#pr]
	 */
	const renderFooterLines = (
		ctx: ExtensionContext,
		theme: any,
		width: number,
		footerData?: { getGitBranch(): string | null },
	): string[] => {
		const dim = (s: string) => theme.fg("dim", s);
		resolveName(ctx);

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

		// context — color: default <50%, warning ≥50%, error ≥70%
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
		let ctxInner = dim("ctx —");
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

		// provider usage — Codex only (when windows available)
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
		const branch = git?.branch || footerData?.getGitBranch() || null;
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

		// PR only when `gh pr view` finds one for the current branch
		const prSeg =
			prNumber != null ? bracket(theme, theme.fg("accent", `#${prNumber}`)) : "";

		const sep = "  ";
		const parts = [modelSeg, ctxSeg, costSeg, ...usageSegs, gitSeg, prSeg].filter(Boolean);
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

	/** Session name on the top border of the text box (right side). */
	const applyEditor = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		if (!enabled) {
			ctx.ui.setEditorComponent(undefined);
			return;
		}

		class StatuslineEditor extends CustomEditor {
			constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
				super(tui, theme, keybindings, { paddingX: 0 });
				tuiRef = tui;
			}

			render(width: number): string[] {
				const lines = super.render(width);
				if (lines.length < 2) return lines;

				const thm = ctx.ui.theme;
				const name = resolveName(ctx);
				// ─────────────── the-name ─
				const topRight = name ? thm.fg("accent", ` ${name} `) : "";
				const borderColor = (text: string) => this.borderColor(text);
				lines[0] = fitBorder("", topRight, width, borderColor);
				return lines;
			}
		}

		ctx.ui.setEditorComponent(
			(tui, theme, keybindings) => new StatuslineEditor(tui, theme, keybindings),
		);
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
			});

			refreshGit(ctx.cwd);
			const key = detectUsageKey(ctx.model?.provider);
			if (key) {
				pullUsage(key);
				startTimer();
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
		applyEditor(ctx);
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
		const key = detectUsageKey(event.model?.provider);
		if (key) {
			pullUsage(key, true);
			startTimer();
		} else {
			activeUsageKey = null;
			latestUsage = null;
			stopTimer();
		}
		tuiRef?.requestRender();
		// ensure UI bound after restore
		if (enabled && ctx.hasUI && !tuiRef) applyAll(ctx);
	});

	pi.on("turn_end", async (_event, ctx) => {
		refreshGit(ctx.cwd);
	});

	// ── command ──────────────────────────────────────────────────────

	pi.registerCommand("statusline", {
		description: "Statusline footer: on | off | refresh",
		handler: async (args, ctx) => {
			const cmd = args.trim().toLowerCase();
			if (!cmd || cmd === "status") {
				const segs = [
					`enabled=${enabled}`,
					`session=${sessionName || ctx.sessionManager.getSessionName() || "(unnamed)"}`,
					`model=${ctx.model?.provider}/${ctx.model?.id ?? "?"}`,
					`effort=${thinkingLevel}`,
					`usage=${latestUsage?.provider ?? "—"} ${latestUsage?.windows.map((w) => `${w.label}:${Math.round(100 - w.usedPercent)}%`).join(",") || latestUsage?.error || "—"}`,
					`branch=${git?.branch ?? "—"}`,
					`pr=${prNumber ?? "—"}`,
				];
				ctx.ui.notify(segs.join(" · "), "info");
				return;
			}
			if (cmd === "on" || cmd === "enable") {
				enabled = true;
				applyAll(ctx);
				ctx.ui.notify("Statusline on", "info");
				return;
			}
			if (cmd === "off" || cmd === "disable" || cmd === "default") {
				enabled = false;
				stopTimer();
				ctx.ui.setFooter(undefined);
				ctx.ui.setEditorComponent(undefined);
				ctx.ui.notify("Default footer + editor restored", "info");
				return;
			}
			if (cmd === "refresh") {
				refreshGit(ctx.cwd);
				const key = detectUsageKey(ctx.model?.provider);
				if (key) pullUsage(key, true);
				tuiRef?.requestRender();
				ctx.ui.notify("Statusline refreshed", "info");
				return;
			}
			ctx.ui.notify("Usage: /statusline [on|off|refresh]", "error");
		},
	});
}
