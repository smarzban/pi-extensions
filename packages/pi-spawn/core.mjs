import { readFile, mkdir, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

/**
 * @typedef {{ name: string, model: string, thinking: string }} NamedAgent
 * @typedef {{ agents: Record<string, { model: string, thinking?: string }>, defaultSet: string[], timeoutMs: number }} SpawnConfig
 */

/**
 * Load and validate spawn.json from a path (or accept an already-parsed object via deps).
 * @param {string} configPath
 * @param {{ readFile?: typeof readFile }} [deps]
 * @returns {Promise<SpawnConfig>}
 */
export async function loadSpawnConfig(configPath, deps = {}) {
	const read = deps.readFile ?? readFile;
	const raw = await read(configPath, "utf8");
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		throw new Error(`spawn.json is not valid JSON: ${err.message}`);
	}
	return validateSpawnConfig(parsed);
}

/**
 * @param {unknown} value
 * @returns {SpawnConfig}
 */
export function validateSpawnConfig(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("spawn.json must be an object");
	}
	const agentsIn = value.agents;
	if (!agentsIn || typeof agentsIn !== "object" || Array.isArray(agentsIn)) {
		throw new Error("spawn.json.agents must be an object of named agents");
	}
	/** @type {Record<string, { model: string, thinking: string }>} */
	const agents = {};
	for (const [name, entry] of Object.entries(agentsIn)) {
		if (!name.trim()) throw new Error("spawn.json agent names must be non-empty");
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
			throw new Error(`spawn.json agent "${name}" must be an object`);
		}
		if (typeof entry.model !== "string" || !entry.model.trim()) {
			throw new Error(`spawn.json agent "${name}" requires a non-empty model`);
		}
		const thinking = entry.thinking ?? "off";
		if (typeof thinking !== "string" || !THINKING_LEVELS.has(thinking)) {
			throw new Error(
				`spawn.json agent "${name}" has invalid thinking "${thinking}" (expected ${[...THINKING_LEVELS].join(", ")})`,
			);
		}
		agents[name] = { model: entry.model.trim(), thinking };
	}
	if (Object.keys(agents).length === 0) {
		throw new Error("spawn.json.agents must define at least one named agent");
	}

	const defaultSet = value.defaultSet;
	if (!Array.isArray(defaultSet) || defaultSet.length === 0) {
		throw new Error("spawn.json.defaultSet must be a non-empty array of agent names");
	}
	for (const name of defaultSet) {
		if (typeof name !== "string" || !(name in agents)) {
			throw new Error(`spawn.json.defaultSet references unknown agent "${name}"`);
		}
	}

	const timeoutMs = value.timeoutMs ?? 300_000;
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
		throw new Error("spawn.json.timeoutMs must be a positive number");
	}

	return { agents, defaultSet: [...defaultSet], timeoutMs: Number(timeoutMs) };
}

/**
 * Resolve named agents. With no names (or empty), expands defaultSet.
 * @param {SpawnConfig} config
 * @param {string[] | undefined | null} [names]
 * @returns {NamedAgent[]}
 */
export function resolveAgents(config, names) {
	const target =
		names === undefined || names === null || (Array.isArray(names) && names.length === 0)
			? config.defaultSet
			: names;
	if (!Array.isArray(target)) {
		throw new Error("agent names must be an array");
	}
	/** @type {NamedAgent[]} */
	const resolved = [];
	const seen = new Set();
	for (const name of target) {
		if (typeof name !== "string" || !name.trim()) {
			throw new Error(`unknown agent name: ${JSON.stringify(name)}`);
		}
		const entry = config.agents[name];
		if (!entry) {
			throw new Error(`unknown agent name: ${name}`);
		}
		if (seen.has(name)) continue;
		seen.add(name);
		resolved.push({ name, model: entry.model, thinking: entry.thinking });
	}
	return resolved;
}

/**
 * Parse `/spawn` command args (text after the command name).
 * Forms: bare, `<name> on this`, `the agents on this`, optional leading background/headless.
 * @param {string} args
 */
export function parseSpawnArgs(args = "") {
	const trimmed = String(args ?? "").trim();
	if (!trimmed) {
		return {
			form: "bare",
			asksForTopic: true,
			useDefaultSet: true,
			background: false,
			names: undefined,
			topic: undefined,
		};
	}

	const tokens = trimmed.split(/\s+/);
	let background = false;
	let i = 0;
	if (tokens[0] === "background" || tokens[0] === "headless") {
		background = true;
		i = 1;
	}
	const rest = tokens.slice(i).join(" ");
	if (!rest) {
		return {
			form: "bare",
			asksForTopic: true,
			useDefaultSet: true,
			background,
			names: undefined,
			topic: undefined,
		};
	}

	const defaultOnThis = /^the\s+agents\s+on\s+this$/i;
	if (defaultOnThis.test(rest)) {
		return {
			form: "default-set",
			asksForTopic: false,
			useDefaultSet: true,
			background,
			names: undefined,
			topic: "this",
		};
	}

	const namedOnThis = /^(\S+)\s+on\s+this$/i;
	const namedMatch = rest.match(namedOnThis);
	if (namedMatch) {
		const name = namedMatch[1];
		if (/^the$/i.test(name)) {
			throw new Error(`unrecognized /spawn args: ${rest}`);
		}
		return {
			form: "named",
			asksForTopic: false,
			useDefaultSet: false,
			background,
			names: [name],
			topic: "this",
		};
	}

	throw new Error(
		`unrecognized /spawn args: ${rest} (try /spawn, /spawn <name> on this, /spawn the agents on this)`,
	);
}

/**
 * Gate fan-out: require explicit confirm and non-empty brief text.
 * @param {{ confirmed?: boolean, brief?: string }} input
 * @returns {string} trimmed brief
 */
export function assertConfirmed(input = {}) {
	const confirmed = Boolean(input.confirmed);
	const brief = typeof input.brief === "string" ? input.brief.trim() : "";
	if (!confirmed) {
		throw new Error("brief is not confirmed; ask the user to confirm before starting spawn");
	}
	if (!brief) {
		throw new Error("brief is empty; draft a brief before starting spawn");
	}
	return brief;
}

/**
 * Pick display runtime: Herdr tabs when HERDR_ENV=1 unless background/headless requested.
 * @param {{ herdrEnv?: string, background?: boolean }} input
 * @returns {"herdr" | "headless"}
 */
export function chooseRuntime(input = {}) {
	const inHerdr = String(input.herdrEnv ?? "") === "1";
	if (input.background) return "headless";
	return inHerdr ? "herdr" : "headless";
}

/**
 * Build the prompt that tells a child to answer the brief and write a finding file.
 * @param {{ brief: string, findingPath: string, agentName: string }} input
 */
export function buildFindingPrompt({ brief, findingPath, agentName }) {
	return [
		`You are spawned agent "${agentName}" working the same confirmed brief as sibling agents.`,
		"Answer the brief thoroughly using your normal Pi tools.",
		"When finished, write your complete finding as Markdown to this exact path (overwrite if needed):",
		findingPath,
		"Do not ask the parent for confirmation. Do not spawn further agents.",
		"",
		"## Confirmed brief",
		brief,
	].join("\n");
}

/**
 * Pure per-child launch descriptor (no live Herdr/pi calls).
 * @param {{
 *   agent: { name: string, model: string, thinking: string },
 *   cwd: string,
 *   brief: string,
 *   findingPath: string,
 *   runtime: "herdr" | "headless",
 * }} input
 */
export function buildChildLaunch(input) {
	const { agent, cwd, brief, findingPath, runtime } = input;
	if (!agent?.name || !agent?.model) throw new Error("buildChildLaunch requires agent name and model");
	if (!cwd) throw new Error("buildChildLaunch requires cwd");
	if (!brief?.trim()) throw new Error("buildChildLaunch requires brief");
	if (!findingPath) throw new Error("buildChildLaunch requires findingPath");
	if (runtime !== "herdr" && runtime !== "headless") {
		throw new Error(`unknown runtime: ${runtime}`);
	}

	const prompt = buildFindingPrompt({
		brief: brief.trim(),
		findingPath,
		agentName: agent.name,
	});

	const modelArgs = ["--model", agent.model, "--thinking", agent.thinking ?? "off"];
	const headlessArgv = [
		"pi",
		"-p",
		"--no-session",
		...modelArgs,
		"--append-system-prompt",
		`Write your final finding as Markdown to ${findingPath} when done.`,
		"--",
		prompt,
	];

	const herdr = {
		kind: "pi",
		agentLabel: agent.name,
		tabLabel: `spawn:${agent.name}`,
		cwd,
		agentArgs: [...modelArgs],
		prompt,
	};

	return {
		runtime,
		agentName: agent.name,
		cwd,
		model: agent.model,
		thinking: agent.thinking ?? "off",
		tools: "full",
		brief: brief.trim(),
		findingPath,
		prompt,
		argv: headlessArgv,
		herdr,
	};
}

/**
 * @param {{ runId: string, baseDir?: string, mkdir?: typeof mkdir }} input
 */
export async function createRunDir(input) {
	const runId = String(input.runId || "").trim();
	if (!runId) throw new Error("createRunDir requires runId");
	const base = input.baseDir ?? tmpdir();
	const runDir = join(base, `pi-spawn-${runId}`);
	const make = input.mkdir ?? mkdir;
	await make(runDir, { recursive: true });
	return { runId, runDir };
}

/** @param {string} runDir @param {string} agentName */
export function findingPathFor(runDir, agentName) {
	const safe = String(agentName).replace(/[^a-zA-Z0-9._-]+/g, "_");
	return join(runDir, `${safe}.md`);
}

function sleep(ms, deps = {}) {
	const wait = deps.sleep ?? ((n) => new Promise((resolve) => setTimeout(resolve, n)));
	return wait(ms);
}

async function fileExists(path, deps = {}) {
	const probe = deps.access ?? access;
	try {
		await probe(path);
		return true;
	} catch {
		return false;
	}
}

/**
 * Wait until timeout (or all findings present), then return finished + missing.
 * Injectable waitFor/readFile/now/sleep for unit tests (no live children).
 * @param {{
 *   runDir: string,
 *   agents: Array<{ name: string, findingPath: string }>,
 *   timeoutMs: number,
 *   pollMs?: number,
 *   waitFor?: (agent: { name: string, findingPath: string }) => Promise<{ done?: boolean }>,
 *   readFile?: typeof readFile,
 *   now?: () => number,
 *   sleep?: (ms: number) => Promise<void>,
 *   access?: typeof access,
 * }} input
 */
export async function awaitAndCollect(input) {
	const {
		runDir,
		agents,
		timeoutMs,
		pollMs = 250,
		waitFor,
		readFile: read = readFile,
		now = Date.now,
	} = input;
	if (!runDir) throw new Error("awaitAndCollect requires runDir");
	if (!Array.isArray(agents) || agents.length === 0) {
		throw new Error("awaitAndCollect requires agents");
	}
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
		throw new Error("awaitAndCollect requires positive timeoutMs");
	}

	const started = now();
	const pending = new Map(agents.map((a) => [a.name, a]));
	/** @type {Array<{ agentName: string, findingPath: string, content: string }>} */
	const findings = [];

	while (pending.size > 0 && now() - started < timeoutMs) {
		for (const [name, agent] of [...pending.entries()]) {
			if (waitFor) {
				try {
					await waitFor(agent);
				} catch {
					/* keep waiting until timeout; failures surface as missing */
				}
			}
			if (await fileExists(agent.findingPath, input)) {
				const content = await read(agent.findingPath, "utf8");
				findings.push({ agentName: name, findingPath: agent.findingPath, content });
				pending.delete(name);
			}
		}
		if (pending.size === 0) break;
		const remaining = timeoutMs - (now() - started);
		if (remaining <= 0) break;
		await sleep(Math.min(pollMs, remaining), input);
	}

	const missing = [...pending.values()].map((agent) => ({
		agentName: agent.name,
		findingPath: agent.findingPath,
		reason: "timeout",
	}));

	return {
		runDir,
		findings,
		missing,
		timedOut: missing.length > 0,
		elapsedMs: now() - started,
	};
}

/**
 * Delete the temp run directory after collect (success or partial).
 * @param {string} runDir
 * @param {{ rm?: typeof rm }} [deps]
 */
export async function cleanupRunDir(runDir, deps = {}) {
	if (!runDir) throw new Error("cleanupRunDir requires runDir");
	const remove = deps.rm ?? rm;
	await remove(runDir, { recursive: true, force: true });
}
