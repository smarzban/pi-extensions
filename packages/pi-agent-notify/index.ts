import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MAX_CHARS = 2000;

function notifierPath(): string | undefined {
	const candidates = [
		process.env.AGENT_NOTIFY_BIN,
		join(homedir(), ".local", "bin", "agent-notify"),
		join(dirname(fileURLToPath(import.meta.url)), "bin", "agent-notify"),
	];
	return candidates.find((p) => p && existsSync(p));
}

function lastAssistantText(messages: unknown[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i] as { role?: string; content?: unknown };
		if (m?.role !== "assistant") continue;
		if (typeof m.content === "string") return m.content;
		if (Array.isArray(m.content)) {
			const text = m.content
				.filter((c: any) => c?.type === "text" && typeof c.text === "string")
				.map((c: any) => c.text)
				.join("\n")
				.trim();
			if (text) return text;
		}
	}
	return "";
}

export default function agentNotify(pi: ExtensionAPI) {
	// agent_end fires once the agent loop is done and pi is back at the prompt.
	pi.on("agent_end", (event, ctx) => {
		try {
			const bin = notifierPath();
			if (!bin) return;
			const sm = ctx.sessionManager;
			let text = lastAssistantText(event.messages ?? []);
			if (text.length > MAX_CHARS) text = `${text.slice(0, MAX_CHARS)}...`;
			const payload = JSON.stringify({
				session_id: sm.getSessionId(),
				session_file: sm.getSessionFile() ?? null,
				cwd: sm.getCwd?.() ?? ctx.cwd ?? process.cwd(),
				last_assistant_message: text,
			});
			const child = spawn("bash", [bin, "--source", "pi"], {
				detached: true,
				stdio: ["pipe", "ignore", "ignore"],
			});
			child.on("error", () => {});
			child.stdin?.on("error", () => {});
			child.stdin?.end(payload);
			child.unref();
		} catch {
			// never break the agent
		}
	});
}
