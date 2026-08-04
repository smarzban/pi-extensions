/**
 * pi-compact-tools — compact tool output display
 *
 * Replaces pi's verbose built-in tool rendering with one-line summaries,
 * expandable on demand (ctrl+o). Execution is fully delegated to the
 * originals, so the LLM still sees the complete output.
 *
 * Features:
 *   - Smart paths: relative to cwd inside project, ~/ under HOME, absolute otherwise
 *   - Bash timing: shows duration parsed from raw output
 *   - Write file size: byte count for sanity checks
 *   - Error emphasis: prominent ✗ prefix in red
 *   - Edit context hint: shows the enclosing function/class from the diff
 *   - /compact command: toggle on/off globally or per-tool
 *
 * Install:
 *   pi install /path/to/pi-extensions/packages/pi-compact-tools
 *
 * Commands:
 *   /toolview              Show status
 *   /toolview off          Disable all compact rendering (original verbose)
 *   /toolview on           Enable all compact rendering
 *   /toolview <tool> off   One tool back to verbose (bash/read/edit/write/grep/find/ls)
 *   /toolview <tool> on    Re-enable compact for that tool
 */

import {
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
	type BashToolDetails,
	type EditToolDetails,
	type ExtensionAPI,
	type FindToolDetails,
	type GrepToolDetails,
	type LsToolDetails,
	type ReadToolDetails,
} from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

// ── path display ────────────────────────────────────────────────────

/** Short path: relative inside cwd, ~ under HOME, absolute otherwise. */
function displayPath(p: string, cwd: string): string {
	const home = process.env.HOME || process.env.USERPROFILE;
	const rel = relative(cwd, p);
	// Inside cwd: relative path doesn't start with ..
	if (!rel.startsWith("..") && !rel.startsWith(sep + "..")) return rel || ".";
	// Under HOME
	if (home && p.startsWith(home)) return `~${p.slice(home.length)}`;
	// Absolute
	return p;
}

// ── formatting helpers ──────────────────────────────────────────────

/** Format byte count to human-readable. */
function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) {
		const kb = n / 1024;
		return kb < 10 ? `${kb.toFixed(1)} KB` : `${Math.round(kb)} KB`;
	}
	const mb = n / (1024 * 1024);
	return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`;
}

/** Human-readable duration. */
function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	const s = ms / 1000;
	return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
}

/**
 * Strip metadata lines appended by pi (timing, exit code, truncation notice).
 */
function stripBashMeta(output: string): string {
	return output
		.replace(/\n\n\[Showing lines [^\]]*\]\s*$/g, "")
		.replace(/\n\n\[Showing last [^\]]*\]\s*$/g, "")
		.replace(/\n\nCommand (exited with code \d+|aborted|timed out after [^\n]*)\s*$/g, "")
		.trimEnd();
}

/** Truncate visible text with ellipsis. */
function clip(text: string, maxLen: number): string {
	const flat = text.replace(/\n/g, " ").trim();
	return flat.length <= maxLen ? flat : `${flat.slice(0, maxLen - 1)}…`;
}

/**
 * Truncate long commands keeping head + tail. The tail usually holds the
 * actual command when the head is a long env assignment or `cd /long/path &&`.
 */
function clipCommand(text: string, maxLen: number): string {
	const flat = text.replace(/\n/g, " ").trim();
	if (flat.length <= maxLen) return flat;
	const head = Math.floor(maxLen * 0.3);
	const tail = maxLen - head - 1;
	return `${flat.slice(0, head)}…${flat.slice(flat.length - tail)}`;
}

/** Count +/- lines in a diff. */
function diffStats(diff: string): { add: number; rem: number } {
	let add = 0;
	let rem = 0;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+") && !line.startsWith("+++")) add++;
		else if (line.startsWith("-") && !line.startsWith("---")) rem++;
	}
	return { add, rem };
}

/** Count non-empty lines. */
function lineCount(text: string): number {
	return text.split("\n").filter((l) => l.trim()).length;
}

/** Extract enclosing function/class name from a diff (best-effort, multi-lang). */
function extractFuncHint(diff: string, patch?: string): string | null {
	// Try patch hunk header first: @@ ... @@ function_name
	if (patch) {
		const hunk = patch.match(/@@.*?@@\s+(.+)$/m);
		if (hunk) {
			const ctx = hunk[1]!.trim();
			const fn = parseFuncName(ctx);
			if (fn) return fn;
		}
	}
	// Scan context and changed lines for function/class declarations
	const patterns: RegExp[] = [
		/^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
		/^\s*(?:export\s+)?class\s+(\w+)/,
		/^\s*const\s+(\w+)\s*=\s*(?:async\s*)?\(/,
		/^\s*def\s+(\w+)/,
		/^\s*fn\s+(\w+)/,
		/^\s*func\s+(\w+)/,
		/^\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/,
		/^\s*(?:public|private|protected|static|\s)*\s*(?:async\s+)?(\w+)\s*\(/,
	];
	for (const line of diff.split("\n")) {
		const raw = line.slice(1); // strip leading +/- /space
		if (raw.trim().length < 5) continue;
		for (const pat of patterns) {
			const m = raw.match(pat);
			if (m?.[1] && !["if", "for", "while", "switch", "catch", "return"].includes(m[1])) {
				return m[1];
			}
		}
	}
	return null;
}

function parseFuncName(ctx: string): string | null {
	const patterns: RegExp[] = [
		/(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
		/class\s+(\w+)/,
		/def\s+(\w+)/,
		/fn\s+(\w+)/,
		/func\s+(\w+)/,
		/(\w+)\s*\(/,
	];
	for (const pat of patterns) {
		const m = ctx.match(pat);
		if (m?.[1] && !["if", "for", "while", "switch", "catch"].includes(m[1])) {
			return m[1];
		}
	}
	return null;
}

// ── persisted state ─────────────────────────────────────────────────

type ToolName = "bash" | "read" | "edit" | "write" | "grep" | "find" | "ls";
const TOOL_NAMES: ToolName[] = ["bash", "read", "edit", "write", "grep", "find", "ls"];

interface CompactState {
	enabled: boolean;
	tools: Partial<Record<ToolName, boolean>>;
}

function statePath(): string {
	return join(getAgentDir(), "toolview.json");
}

function loadState(): CompactState {
	const path = statePath();
	if (!existsSync(path)) return { enabled: true, tools: {} };
	try {
		const raw = JSON.parse(readFileSync(path, "utf-8"));
		return { enabled: raw.enabled !== false, tools: raw.tools ?? {} };
	} catch {
		return { enabled: true, tools: {} };
	}
}

function saveState(state: CompactState): void {
	const path = statePath();
	try {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${JSON.stringify(state, null, "\t")}\n`, "utf-8");
	} catch {
		// non-fatal
	}
}

// ── main ────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	const cwd = process.cwd();

	// Original tool instances (execution + fallback rendering)
	const originals = {
		bash: createBashTool(cwd),
		read: createReadTool(cwd),
		edit: createEditTool(cwd),
		write: createWriteTool(cwd),
		grep: createGrepTool(cwd),
		find: createFindTool(cwd),
		ls: createLsTool(cwd),
	};

	const state = loadState();
	const isOn = (t: ToolName): boolean =>
		state.enabled && state.tools[t] !== false;

	const d = (p: string) => displayPath(p, cwd);

	// Themed helpers
	const toolLabel = (theme: any, on: boolean, label: string) =>
		on ? theme.fg("toolTitle", theme.bold(label)) : theme.fg("muted", label);
	const dimOrMuted = (theme: any, on: boolean, text: string) =>
		on ? theme.fg("dim", text) : theme.fg("muted", theme.fg("dim", text));

	// ── bash ────────────────────────────────────────────────────────

	// Timing lives in shared render state, same mechanism the built-in uses.
	type BashRenderState = { startedAt?: number; endedAt?: number };

	pi.registerTool({
		name: "bash",
		label: "bash",
		description: originals.bash.description,
		parameters: originals.bash.parameters,

		async execute(id, params, signal, onUpdate) {
			return originals.bash.execute(id, params, signal, onUpdate);
		},

		renderCall(args, theme, context) {
			// Track start time regardless of on/off so toggling keeps timing intact
			const state = context.state as BashRenderState;
			if (context.executionStarted && state.startedAt === undefined) {
				state.startedAt = Date.now();
				state.endedAt = undefined;
			}
			if (!isOn("bash"))
				return originals.bash.renderCall!(args, theme, context as any);

			const cmd = clipCommand(args.command, 76);
			let t = `${toolLabel(theme, true, "$")} ${theme.fg("accent", cmd)}`;
			if (args.timeout) t += theme.fg("dim", ` (${args.timeout}s)`);
			return new Text(t, 0, 0);
		},

		renderResult(result, opts, theme, context) {
			if (!isOn("bash"))
				return originals.bash.renderResult!(result, opts, theme, context as any);
			if (opts.isPartial) return new Text(theme.fg("dim", "Running…"), 0, 0);

			const state = context.state as BashRenderState;
			if (state.startedAt !== undefined) state.endedAt ??= Date.now();
			const durationMs =
				state.startedAt !== undefined
					? (state.endedAt ?? Date.now()) - state.startedAt
					: undefined;

			const details = result.details as BashToolDetails | undefined;
			const raw = result.content[0]?.type === "text" ? result.content[0].text : "";
			const clean = stripBashMeta(raw);
			const lines = lineCount(clean);

			// Non-zero exits arrive as error results; pull the code from the status line
			let t: string;
			if (context.isError) {
				const m = raw.match(/exited with code (\d+)/);
				t = m ? theme.fg("error", `✗ exit ${m[1]}`) : theme.fg("error", "✗");
			} else {
				t = theme.fg("success", "✓");
			}

			if (lines > 0) t += theme.fg("dim", ` · ${lines} line${lines === 1 ? "" : "s"}`);
			if (durationMs !== undefined) t += theme.fg("dim", ` · ${formatDuration(durationMs)}`);
			if (details?.truncation?.truncated) t += theme.fg("warning", " [truncated]");

			if (opts.expanded && clean) {
				const preview = clean.split("\n").slice(0, 30);
				for (const line of preview) t += `\n${theme.fg("dim", line)}`;
				const total = clean.split("\n").length;
				if (total > 30)
					t += `\n${theme.fg("muted", `… ${total - 30} more lines`)}`;
			}
			return new Text(t, 0, 0);
		},
	});

	// ── read ────────────────────────────────────────────────────────

	pi.registerTool({
		name: "read",
		label: "read",
		description: originals.read.description,
		parameters: originals.read.parameters,

		async execute(id, params, signal, onUpdate) {
			return originals.read.execute(id, params, signal, onUpdate);
		},

		renderCall(args, theme) {
			const on = isOn("read");
			let t = `${toolLabel(theme, on, "read")} ${theme.fg("accent", d(args.path))}`;
			if (args.offset !== undefined || args.limit !== undefined) {
				const bits: string[] = [];
				if (args.offset) bits.push(`offset=${args.offset}`);
				if (args.limit) bits.push(`limit=${args.limit}`);
				t += dimOrMuted(theme, on, ` (${bits.join(", ")})`);
			}
			return new Text(t, 0, 0);
		},

		renderResult(result, opts, theme, context) {
			if (!isOn("read"))
				return originals.read.renderResult!(result, opts, theme, context as any);
			if (opts.isPartial) return new Text(theme.fg("dim", "Reading…"), 0, 0);

			const details = result.details as ReadToolDetails | undefined;
			const content = result.content[0];

			if (context.isError) {
				const firstLine =
					content?.type === "text" ? content.text.split("\n")[0] : "Read failed";
				return new Text(theme.fg("error", `✗ ${firstLine}`), 0, 0);
			}

			if (content?.type === "image")
				return new Text(theme.fg("success", "Image loaded"), 0, 0);

			if (content?.type !== "text")
				return new Text(theme.fg("error", "✗ No content"), 0, 0);

			const lines = content.text.split("\n").length;
			let t = theme.fg("success", `${lines} line${lines === 1 ? "" : "s"}`);
			if (details?.truncation?.truncated)
				t += theme.fg("warning", ` (truncated from ${details.truncation.totalLines})`);

			if (opts.expanded) {
				const preview = content.text.split("\n").slice(0, 20);
				for (const line of preview) t += `\n${theme.fg("dim", line)}`;
				if (lines > 20)
					t += `\n${theme.fg("muted", `… ${lines - 20} more lines`)}`;
			}
			return new Text(t, 0, 0);
		},
	});

	// ── edit ────────────────────────────────────────────────────────

	pi.registerTool({
		name: "edit",
		label: "edit",
		description: originals.edit.description,
		parameters: originals.edit.parameters,

		async execute(id, params, signal, onUpdate) {
			return originals.edit.execute(id, params, signal, onUpdate);
		},

		renderCall(args, theme) {
			const on = isOn("edit");
			const n = args.edits?.length ?? 1;
			return new Text(
				`${toolLabel(theme, on, "edit")} ${theme.fg("accent", d(args.path))}${dimOrMuted(theme, on, ` (${n} change${n === 1 ? "" : "s"})`)}`,
				0,
				0,
			);
		},

		renderResult(result, opts, theme, context) {
			if (!isOn("edit"))
				return originals.edit.renderResult!(result, opts, theme, context as any);
			if (opts.isPartial) return new Text(theme.fg("dim", "Editing…"), 0, 0);

			const details = result.details as EditToolDetails | undefined;
			const text = result.content[0]?.type === "text" ? result.content[0].text : "";
			if (context.isError)
				return new Text(theme.fg("error", `✗ ${text.split("\n")[0] || "Edit failed"}`), 0, 0);

			if (!details?.diff)
				return new Text(theme.fg("success", "Applied"), 0, 0);

			const { add, rem } = diffStats(details.diff);
			const funcHint = extractFuncHint(details.diff, details.patch);

			let t: string;
			if (add === 0 && rem === 0) {
				t = theme.fg("success", "Applied");
			} else {
				t = `${theme.fg("success", `+${add}`)}${theme.fg("dim", " / ")}${theme.fg("error", `-${rem}`)}`;
			}
			if (funcHint) t += theme.fg("muted", ` in ${funcHint}`);

			if (opts.expanded) {
				const diffLines = details.diff.split("\n").slice(0, 40);
				for (const line of diffLines) {
					if (line.startsWith("+") && !line.startsWith("+++"))
						t += `\n${theme.fg("success", line)}`;
					else if (line.startsWith("-") && !line.startsWith("---"))
						t += `\n${theme.fg("error", line)}`;
					else t += `\n${theme.fg("dim", line)}`;
				}
				const total = details.diff.split("\n").length;
				if (total > 40)
					t += `\n${theme.fg("muted", `… ${total - 40} more diff lines`)}`;
			}
			return new Text(t, 0, 0);
		},
	});

	// ── write ───────────────────────────────────────────────────────

	pi.registerTool({
		name: "write",
		label: "write",
		description: originals.write.description,
		parameters: originals.write.parameters,

		async execute(id, params, signal, onUpdate) {
			return originals.write.execute(id, params, signal, onUpdate);
		},

		renderCall(args, theme) {
			const on = isOn("write");
			const lines = args.content.split("\n").length;
			const size = new TextEncoder().encode(args.content).length;
			return new Text(
				`${toolLabel(theme, on, "write")} ${theme.fg("accent", d(args.path))}${dimOrMuted(theme, on, ` (${lines} lines · ${formatBytes(size)})`)}`,
				0,
				0,
			);
		},

		renderResult(result, opts, theme, context) {
			if (!isOn("write"))
				return originals.write.renderResult!(result, opts, theme, context as any);
			if (opts.isPartial) return new Text(theme.fg("dim", "Writing…"), 0, 0);
			const text = result.content[0]?.type === "text" ? result.content[0].text : "";
			if (context.isError)
				return new Text(theme.fg("error", `✗ ${text.split("\n")[0] || "Write failed"}`), 0, 0);
			return new Text(theme.fg("success", "Written"), 0, 0);
		},
	});

	// ── grep ────────────────────────────────────────────────────────

	pi.registerTool({
		name: "grep",
		label: "grep",
		description: originals.grep.description,
		parameters: originals.grep.parameters,

		async execute(id, params, signal, onUpdate) {
			return originals.grep.execute(id, params, signal, onUpdate);
		},

		renderCall(args, theme) {
			const on = isOn("grep");
			let t = `${toolLabel(theme, on, "grep")} ${theme.fg("accent", `/${args.pattern}/`)}`;
			if (args.path) t += dimOrMuted(theme, on, ` in ${d(args.path)}`);
			if (args.glob) t += dimOrMuted(theme, on, ` --glob=${args.glob}`);
			return new Text(t, 0, 0);
		},

		renderResult(result, opts, theme, context) {
			if (!isOn("grep"))
				return originals.grep.renderResult!(result, opts, theme, context as any);
			if (opts.isPartial) return new Text(theme.fg("dim", "Searching…"), 0, 0);

			const details = result.details as GrepToolDetails | undefined;
			const text = result.content[0]?.type === "text" ? result.content[0].text : "";

			if (text.startsWith("No matches"))
				return new Text(theme.fg("muted", "0 matches"), 0, 0);

			const matches = lineCount(text);
			let t = theme.fg("success", `${matches} match${matches === 1 ? "" : "es"}`);
			if (details?.matchLimitReached)
				t += theme.fg("warning", ` (limit ${details.matchLimitReached})`);
			if (details?.truncation?.truncated) t += theme.fg("warning", " [truncated]");

			if (opts.expanded && text) {
				const preview = text.split("\n").slice(0, 20);
				for (const line of preview) t += `\n${theme.fg("dim", line)}`;
				if (matches > 20)
					t += `\n${theme.fg("muted", `… ${matches - 20} more matches`)}`;
			}
			return new Text(t, 0, 0);
		},
	});

	// ── find ────────────────────────────────────────────────────────

	pi.registerTool({
		name: "find",
		label: "find",
		description: originals.find.description,
		parameters: originals.find.parameters,

		async execute(id, params, signal, onUpdate) {
			return originals.find.execute(id, params, signal, onUpdate);
		},

		renderCall(args, theme) {
			const on = isOn("find");
			let t = `${toolLabel(theme, on, "find")} ${theme.fg("accent", args.pattern)}`;
			if (args.path) t += dimOrMuted(theme, on, ` in ${d(args.path)}`);
			if (args.limit) t += dimOrMuted(theme, on, ` (limit ${args.limit})`);
			return new Text(t, 0, 0);
		},

		renderResult(result, opts, theme, context) {
			if (!isOn("find"))
				return originals.find.renderResult!(result, opts, theme, context as any);
			if (opts.isPartial) return new Text(theme.fg("dim", "Searching…"), 0, 0);

			const details = result.details as FindToolDetails | undefined;
			const text = result.content[0]?.type === "text" ? result.content[0].text : "";

			if (text.startsWith("No files"))
				return new Text(theme.fg("muted", "0 results"), 0, 0);

			const count = lineCount(text);

			let t = theme.fg("success", `${count} result${count === 1 ? "" : "s"}`);
			if (details?.resultLimitReached)
				t += theme.fg("warning", ` (limit ${details.resultLimitReached})`);
			if (details?.truncation?.truncated) t += theme.fg("warning", " [truncated]");

			if (opts.expanded && text) {
				const preview = text.split("\n").slice(0, 20);
				for (const line of preview) t += `\n${theme.fg("dim", line)}`;
				if (count > 20)
					t += `\n${theme.fg("muted", `… ${count - 20} more results`)}`;
			}
			return new Text(t, 0, 0);
		},
	});

	// ── ls ──────────────────────────────────────────────────────────

	pi.registerTool({
		name: "ls",
		label: "ls",
		description: originals.ls.description,
		parameters: originals.ls.parameters,

		async execute(id, params, signal, onUpdate) {
			return originals.ls.execute(id, params, signal, onUpdate);
		},

		renderCall(args, theme) {
			const on = isOn("ls");
			const target = args.path ? d(args.path) : ".";
			let t = `${toolLabel(theme, on, "ls")} ${theme.fg("accent", target)}`;
			if (args.limit) t += dimOrMuted(theme, on, ` (limit ${args.limit})`);
			return new Text(t, 0, 0);
		},

		renderResult(result, opts, theme, context) {
			if (!isOn("ls"))
				return originals.ls.renderResult!(result, opts, theme, context as any);
			if (opts.isPartial) return new Text(theme.fg("dim", "Listing…"), 0, 0);

			const details = result.details as LsToolDetails | undefined;
			const text = result.content[0]?.type === "text" ? result.content[0].text : "";
			const count = lineCount(text);

			let t = theme.fg("success", `${count} entr${count === 1 ? "y" : "ies"}`);
			if (details?.entryLimitReached)
				t += theme.fg("warning", ` (limit ${details.entryLimitReached})`);
			if (details?.truncation?.truncated) t += theme.fg("warning", " [truncated]");

			if (opts.expanded && text) {
				const preview = text.split("\n").slice(0, 20);
				for (const line of preview) t += `\n${theme.fg("dim", line)}`;
				if (count > 20)
					t += `\n${theme.fg("muted", `… ${count - 20} more entries`)}`;
			}
			return new Text(t, 0, 0);
		},
	});

	// ── /toolview command ───────────────────────────────────────────

	pi.registerCommand("toolview", {
		description: "Toggle compact tool output. /toolview off · /toolview bash off",
		handler: async (args, ctx) => {
			const raw = args.trim().toLowerCase();

			if (!raw) {
				// Show status
				const status = state.enabled ? "on" : "off";
				const perTool = TOOL_NAMES.map((t) => {
					const on = state.tools[t] !== false;
					return on ? t : `${t}(off)`;
				}).join(", ");
				ctx.ui.notify(`toolview: ${status} — ${perTool}`, "info");
				return;
			}

			if (raw === "on") {
				state.enabled = true;
				saveState(state);
				ctx.ui.notify("toolview: all tools compact", "info");
				return;
			}
			if (raw === "off") {
				state.enabled = false;
				saveState(state);
				ctx.ui.notify("toolview: all tools verbose (original)", "info");
				return;
			}

			const parts = raw.split(/\s+/);

			// /compact <tool> on|off
			if (parts.length === 2) {
				const tool = parts[0] as ToolName;
				const action = parts[1];
				if (!TOOL_NAMES.includes(tool)) {
					ctx.ui.notify(
						`toolview: unknown tool "${tool}". Tools: ${TOOL_NAMES.join(", ")}`,
						"error",
					);
					return;
				}
				if (action === "on") {
					delete state.tools[tool];
					saveState(state);
					ctx.ui.notify(`toolview: ${tool} → compact`, "info");
					return;
				}
				if (action === "off") {
					state.tools[tool] = false;
					saveState(state);
					ctx.ui.notify(`toolview: ${tool} → verbose (original)`, "info");
					return;
				}
			}

			// /toolview <tool> — toggle single tool
			if (parts.length === 1) {
				const tool = parts[0] as ToolName;
				if (!TOOL_NAMES.includes(tool)) {
					ctx.ui.notify(
						`toolview: unknown tool "${tool}". Tools: ${TOOL_NAMES.join(", ")}`,
						"error",
					);
					return;
				}
				const currentlyOn = state.tools[tool] !== false;
				if (currentlyOn) {
					state.tools[tool] = false;
				} else {
					delete state.tools[tool];
				}
				saveState(state);
				ctx.ui.notify(
					`toolview: ${tool} → ${currentlyOn ? "verbose" : "compact"}`,
					"info",
				);
				return;
			}

			ctx.ui.notify(
				"Usage: /toolview [on|off] · /toolview <tool> [on|off] · /toolview (status)",
				"info",
			);
		},
	});
}
