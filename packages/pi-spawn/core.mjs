import { readFile } from "node:fs/promises";

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
