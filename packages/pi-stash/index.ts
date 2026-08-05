/**
 * pi-stash — draft stash for the input editor
 *
 * ctrl+s with text in the editor stashes it (per project) and clears the
 * editor; ctrl+s with an empty editor restores the stashed draft. Single stash per project, keyed by
 * session cwd, persisted to ~/.pi/agent/stash.json (same dir pattern as
 * toolview.json). Survives sessions and restarts.
 *
 * The stash is a plain editor convenience: it never touches the conversation,
 * the LLM, or the session file.
 *
 * Commands:
 *   /stash          Show status for this project
 *   /stash clear    Clear this project's stash
 *
 * Note on the key: pi binds ctrl+s to app.session.toggleSort (session tree)
 * and app.models.save (models selector), but neither is reserved for
 * extensions and neither fires while the input editor is focused, so the
 * extension shortcut wins in the editor. A benign "conflict" warning appears
 * in the extensions list; remap those two built-ins in your keybindings config
 * if the warning bothers you.
 */

import { type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

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
		return { stashes: {} };
	}
}

function saveStashes(file: StashFile): void {
	try {
		mkdirSync(dirname(stashPath()), { recursive: true });
		writeFileSync(stashPath(), `${JSON.stringify(file, null, "\t")}\n`, "utf-8");
	} catch {
		// non-fatal: stash is best-effort
	}
}

export default function (pi: ExtensionAPI) {
	pi.registerShortcut("ctrl+s", {
		description: "Stash or restore the current draft (per project)",
		handler: (ctx) => {
			const text = ctx.ui.getEditorText();
			const key = ctx.cwd;
			const file = loadStashes();

			if (text.trim()) {
				file.stashes[key] = { text, savedAt: new Date().toISOString() };
				saveStashes(file);
				ctx.ui.setEditorText("");
				ctx.ui.notify(`Stashed ${text.length} chars`, "info");
			} else {
				const entry = file.stashes[key];
				if (entry) {
					ctx.ui.setEditorText(entry.text);
					ctx.ui.notify(`Restored stash (${entry.text.length} chars)`, "info");
				} else {
					ctx.ui.notify("No stash for this project", "info");
				}
			}
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
				saveStashes(file);
				ctx.ui.notify("stash: cleared", "info");
				return;
			}

			ctx.ui.notify("Usage: /stash (status) · /stash clear", "info");
		},
	});
}