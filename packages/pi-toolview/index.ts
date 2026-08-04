/**
 * pi-toolview — compact tool output display
 *
 * Replaces pi's verbose built-in tool rendering with one-line summaries,
 * expandable on demand (ctrl+o). Execution is fully delegated to the
 * originals, so the LLM still sees the complete output.
 *
 * Uses renderShell: "self" to drop the default Box padding for a tighter look,
 * re-applying the success/error/pending background color manually. (pi hardcodes
 * one blank line above every tool block, so a single separator remains.)
 * Note: with the self shell, turning a tool off renders the original content in
 * the tight frame rather than the native pill. Toggling re-renders existing
 * blocks via ctx.ui.setToolsExpanded so no /reload is needed.
 *
 * Features:
 *   - Smart paths: relative to cwd inside project, ~/ under HOME, absolute otherwise
 *   - Bash timing: measured via render state (same as built-in), not parsed from text
 *   - Write file size: byte count for sanity checks
 *   - Error emphasis: prominent ✗ prefix in red, based on the isError flag
 *   - Edit context hint: shows the enclosing function/class from the diff
 *   - /toolview command: toggle on/off globally or per-tool, persisted
 *
 * Install:
 *   pi install /path/to/pi-extensions/packages/pi-toolview
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
 * Strip metadata pi appends to bash output: truncation notices and exit/abort
 * status lines. Timing is NOT in the text; it comes from render state.
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

	// renderShell: "self" drops the default Box, so we re-apply the pill
	// background ourselves. One colored row, tight vertical padding.
	const row = (text: string, theme: any, context: any, partial: boolean): Text => {
		const bg = partial
			? (s: string) => theme.bg("toolPendingBg", s)
			: context.isError
				? (s: string) => theme.bg("toolErrorBg", s)
				: (s: string) => theme.bg("toolSuccessBg", s);
		return new Text(text, 1, 0, bg);
	};

	// ── bash ────────────────────────────────────────────────────────

	// Timing lives in shared render state, same mechanism the built-in uses.
	type BashRenderState = { startedAt?: number; endedAt?: number };

	pi.registerTool({
		name: "bash",
		label: "bash",
		description: originals.bash.description,
		parameters: originals.bash.parameters,
		renderShell: "self",

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
			let t = `${theme.fg("toolTitle", theme.bold("$"))} ${theme.fg("accent", cmd)}`;
			if (args.timeout) t += theme.fg("dim", ` (${args.timeout}s)`);
			return row(t, theme, context, context.isPartial);
		},

		renderResult(result, opts, theme, context) {
			if (!isOn("bash"))
				return originals.bash.renderResult!(result, opts, theme, context as any);
			if (opts.isPartial) return row(theme.fg("dim", "Running…"), theme, context, true);

			const bstate = context.state as BashRenderState;
			if (bstate.startedAt !== undefined) bstate.endedAt ??= Date.now();
			const durationMs =
				bstate.startedAt !== undefined
					? (bstate.endedAt ?? Date.now()) - bstate.startedAt
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
			return row(t, theme, context, false);
		},
	});

	// ── read ────────────────────────────────────────────────────────

	pi.registerTool({
		name: "read",
		label: "read",
		description: originals.read.description,
		parameters: originals.read.parameters,
		renderShell: "self",

		async execute(id, params, signal, onUpdate) {
			return originals.read.execute(id, params, signal, onUpdate);
		},

		renderCall(args, theme, context) {
			if (!isOn("read"))
				return originals.read.renderCall!(args, theme, context as any);
			let t = `${toolLabel(theme, true, "read")} ${theme.fg("accent", d(args.path))}`;
			if (args.offset !== undefined || args.limit !== undefined) {
				const bits: string[] = [];
				if (args.offset) bits.push(`offset=${args.offset}`);
				if (args.limit) bits.push(`limit=${args.limit}`);
				t += theme.fg("dim", ` (${bits.join(", ")})`);
			}
			return row(t, theme, context, context.isPartial);
		},

		renderResult(result, opts, theme, context) {
			if (!isOn("read"))
				return originals.read.renderResult!(result, opts, theme, context as any);
			if (opts.isPartial) return row(theme.fg("dim", "Reading…"), theme, context, true);

			const details = result.details as ReadToolDetails | undefined;
			const content = result.content[0];

			if (context.isError) {
				const firstLine =
					content?.type === "text" ? content.text.split("\n")[0] : "Read failed";
				return row(theme.fg("error", `✗ ${firstLine}`), theme, context, false);
			}

			if (content?.type === "image")
				return row(theme.fg("success", "Image loaded"), theme, context, false);

			if (content?.type !== "text")
				return row(theme.fg("error", "✗ No content"), theme, context, false);

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
			return row(t, theme, context, false);
		},
	});

	// ── edit ────────────────────────────────────────────────────────

	pi.registerTool({
		name: "edit",
		label: "edit",
		description: originals.edit.description,
		parameters: originals.edit.parameters,
		renderShell: "self",

		async execute(id, params, signal, onUpdate) {
			return originals.edit.execute(id, params, signal, onUpdate);
		},

		renderCall(args, theme, context) {
			if (!isOn("edit"))
				return originals.edit.renderCall!(args, theme, context as any);
			const n = args.edits?.length ?? 1;
			const t = `${toolLabel(theme, true, "edit")} ${theme.fg("accent", d(args.path))}${theme.fg("dim", ` (${n} change${n === 1 ? "" : "s"})`)}`;
			return row(t, theme, context, context.isPartial);
		},

		renderResult(result, opts, theme, context) {
			if (!isOn("edit"))
				return originals.edit.renderResult!(result, opts, theme, context as any);
			if (opts.isPartial) return row(theme.fg("dim", "Editing…"), theme, context, true);

			const details = result.details as EditToolDetails | undefined;
			const text = result.content[0]?.type === "text" ? result.content[0].text : "";
			if (context.isError)
				return row(theme.fg("error", `✗ ${text.split("\n")[0] || "Edit failed"}`), theme, context, false);

			if (!details?.diff)
				return row(theme.fg("success", "Applied"), theme, context, false);

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
			return row(t, theme, context, false);
		},
	});

	// ── write ───────────────────────────────────────────────────────

	pi.registerTool({
		name: "write",
		label: "write",
		description: originals.write.description,
		parameters: originals.write.parameters,
		renderShell: "self",

		async execute(id, params, signal, onUpdate) {
			return originals.write.execute(id, params, signal, onUpdate);
		},

		renderCall(args, theme, context) {
			if (!isOn("write"))
				return originals.write.renderCall!(args, theme, context as any);
			const lines = args.content.split("\n").length;
			const size = new TextEncoder().encode(args.content).length;
			const t = `${toolLabel(theme, true, "write")} ${theme.fg("accent", d(args.path))}${theme.fg("dim", ` (${lines} lines · ${formatBytes(size)})`)}`;
			return row(t, theme, context, context.isPartial);
		},

		renderResult(result, opts, theme, context) {
			if (!isOn("write"))
				return originals.write.renderResult!(result, opts, theme, context as any);
			if (opts.isPartial) return row(theme.fg("dim", "Writing…"), theme, context, true);
			const text = result.content[0]?.type === "text" ? result.content[0].text : "";
			if (context.isError)
				return row(theme.fg("error", `✗ ${text.split("\n")[0] || "Write failed"}`), theme, context, false);
			return row(theme.fg("success", "Written"), theme, context, false);
		},
	});

	// ── grep ────────────────────────────────────────────────────────

	pi.registerTool({
		name: "grep",
		label: "grep",
		description: originals.grep.description,
		parameters: originals.grep.parameters,
		renderShell: "self",

		async execute(id, params, signal, onUpdate) {
			return originals.grep.execute(id, params, signal, onUpdate);
		},

		renderCall(args, theme, context) {
			if (!isOn("grep"))
				return originals.grep.renderCall!(args, theme, context as any);
			let t = `${toolLabel(theme, true, "grep")} ${theme.fg("accent", `/${args.pattern}/`)}`;
			if (args.path) t += theme.fg("dim", ` in ${d(args.path)}`);
			if (args.glob) t += theme.fg("dim", ` --glob=${args.glob}`);
			return row(t, theme, context, context.isPartial);
		},

		renderResult(result, opts, theme, context) {
			if (!isOn("grep"))
				return originals.grep.renderResult!(result, opts, theme, context as any);
			if (opts.isPartial) return row(theme.fg("dim", "Searching…"), theme, context, true);

			const details = result.details as GrepToolDetails | undefined;
			const text = result.content[0]?.type === "text" ? result.content[0].text : "";

			if (text.startsWith("No matches"))
				return row(theme.fg("muted", "0 matches"), theme, context, false);

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
			return row(t, theme, context, false);
		},
	});

	// ── find ────────────────────────────────────────────────────────

	pi.registerTool({
		name: "find",
		label: "find",
		description: originals.find.description,
		parameters: originals.find.parameters,
		renderShell: "self",

		async execute(id, params, signal, onUpdate) {
			return originals.find.execute(id, params, signal, onUpdate);
		},

		renderCall(args, theme, context) {
			if (!isOn("find"))
				return originals.find.renderCall!(args, theme, context as any);
			let t = `${toolLabel(theme, true, "find")} ${theme.fg("accent", args.pattern)}`;
			if (args.path) t += theme.fg("dim", ` in ${d(args.path)}`);
			if (args.limit) t += theme.fg("dim", ` (limit ${args.limit})`);
			return row(t, theme, context, context.isPartial);
		},

		renderResult(result, opts, theme, context) {
			if (!isOn("find"))
				return originals.find.renderResult!(result, opts, theme, context as any);
			if (opts.isPartial) return row(theme.fg("dim", "Searching…"), theme, context, true);

			const details = result.details as FindToolDetails | undefined;
			const text = result.content[0]?.type === "text" ? result.content[0].text : "";

			if (text.startsWith("No files"))
				return row(theme.fg("muted", "0 results"), theme, context, false);

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
			return row(t, theme, context, false);
		},
	});

	// ── ls ──────────────────────────────────────────────────────────

	pi.registerTool({
		name: "ls",
		label: "ls",
		description: originals.ls.description,
		parameters: originals.ls.parameters,
		renderShell: "self",

		async execute(id, params, signal, onUpdate) {
			return originals.ls.execute(id, params, signal, onUpdate);
		},

		renderCall(args, theme, context) {
			if (!isOn("ls"))
				return originals.ls.renderCall!(args, theme, context as any);
			const target = args.path ? d(args.path) : ".";
			let t = `${toolLabel(theme, true, "ls")} ${theme.fg("accent", target)}`;
			if (args.limit) t += theme.fg("dim", ` (limit ${args.limit})`);
			return row(t, theme, context, context.isPartial);
		},

		renderResult(result, opts, theme, context) {
			if (!isOn("ls"))
				return originals.ls.renderResult!(result, opts, theme, context as any);
			if (opts.isPartial) return row(theme.fg("dim", "Listing…"), theme, context, true);

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
			return row(t, theme, context, false);
		},
	});

	// ── /toolview command ───────────────────────────────────────────

	pi.registerCommand("toolview", {
		description: "Toggle compact tool output. /toolview off · /toolview bash off",
		handler: async (args, ctx) => {
			// Re-render already-drawn tool blocks so a toggle applies immediately,
			// no /reload needed. setToolsExpanded re-runs renderCall/renderResult
			// on every block; passing the current value changes nothing visually.
			const refresh = () => {
				try {
					ctx.ui.setToolsExpanded(ctx.ui.getToolsExpanded());
				} catch {
					// non-fatal: toggle still applies to newly-rendered tools
				}
			};
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
				refresh();
				ctx.ui.notify("toolview: all tools compact", "info");
				return;
			}
			if (raw === "off") {
				state.enabled = false;
				saveState(state);
				refresh();
				ctx.ui.notify("toolview: all tools verbose (original)", "info");
				return;
			}

			const parts = raw.split(/\s+/);

			// /toolview <tool> on|off
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
					refresh();
					ctx.ui.notify(`toolview: ${tool} → compact`, "info");
					return;
				}
				if (action === "off") {
					state.tools[tool] = false;
					saveState(state);
					refresh();
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
				refresh();
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
