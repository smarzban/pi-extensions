import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Type } from "typebox";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	SPAWN_COMMAND,
	SPAWN_TOOL,
	loadSpawnConfig,
	parseSpawnArgs,
	planSpawnRun,
	executeSpawnRun,
} from "./core.mjs";

type ExecResult = { stdout: string; stderr: string; code: number };

function runCommand(
	command: string,
	args: string[],
	options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<ExecResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: options.env ?? process.env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		const timer =
			options.timeoutMs && options.timeoutMs > 0
				? setTimeout(() => {
						child.kill("SIGTERM");
						reject(new Error(`${command} timed out after ${options.timeoutMs}ms`));
					}, options.timeoutMs)
				: undefined;
		child.stdout.on("data", (chunk) => {
			stdout += String(chunk);
		});
		child.stderr.on("data", (chunk) => {
			stderr += String(chunk);
		});
		child.on("error", (err) => {
			if (timer) clearTimeout(timer);
			reject(err);
		});
		child.on("close", (code) => {
			if (timer) clearTimeout(timer);
			resolve({ stdout, stderr, code: code ?? 1 });
		});
	});
}

function parseJsonLine(stdout: string): unknown {
	const line = stdout
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean)
		.at(-1);
	if (!line) throw new Error("expected JSON from herdr");
	return JSON.parse(line);
}

async function defaultRunHeadless(launch: {
	argv: string[];
	cwd: string;
}): Promise<ExecResult> {
	const [cmd, ...args] = launch.argv;
	return runCommand(cmd, args, { cwd: launch.cwd });
}

async function defaultRunHerdr(launch: {
	cwd: string;
	herdr: {
		kind: string;
		agentLabel: string;
		tabLabel: string;
		agentArgs: string[];
		prompt: string;
	};
}): Promise<{ paneId: string }> {
	const created = await runCommand("herdr", [
		"tab",
		"create",
		"--no-focus",
		"--cwd",
		launch.cwd,
		"--label",
		launch.herdr.tabLabel,
	]);
	if (created.code !== 0) {
		throw new Error(`herdr tab create failed: ${created.stderr || created.stdout}`);
	}
	const payload = parseJsonLine(created.stdout) as {
		result?: { root_pane?: { pane_id?: string } };
	};
	const paneId = payload?.result?.root_pane?.pane_id;
	if (!paneId) throw new Error("herdr tab create did not return pane_id");

	const started = await runCommand("herdr", [
		"agent",
		"start",
		launch.herdr.agentLabel,
		"--kind",
		launch.herdr.kind,
		"--pane",
		paneId,
		"--",
		...launch.herdr.agentArgs,
	]);
	if (started.code !== 0) {
		throw new Error(`herdr agent start failed: ${started.stderr || started.stdout}`);
	}

	const prompted = await runCommand("herdr", [
		"agent",
		"prompt",
		paneId,
		launch.herdr.prompt,
		"--wait",
		"--until",
		"done",
		"--until",
		"idle",
		"--timeout",
		"600000",
	]);
	if (prompted.code !== 0) {
		// Still allow collect to pick up a finding if the child wrote one.
		throw new Error(`herdr agent prompt failed: ${prompted.stderr || prompted.stdout}`);
	}
	return { paneId };
}

function formatSpawnResult(result: {
	brief: string;
	runtime: string;
	findings: Array<{ agentName: string; content: string }>;
	missing: Array<{ agentName: string; reason?: string }>;
	timedOut: boolean;
	elapsedMs: number;
	startErrors: Array<{ agentName: string; error: string }>;
}): string {
	const parts: string[] = [];
	parts.push(`Spawn runtime: ${result.runtime}`);
	parts.push(`Elapsed: ${Math.round(result.elapsedMs)}ms`);
	parts.push(`Timed out: ${result.timedOut ? "yes" : "no"}`);
	parts.push("");
	parts.push("## Findings");
	if (!result.findings.length) {
		parts.push("(none)");
	} else {
		for (const finding of result.findings) {
			parts.push(`### ${finding.agentName}`);
			parts.push(finding.content.trimEnd());
			parts.push("");
		}
	}
	if (result.missing.length) {
		parts.push("## Missing / failed");
		for (const miss of result.missing) {
			parts.push(`- ${miss.agentName}: ${miss.reason ?? "missing"}`);
		}
	}
	if (result.startErrors?.length) {
		parts.push("## Start errors");
		for (const err of result.startErrors) {
			parts.push(`- ${err.agentName}: ${err.error}`);
		}
	}
	parts.push("");
	parts.push(
		"Synthesize these findings for the user in chat. Do not claim missing agents finished.",
	);
	return parts.join("\n");
}

export default function (pi: ExtensionAPI) {
	const configPath = join(getAgentDir(), "spawn.json");

	pi.registerCommand(SPAWN_COMMAND, {
		description:
			"Fan out a confirmed brief to named Pi agents (/spawn, /spawn <name> on this, /spawn the agents on this)",
		handler: async (args, ctx) => {
			try {
				const parsed = parseSpawnArgs(args ?? "");
				if (parsed.asksForTopic) {
					await pi.sendMessage({
						customType: "pi-spawn",
						content:
							"What should the agents look into? Draft a short brief, show it to the user, and only call spawn_run after they confirm.",
						display: true,
					});
					return;
				}
				const target =
					parsed.form === "named"
						? `agent(s) ${parsed.names?.join(", ")}`
						: "the default agent set";
				const topic =
					parsed.topic === "this"
						? "the current topic (summarize it into a brief)"
						: "the requested topic";
				await pi.sendMessage({
					customType: "pi-spawn",
					content: [
						`Prepare a spawn of ${target} on ${topic}.`,
						parsed.background ? "Use background/headless runtime." : null,
						"Draft the brief, present it for confirmation (yes / edit / cancel), and only then call spawn_run with confirmed=true.",
						"Do not open Herdr tabs or run child pi processes yourself.",
					]
						.filter(Boolean)
						.join("\n"),
					display: true,
				}, { triggerTurn: true });
			} catch (err) {
				ctx.ui.notify(String((err as Error).message || err), "error");
			}
		},
	});

	pi.registerTool({
		name: SPAWN_TOOL,
		label: "Spawn run",
		description:
			"Start a confirmed spawn run: fan out the brief to named Pi agents, wait with timeout, return findings for parent synthesis. Requires confirmed=true.",
		promptSnippet: "Fan out a confirmed brief to named Pi agents and return findings",
		promptGuidelines: [
			"Use spawn_run only after the user explicitly confirms the draft brief in chat.",
			"Never set confirmed=true unless the user said yes (or equivalent) to the presented brief.",
			"After spawn_run returns, synthesize findings in chat and clearly mark missing agents.",
		],
		parameters: Type.Object({
			brief: Type.String({ description: "Confirmed brief text sent to every child" }),
			confirmed: Type.Boolean({ description: "Must be true; user confirmed the brief" }),
			names: Type.Optional(
				Type.Array(Type.String(), {
					description: "Named agents to run; omit with useDefaultSet",
				}),
			),
			useDefaultSet: Type.Optional(
				Type.Boolean({ description: "If true, expand spawn.json defaultSet" }),
			),
			background: Type.Optional(
				Type.Boolean({ description: "Force headless even when HERDR_ENV=1" }),
			),
		}),
		async execute(_toolCallId, params, _signal, onUpdate, ctx) {
			onUpdate?.({ content: [{ type: "text", text: "Loading spawn.json…" }] });
			const config = await loadSpawnConfig(configPath);
			const useDefaultSet =
				params.useDefaultSet === true ||
				!params.names ||
				params.names.length === 0;
			const plan = planSpawnRun({
				config,
				brief: params.brief,
				confirmed: params.confirmed,
				names: params.names,
				useDefaultSet,
				cwd: ctx.cwd,
				herdrEnv: process.env.HERDR_ENV,
				background: Boolean(params.background),
				runId: randomUUID(),
				baseDir: tmpdir(),
			});
			onUpdate?.({
				content: [
					{
						type: "text",
						text: `Starting ${plan.launches.length} agent(s) via ${plan.runtime}…`,
					},
				],
			});
			const result = await executeSpawnRun(plan, {
				runHeadless: defaultRunHeadless,
				runHerdr: defaultRunHerdr,
			});
			const text = formatSpawnResult(result);
			return {
				content: [{ type: "text", text }],
				details: result,
			};
		},
	});
}
