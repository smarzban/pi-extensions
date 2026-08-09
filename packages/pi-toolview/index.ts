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
 *
 * Off behaviour: the native per-tool renderers are built for the Box shell and
 * lose their background when drawn in the tight self frame, so when a tool is
 * toggled off we draw its full result content through the same pill row instead
 * of delegating to the native renderer. Toggling re-renders existing blocks via
 * ctx.ui.setToolsExpanded so no /reload is needed.
 *
 * Features:
 *   - Smart paths: relative to cwd inside project, ~/ under HOME, absolute otherwise
 *   - Bash timing: measured via render state (same as built-in), not parsed from text
 *   - Write file size: byte count for sanity checks
 *   - Error emphasis: prominent ✗ prefix in red, based on the isError flag
 *   - Edit context hint: shows the enclosing function/class from the diff
 *   - /toolview command: toggle on/off globally or per-tool, persisted
 *
 * Commands:
 *   /toolview              Show status
 *   /toolview compact      All tools compact (summaries)
 *   /toolview full         All tools full output
 *   /toolview <tool> [compact|full]   One tool
 *   (on/off accepted as aliases for compact/full)
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
	if (!rel.startsWith("..") && !rel.startsWith(sep + "..")) return rel || ".";
	// Match HOME on a path boundary: a bare prefix test turns /home/user2/x into ~2/x.
	if (home && (p === home || p.startsWith(home + sep)))
		return `~${p.slice(home.length)}`;
	return p;
}

// ── formatting helpers ──────────────────────────────────────────────

function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) {
		const kb = n / 1024;
		return kb < 10 ? `${kb.toFixed(1)} KB` : `${Math.round(kb)} KB`;
	}
	const mb = n / (1024 * 1024);
	return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`;
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${Math.round(ms)}ms`;
	const s = ms / 1000;
	if (s < 60) return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
	const m = Math.round(s / 60);
	if (m < 60) return `${m}m`;
	const h = Math.floor(m / 60);
	const rem = m % 60;
	return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

/** Strip metadata pi appends to bash output (truncation notices, exit status). */
function stripBashMeta(output: string): string {
	return output
		.replace(/\n\n\[Showing lines [^\]]*\]\s*$/g, "")
		.replace(/\n\n\[Showing last [^\]]*\]\s*$/g, "")
		.replace(/\n\nCommand (exited with code \d+|aborted|timed out after [^\n]*)\s*$/g, "")
		.trimEnd();
}

function clip(text: string, maxLen: number): string {
	const flat = text.replace(/\n/g, " ").trim();
	return flat.length <= maxLen ? flat : `${flat.slice(0, maxLen - 1)}…`;
}

/** Truncate long commands keeping head + tail. */
function clipCommand(text: string, maxLen: number): string {
	const flat = text.replace(/\n/g, " ").trim();
	if (flat.length <= maxLen) return flat;
	const head = Math.floor(maxLen * 0.3);
	const tail = maxLen - head - 1;
	return `${flat.slice(0, head)}…${flat.slice(flat.length - tail)}`;
}

function diffStats(diff: string): { add: number; rem: number } {
	let add = 0;
	let rem = 0;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+") && !line.startsWith("+++")) add++;
		else if (line.startsWith("-") && !line.startsWith("---")) rem++;
	}
	return { add, rem };
}

function lineCount(text: string): number {
	return text.split("\n").filter((l) => l.trim()).length;
}

/** Color a unified diff: +green, -red, context dim. */
function colorDiff(diff: string, theme: any, maxLines?: number): string {
	const lines = diff.split("\n");
	const shown = maxLines !== undefined ? lines.slice(0, maxLines) : lines;
	const colored = shown.map((line) => {
		if (line.startsWith("+") && !line.startsWith("+++")) return theme.fg("success", line);
		if (line.startsWith("-") && !line.startsWith("---")) return theme.fg("error", line);
		return theme.fg("dim", line);
	});
	let out = colored.join("\n");
	if (maxLines !== undefined && lines.length > maxLines) {
		out += `\n${theme.fg("muted", `… ${lines.length - maxLines} more diff lines`)}`;
	}
	return out;
}

function extractFuncHint(diff: string, patch?: string): string | null {
	if (patch) {
		const hunk = patch.match(/@@.*?@@\s+(.+)$/m);
		if (hunk) {
			const fn = parseFuncName(hunk[1]!.trim());
			if (fn) return fn;
		}
	}
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
		const raw = line.slice(1);
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
		if (m?.[1] && !["if", "for", "while", "switch", "catch", "return"].includes(m[1])) {
			return m[1];
		}
	}
	return null;
}

// ── persisted state ─────────────────────────────────────────────────

type ToolName = "bash" | "read" | "edit" | "write" | "grep" | "find" | "ls";
const TOOL_NAMES: ToolName[] = ["bash", "read", "edit", "write", "grep", "find", "ls"];

interface CompactState {
	/** Global default when a tool has no override of its own. */
	enabled: boolean;
	/**
	 * Per-tool override of the global default. `true` forces compact, `false`
	 * forces full, absent follows `enabled`. Both directions must be
	 * representable, otherwise a per-tool command cannot escape the global mode.
	 */
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

	// Original tool instances for execution / metadata.
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
	// A per-tool override wins over the global default in both directions.
	const isOn = (t: ToolName): boolean => state.tools[t] ?? state.enabled;

	const d = (p: string, toolCwd: string) => displayPath(p, toolCwd);

	const toolLabel = (theme: any, label: string) =>
		theme.fg("toolTitle", theme.bold(label));

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

	// Extract the text payload from a tool result.
	const textOf = (result: any): string =>
		result.content?.[0]?.type === "text" ? result.content[0].text : "";

	// ── bash ────────────────────────────────────────────────────────

	type BashRenderState = { startedAt?: number; endedAt?: number };

	pi.registerTool({
		name: "bash",
		label: "bash",
		description: originals.bash.description,
		parameters: originals.bash.parameters,
		renderShell: "self",

		async execute(id, params, signal, onUpdate, ctx) {
			return createBashTool(ctx.cwd).execute(id, params, signal, onUpdate);
		},

		renderCall(args, theme, context) {
			const st = context.state as BashRenderState;
			if (context.executionStarted && st.startedAt === undefined) {
				st.startedAt = Date.now();
				st.endedAt = undefined;
			}
			const cmd = clipCommand(args.command, 76);
			let t = `${toolLabel(theme, "$")} ${theme.fg("accent", cmd)}`;
			if (args.timeout) t += theme.fg("dim", ` (${args.timeout}s)`);
			return row(t, theme, context, context.isPartial);
		},

		renderResult(result, opts, theme, context) {
			if (opts.isPartial) return row(theme.fg("dim", "Running…"), theme, context, true);

			const st = context.state as BashRenderState;
			if (st.startedAt !== undefined) st.endedAt ??= Date.now();
			const durationMs =
				st.startedAt !== undefined ? (st.endedAt ?? Date.now()) - st.startedAt : undefined;

			const raw = textOf(result);

			// OFF: full original output in the pill.
			if (!isOn("bash")) {
				return row(raw.trimEnd() || theme.fg("muted", "(no output)"), theme, context, false);
			}

			// ON: compact summary.
			const details = result.details as BashToolDetails | undefined;
			const clean = stripBashMeta(raw);
			const lines = lineCount(clean);

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
				if (total > 30) t += `\n${theme.fg("muted", `… ${total - 30} more lines`)}`;
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

		async execute(id, params, signal, onUpdate, ctx) {
			return createReadTool(ctx.cwd).execute(id, params, signal, onUpdate);
		},

		renderCall(args, theme, context) {
			let t = `${toolLabel(theme, "read")} ${theme.fg("accent", d(args.path, context.cwd))}`;
			if (args.offset !== undefined || args.limit !== undefined) {
				const bits: string[] = [];
				if (args.offset) bits.push(`offset=${args.offset}`);
				if (args.limit) bits.push(`limit=${args.limit}`);
				t += theme.fg("dim", ` (${bits.join(", ")})`);
			}
			return row(t, theme, context, context.isPartial);
		},

		renderResult(result, opts, theme, context) {
			if (opts.isPartial) return row(theme.fg("dim", "Reading…"), theme, context, true);

			const content = result.content[0];
			if (content?.type === "image")
				return row(theme.fg("success", "Image loaded"), theme, context, false);
			if (context.isError) {
				const full = content?.type === "text" ? content.text.trimEnd() : "Read failed";
				// Full mode must show the whole diagnostic: a failure is when the user
				// most wants it, so the error branch cannot pre-empt it.
				const body = isOn("read") ? full.split("\n")[0] : full;
				return row(theme.fg("error", `✗ ${body}`), theme, context, false);
			}
			if (content?.type !== "text")
				return row(theme.fg("error", "✗ No content"), theme, context, false);

			// OFF: full file content in the pill.
			if (!isOn("read")) {
				return row(content.text.trimEnd() || theme.fg("muted", "(empty)"), theme, context, false);
			}

			// ON: compact summary.
			const details = result.details as ReadToolDetails | undefined;
			const lines = lineCount(content.text);
			let t = theme.fg("success", `${lines} line${lines === 1 ? "" : "s"}`);
			if (details?.truncation?.truncated)
				t += theme.fg("warning", ` (truncated from ${details.truncation.totalLines})`);

			if (opts.expanded) {
				const preview = content.text.split("\n").slice(0, 20);
				for (const line of preview) t += `\n${theme.fg("dim", line)}`;
				if (lines > 20) t += `\n${theme.fg("muted", `… ${lines - 20} more lines`)}`;
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

		async execute(id, params, signal, onUpdate, ctx) {
			return createEditTool(ctx.cwd).execute(id, params, signal, onUpdate);
		},

		renderCall(args, theme, context) {
			const n = args.edits?.length ?? 1;
			const t = `${toolLabel(theme, "edit")} ${theme.fg("accent", d(args.path, context.cwd))}${theme.fg("dim", ` (${n} change${n === 1 ? "" : "s"})`)}`;
			return row(t, theme, context, context.isPartial);
		},

		renderResult(result, opts, theme, context) {
			if (opts.isPartial) return row(theme.fg("dim", "Editing…"), theme, context, true);

			const details = result.details as EditToolDetails | undefined;
			const text = textOf(result);
			if (context.isError) {
				const body = isOn("edit") ? text.split("\n")[0] : text.trimEnd();
				return row(theme.fg("error", `✗ ${body || "Edit failed"}`), theme, context, false);
			}

			// OFF: full colored diff in the pill.
			if (!isOn("edit")) {
				if (details?.diff) return row(colorDiff(details.diff, theme), theme, context, false);
				return row(text || theme.fg("success", "Applied"), theme, context, false);
			}

			// ON: compact +N/-N summary.
			if (!details?.diff) return row(theme.fg("success", "Applied"), theme, context, false);

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
				t += `\n${colorDiff(details.diff, theme, 40)}`;
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

		async execute(id, params, signal, onUpdate, ctx) {
			return createWriteTool(ctx.cwd).execute(id, params, signal, onUpdate);
		},

		renderCall(args, theme, context) {
			const lines = args.content.split("\n").length;
			const size = new TextEncoder().encode(args.content).length;
			const t = `${toolLabel(theme, "write")} ${theme.fg("accent", d(args.path, context.cwd))}${theme.fg("dim", ` (${lines} lines · ${formatBytes(size)})`)}`;
			return row(t, theme, context, context.isPartial);
		},

		renderResult(result, opts, theme, context) {
			if (opts.isPartial) return row(theme.fg("dim", "Writing…"), theme, context, true);
			const text = textOf(result);
			if (context.isError) {
				const body = isOn("write") ? text.split("\n")[0] : text.trimEnd();
				return row(theme.fg("error", `✗ ${body || "Write failed"}`), theme, context, false);
			}

			// OFF: full result message in the pill.
			if (!isOn("write")) {
				return row(text || theme.fg("success", "Written"), theme, context, false);
			}

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

		async execute(id, params, signal, onUpdate, ctx) {
			return createGrepTool(ctx.cwd).execute(id, params, signal, onUpdate);
		},

		renderCall(args, theme, context) {
			let t = `${toolLabel(theme, "grep")} ${theme.fg("accent", `/${args.pattern}/`)}`;
			if (args.path) t += theme.fg("dim", ` in ${d(args.path, context.cwd)}`);
			if (args.glob) t += theme.fg("dim", ` --glob=${args.glob}`);
			return row(t, theme, context, context.isPartial);
		},

		renderResult(result, opts, theme, context) {
			if (opts.isPartial) return row(theme.fg("dim", "Searching…"), theme, context, true);

			const text = textOf(result);

			if (context.isError) {
				const body = isOn("grep") ? text.split("\n")[0] : text.trimEnd();
				return row(theme.fg("error", `✗ ${body || "grep failed"}`), theme, context, false);
			}

			// OFF: full match list in the pill.
			if (!isOn("grep")) {
				return row(text.trimEnd() || theme.fg("muted", "0 matches"), theme, context, false);
			}

			// ON: compact match count.
			if (text.startsWith("No matches"))
				return row(theme.fg("muted", "0 matches"), theme, context, false);

			const details = result.details as GrepToolDetails | undefined;
			const matches = lineCount(text);
			let t = theme.fg("success", `${matches} match${matches === 1 ? "" : "es"}`);
			if (details?.matchLimitReached)
				t += theme.fg("warning", ` (limit ${details.matchLimitReached})`);
			if (details?.truncation?.truncated) t += theme.fg("warning", " [truncated]");

			if (opts.expanded && text) {
				const preview = text.split("\n").slice(0, 20);
				for (const line of preview) t += `\n${theme.fg("dim", line)}`;
				if (matches > 20) t += `\n${theme.fg("muted", `… ${matches - 20} more matches`)}`;
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

		async execute(id, params, signal, onUpdate, ctx) {
			return createFindTool(ctx.cwd).execute(id, params, signal, onUpdate);
		},

		renderCall(args, theme, context) {
			let t = `${toolLabel(theme, "find")} ${theme.fg("accent", args.pattern)}`;
			if (args.path) t += theme.fg("dim", ` in ${d(args.path, context.cwd)}`);
			if (args.limit) t += theme.fg("dim", ` (limit ${args.limit})`);
			return row(t, theme, context, context.isPartial);
		},

		renderResult(result, opts, theme, context) {
			if (opts.isPartial) return row(theme.fg("dim", "Searching…"), theme, context, true);

			const text = textOf(result);

			if (context.isError) {
				const body = isOn("find") ? text.split("\n")[0] : text.trimEnd();
				return row(theme.fg("error", `✗ ${body || "find failed"}`), theme, context, false);
			}

			// OFF: full path list in the pill.
			if (!isOn("find")) {
				return row(text.trimEnd() || theme.fg("muted", "0 results"), theme, context, false);
			}

			// ON: compact result count.
			if (text.startsWith("No files"))
				return row(theme.fg("muted", "0 results"), theme, context, false);

			const details = result.details as FindToolDetails | undefined;
			const count = lineCount(text);
			let t = theme.fg("success", `${count} result${count === 1 ? "" : "s"}`);
			if (details?.resultLimitReached)
				t += theme.fg("warning", ` (limit ${details.resultLimitReached})`);
			if (details?.truncation?.truncated) t += theme.fg("warning", " [truncated]");

			if (opts.expanded && text) {
				const preview = text.split("\n").slice(0, 20);
				for (const line of preview) t += `\n${theme.fg("dim", line)}`;
				if (count > 20) t += `\n${theme.fg("muted", `… ${count - 20} more results`)}`;
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

		async execute(id, params, signal, onUpdate, ctx) {
			return createLsTool(ctx.cwd).execute(id, params, signal, onUpdate);
		},

		renderCall(args, theme, context) {
			const target = args.path ? d(args.path, context.cwd) : ".";
			let t = `${toolLabel(theme, "ls")} ${theme.fg("accent", target)}`;
			if (args.limit) t += theme.fg("dim", ` (limit ${args.limit})`);
			return row(t, theme, context, context.isPartial);
		},

		renderResult(result, opts, theme, context) {
			if (opts.isPartial) return row(theme.fg("dim", "Listing…"), theme, context, true);

			const text = textOf(result);

			if (context.isError) {
				const body = isOn("ls") ? text.split("\n")[0] : text.trimEnd();
				return row(theme.fg("error", `✗ ${body || "ls failed"}`), theme, context, false);
			}

			// OFF: full entry list in the pill.
			if (!isOn("ls")) {
				return row(text.trimEnd() || theme.fg("muted", "(empty)"), theme, context, false);
			}

			// ON: compact entry count.
			const details = result.details as LsToolDetails | undefined;
			const count = lineCount(text);
			let t = theme.fg("success", `${count} entr${count === 1 ? "y" : "ies"}`);
			if (details?.entryLimitReached)
				t += theme.fg("warning", ` (limit ${details.entryLimitReached})`);
			if (details?.truncation?.truncated) t += theme.fg("warning", " [truncated]");

			if (opts.expanded && text) {
				const preview = text.split("\n").slice(0, 20);
				for (const line of preview) t += `\n${theme.fg("dim", line)}`;
				if (count > 20) t += `\n${theme.fg("muted", `… ${count - 20} more entries`)}`;
			}
			return row(t, theme, context, false);
		},
	});

	// ── /toolview command ───────────────────────────────────────────

	pi.registerCommand("toolview", {
		description:
			"Compact vs full tool output. /toolview compact · /toolview bash full",
		handler: async (args, ctx) => {
			// Re-render already-drawn tool blocks so a toggle applies immediately.
			// pi's setToolsExpanded returns early when the value is unchanged
			// (interactive-mode.js: `if (expanded === this.toolOutputExpanded) return`),
			// so setting it to its current value re-renders nothing. Flip it and flip
			// it straight back: each call rebuilds every tool block through its
			// renderer, and the pair leaves the expansion state where it started.
			const refresh = () => {
				try {
					const current = ctx.ui.getToolsExpanded();
					ctx.ui.setToolsExpanded(!current);
					ctx.ui.setToolsExpanded(current);
				} catch {
					// non-fatal: the change still applies to newly-rendered tools
				}
			};
			// Accept "compact"/"full" as primary, "on"/"off" as legacy aliases.
			const norm = (a: string) => (a === "on" ? "compact" : a === "off" ? "full" : a);
			const raw = args.trim().toLowerCase();

			if (!raw) {
				const status = state.enabled ? "compact" : "full";
				// Derive from isOn so the listing always matches what is rendered.
				const perTool = TOOL_NAMES.map((t) =>
					isOn(t) ? `${t}(compact)` : `${t}(full)`,
				).join(", ");
				ctx.ui.notify(`toolview: ${status} — ${perTool}`, "info");
				return;
			}

			if (norm(raw) === "compact") {
				state.enabled = true;
				state.tools = {};
				saveState(state);
				refresh();
				ctx.ui.notify("toolview: all tools compact", "info");
				return;
			}
			if (norm(raw) === "full") {
				state.enabled = false;
				state.tools = {};
				saveState(state);
				refresh();
				ctx.ui.notify("toolview: all tools full output", "info");
				return;
			}

			const parts = raw.split(/\s+/);

			if (parts.length === 2) {
				const tool = parts[0] as ToolName;
				const action = norm(parts[1]);
				if (!TOOL_NAMES.includes(tool)) {
					ctx.ui.notify(
						`toolview: unknown tool "${tool}". Tools: ${TOOL_NAMES.join(", ")}`,
						"error",
					);
					return;
				}
				if (action === "compact" || action === "full") {
					const want = action === "compact";
					// Record the override only when it differs from the global default,
					// so the state file stays a set of genuine exceptions.
					if (want === state.enabled) {
						delete state.tools[tool];
					} else {
						state.tools[tool] = want;
					}
					saveState(state);
					refresh();
					ctx.ui.notify(`toolview: ${tool} → ${action}`, "info");
					return;
				}
			}

			if (parts.length === 1) {
				const tool = parts[0] as ToolName;
				if (!TOOL_NAMES.includes(tool)) {
					ctx.ui.notify(
						`toolview: unknown tool "${tool}". Tools: ${TOOL_NAMES.join(", ")}`,
					"error",
					);
					return;
				}
				const want = !isOn(tool);
				if (want === state.enabled) {
					delete state.tools[tool];
				} else {
					state.tools[tool] = want;
				}
				saveState(state);
				refresh();
				ctx.ui.notify(
					`toolview: ${tool} → ${want ? "compact" : "full"}`,
					"info",
				);
				return;
			}

			ctx.ui.notify(
				"Usage: /toolview [compact|full] · /toolview <tool> [compact|full] · /toolview (status)",
				"info",
			);
		},
	});
}
