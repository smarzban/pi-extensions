/**
 * pi-editor: rounded editor box + draft stash
 *
 *   ╭─────────────────────────╮
 *   │ › text box              │
 *   ╰─────────────────────────╯
 *
 * Two editor-surface features in one package (pi exposes the input editor as
 * one extension surface: the editor component itself plus getEditorText /
 * setEditorText / shortcuts):
 *
 *   1. Rounded editor box — drawn border around the input editor.
 *   2. Draft stash — alt+s saves the current draft (per project) and clears
 *      the editor; alt+s with an empty editor restores it (one-shot).
 *
 * Commands:
 *   /editor [on|off|status]   Toggle the rounded box
 *   /stash [clear]            Stash status / clear
 *
 * Install:
 *   pi install npm:@pi-extensions/pi-editor
 */

import {
	CustomEditor,
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
	type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

// ── persisted settings ───────────────────────────────────────────────

interface PersistedState {
	/** Rounded editor box enabled (default true). */
	enabled?: boolean;
	/** Session name label on the box (default true). */
	sessionName?: boolean;
	/** Label position on the box border: "top" or "bottom" (default "bottom"). */
	sessionNamePosition?: "top" | "bottom";
}

function statePath(): string {
	return join(getAgentDir(), "editor.json");
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
		// Non-fatal: editor still works without persistence.
	}
}

// ── draft stash ──────────────────────────────────────────────────────

interface StashEntry {
	text: string;
	savedAt: string;
}

type StashFile = { stashes: Record<string, StashEntry> };

function stashPath(): string {
	return join(getAgentDir(), "stash.json");
}

function loadStashes(): StashFile {
	const path = stashPath();
	if (!existsSync(path)) return { stashes: {} };
	try {
		const raw = JSON.parse(readFileSync(path, "utf-8"));
		return { stashes: raw.stashes ?? {} };
	} catch {
		// Unreadable or truncated: keep the bytes instead of letting the next save
		// overwrite every project's draft with an empty map.
		try {
			renameSync(path, `${path}.corrupt-${Date.now()}`);
		} catch {
			// If it cannot be set aside, saveStashes will fail loudly rather than clobber it.
		}
		return { stashes: {} };
	}
}

/** Persist the stash file atomically. Returns false when nothing was written. */
function saveStashes(file: StashFile): boolean {
	const path = stashPath();
	const temp = `${path}.tmp-${process.pid}`;
	try {
		mkdirSync(dirname(path), { recursive: true });
		// Write beside the target, then rename over it: a crash mid-write leaves the
		// previous file intact instead of a truncated one.
		writeFileSync(temp, `${JSON.stringify(file, null, "\t")}\n`, "utf-8");
		renameSync(temp, path);
		return true;
	} catch {
		try {
			if (existsSync(temp)) unlinkSync(temp);
		} catch {
			// best-effort temp cleanup
		}
		return false;
	}
}

// ── editor border helpers ────────────────────────────────────────────

function stripAnsi(text: string): string {
	return text.replace(/[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, "");
}

function isHorizontalBorder(text: string): boolean {
	const plain = stripAnsi(text);
	return plain.length > 0 && plain.replace(/─/g, "") === "";
}

/** Build a rounded border with an optional right-aligned label. */
function roundedEditorBorder(
	width: number,
	left: string,
	right: string,
	border: (text: string) => string,
	label = "",
): string {
	const innerWidth = Math.max(0, width - 2);
	if (!label) return border(left) + border("─".repeat(innerWidth)) + border(right);

	let labelText = ` ${label} `;
	const tailWidth = Math.min(2, Math.max(0, innerWidth - visibleWidth(labelText)));
	labelText = truncateToWidth(labelText, Math.max(0, innerWidth - tailWidth), "");
	const leftWidth = Math.max(0, innerWidth - visibleWidth(labelText) - tailWidth);
	return (
		border(left) +
		border("─".repeat(leftWidth)) +
		labelText +
		border("─".repeat(tailWidth)) +
		border(right)
	);
}


// ── extension ────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	const saved = loadState();
	let enabled = saved.enabled !== false;
	let nameEnabled = saved.sessionName !== false;
	let namePosition: "top" | "bottom" =
		saved.sessionNamePosition === "top" ? "top" : "bottom";
	let sessionName: string | undefined;
	let tuiRef: { requestRender: () => void } | null = null;

	/** Render the editor as a rounded rectangle with a visible prompt. */
	const applyEditor = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		if (!enabled) {
			ctx.ui.setEditorComponent(undefined);
			return;
		}

		class EditorBox extends CustomEditor {
			constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
				super(tui, theme, keybindings, { paddingX: 0 });
				tuiRef = tui;
			}

			render(width: number): string[] {
				if (width < 6) return super.render(width);

				// Render four columns narrower: two for the outer │ borders and two for
				// the "› " hanging prompt. Nothing is truncated afterwards, so a full
				// first line keeps its last character and the cursor cell / IME marker
				// always survive.
				const innerWidth = width - 2;
				const lines = super.render(innerWidth - 2);
				if (lines.length < 2) return lines;

				const borderColor = (text: string) => this.borderColor(text);
				const prompt = `${ctx.ui.theme.fg("accent", "›")} `;

				// Border-like lines (visible text ends with ─: the horizontal borders
				// and any "↑/↓ N more" scroll indicator) are extended with ─ so the
				// indicator stays intact inside the shell; text lines get the hanging
				// prompt/indent and are space-padded.
				const wrap = (line: string, left: string, right: string, prefix: string) => {
					const borderLike = stripAnsi(line).endsWith("─");
					const content = borderLike ? line : prefix + line;
					const gap = Math.max(0, innerWidth - visibleWidth(content));
					const fill = borderLike ? borderColor("─".repeat(gap)) : " ".repeat(gap);
					return borderColor(left) + content + fill + borderColor(right);
				};

				// The bottom border is the last all-─ line; searching from the end keeps
				// a user-typed ─── rule from being mistaken for it. When the editor is
				// scrolled the bottom border carries a "↓ N more" indicator and is not
				// all-─, so it stays visible as a boxed line above the ╰──╯ appended below.
				const bottomIndex = lines.findLastIndex(
					(line, index) => index > 0 && isHorizontalBorder(line),
				);
				const endOfEditor = bottomIndex === -1 ? lines.length : bottomIndex;
				const body = lines.slice(1, endOfEditor);
				const extra = bottomIndex === -1 ? [] : lines.slice(bottomIndex + 1);

				const result: string[] = [];
				// Live session first: a module-level cache is shared by every session in
				// this process and would otherwise show another session's name.
				const name =
					ctx.sessionManager.getSessionName() ||
					pi.getSessionName() ||
					sessionName ||
					undefined;
				const label = name ? ctx.ui.theme.fg("accent", name) : "";

				// Top border: plain, or right-aligned session name when configured.
				if (nameEnabled && namePosition === "top" && label) {
					result.push(roundedEditorBorder(width, "╭", "╮", borderColor, label));
				} else {
					result.push(wrap(lines[0]!, "╭", "╮", ""));
				}

				for (let index = 0; index < body.length; index++) {
					result.push(wrap(body[index]!, "│", "│", index === 0 ? prompt : "  "));
				}
				// Autocomplete entries remain inside the same rounded shell, aligned
				// with the input text.
				for (const line of extra) {
					result.push(wrap(line, "│", "│", "  "));
				}
				// Bottom border: plain, or right-aligned session name when configured.
				if (nameEnabled && namePosition === "bottom" && label) {
					result.push(roundedEditorBorder(width, "╰", "╯", borderColor, label));
				} else {
					result.push(roundedEditorBorder(width, "╰", "╯", borderColor));
				}
				return result;
			}
		}

		ctx.ui.setEditorComponent(
			(tui, theme, keybindings) => new EditorBox(tui, theme, keybindings),
		);
	};

	// ── alt+s stash ──────────────────────────────────────────────────
	// alt+s: unbound by any pi built-in, so no shortcut-conflict warning.

	pi.registerShortcut("alt+s", {
		description: "Stash or restore the current draft (per project)",
		handler: (ctx) => {
			const text = ctx.ui.getEditorText();
			const key = ctx.cwd;
			const file = loadStashes();

			if (text.trim()) {
				file.stashes[key] = { text, savedAt: new Date().toISOString() };
				// Only clear the editor once the draft is safely on disk: an unwritable
				// agent dir must not cost the user their text.
				if (!saveStashes(file)) {
					ctx.ui.notify("Could not write the stash: draft kept in the editor", "error");
					return;
				}
				ctx.ui.setEditorText("");
				ctx.ui.notify(`Stashed ${text.length} chars`, "info");
			} else {
				const entry = file.stashes[key];
				if (entry) {
					ctx.ui.setEditorText(entry.text);
					delete file.stashes[key];
					// The text is back in the editor either way; a failed delete only means
					// the one-shot entry survives, so say so rather than claiming success.
					if (saveStashes(file)) {
						ctx.ui.notify(`Restored stash (${entry.text.length} chars)`, "info");
					} else {
						ctx.ui.notify(
							`Restored stash (${entry.text.length} chars), but it could not be cleared from disk`,
							"error",
						);
					}
				} else {
					ctx.ui.notify("No stash for this project", "info");
				}
			}
		},
	});

	// ── events ───────────────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		sessionName = ctx.sessionManager.getSessionName() ?? pi.getSessionName();
		applyEditor(ctx);
	});

	// The editor component is bound from session_start, which pi re-emits on resume,
	// fork, and reload. This mirrors the equivalent guard kept in pi-statusline and
	// costs nothing when the component is already bound.
	pi.on("model_select", async (_event, ctx) => {
		if (enabled && ctx.hasUI && !tuiRef) applyEditor(ctx);
	});

	pi.on("session_info_changed", async (event) => {
		sessionName = event.name;
		tuiRef?.requestRender();
	});

	// ── commands ─────────────────────────────────────────────────────

	pi.registerCommand("editor", {
		description: "Rounded editor box: on | off | name [top|bottom|on|off] | status",
		handler: async (args, ctx) => {
			const cmd = args.trim().toLowerCase();
			if (!cmd || cmd === "status") {
				ctx.ui.notify(
					`editor box: ${enabled ? "on" : "off"} · session name: ${nameEnabled ? namePosition : "off"}`,
					"info",
				);
				return;
			}
			if (cmd === "on" || cmd === "enable") {
				enabled = true;
				saveState({ enabled, sessionName: nameEnabled, sessionNamePosition: namePosition });
				applyEditor(ctx);
				ctx.ui.notify("Rounded editor box on", "info");
				return;
			}
			if (cmd === "off" || cmd === "disable") {
				enabled = false;
				saveState({ enabled, sessionName: nameEnabled, sessionNamePosition: namePosition });
				ctx.ui.setEditorComponent(undefined);
				ctx.ui.notify("Default editor restored", "info");
				return;
			}
			if (cmd === "name" || cmd.startsWith("name ")) {
				const arg = cmd.slice("name".length).trim();
				if (arg === "" || arg === "status") {
					ctx.ui.notify(
						`session name label: ${nameEnabled ? namePosition : "off"}. Set: /editor name on|off|top|bottom`,
						"info",
					);
					return;
				}
				if (arg === "on") {
					nameEnabled = true;
				} else if (arg === "off") {
					nameEnabled = false;
				} else if (arg === "top") {
					nameEnabled = true;
					namePosition = "top";
				} else if (arg === "bottom") {
					nameEnabled = true;
					namePosition = "bottom";
				} else {
					ctx.ui.notify("Usage: /editor name [on|off|top|bottom]", "error");
					return;
				}
				saveState({ enabled, sessionName: nameEnabled, sessionNamePosition: namePosition });
				tuiRef?.requestRender();
				ctx.ui.notify(`session name label: ${nameEnabled ? namePosition : "off"}`, "info");
				return;
			}
			ctx.ui.notify("Usage: /editor [on|off|status] · /editor name [on|off|top|bottom]", "error");
		},
	});

	pi.registerCommand("stash", {
		description: "Draft stash. /stash · /stash clear",
		handler: async (args, ctx) => {
			const key = ctx.cwd;
			const file = loadStashes();
			const entry = file.stashes[key];
			const raw = args.trim().toLowerCase();

			if (!raw) {
				if (entry) {
					const when = new Date(entry.savedAt).toLocaleString();
					ctx.ui.notify(`stash: ${entry.text.length} chars saved ${when}`, "info");
				} else {
					ctx.ui.notify("stash: empty for this project", "info");
				}
				return;
			}

			if (raw === "clear") {
				delete file.stashes[key];
				if (saveStashes(file)) {
					ctx.ui.notify("stash: cleared", "info");
				} else {
					ctx.ui.notify("stash: could not be cleared (write failed)", "error");
				}
				return;
			}

			ctx.ui.notify("Usage: /stash (status) · /stash clear", "info");
		},
	});
}