/**
 * Register the editor-draft copy shortcut.
 *
 * The clipboard function is injected so the shortcut's behavior can be tested
 * without reading from or writing to the host clipboard.
 *
 * @param {{ registerShortcut: (shortcut: "alt+c", options: { description: string, handler: (ctx: { ui: { getEditorText: () => string, notify: (message: string, level: "info" | "error") => void } }) => Promise<void> }) => void }} pi
 * @param {(text: string) => Promise<void>} copyText
 */
export function registerCopyDraftShortcut(pi, copyText) {
	pi.registerShortcut("alt+c", {
		description: "Copy the full editor draft without visual borders or wrapping",
		handler: async (ctx) => {
			const text = ctx.ui.getEditorText();
			if (!text) {
				ctx.ui.notify("Editor is empty", "info");
				return;
			}

			try {
				await copyText(text);
				ctx.ui.notify(`Copied ${text.length} chars from editor`, "info");
			} catch {
				ctx.ui.notify("Could not copy the editor draft", "error");
			}
		},
	});
}
