import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSpawnConfig, resolveAgents } from "./core.mjs";

const fixtureConfig = {
	agents: {
		opus: { model: "anthropic/claude-opus-4", thinking: "high" },
		fable: { model: "openai/gpt-5", thinking: "medium" },
		flash: { model: "google/gemini-2.5-flash", thinking: "low" },
	},
	defaultSet: ["opus", "fable"],
	timeoutMs: 120_000,
};

async function tempDir(prefix = "pi-spawn-") {
	return mkdtemp(join(tmpdir(), prefix));
}

test("resolveAgents expands default set from spawn.json", async () => {
	const dir = await tempDir();
	const path = join(dir, "spawn.json");
	await writeFile(path, JSON.stringify(fixtureConfig, null, 2));
	const config = await loadSpawnConfig(path);
	const agents = resolveAgents(config);
	assert.deepEqual(
		agents.map((a) => a.name),
		["opus", "fable"],
	);
	assert.equal(agents[0].model, "anthropic/claude-opus-4");
	assert.equal(agents[0].thinking, "high");
	assert.equal(agents[1].model, "openai/gpt-5");
	await rm(dir, { recursive: true, force: true });
});

test("resolveAgents rejects unknown names", async () => {
	const dir = await tempDir();
	const path = join(dir, "spawn.json");
	await writeFile(path, JSON.stringify(fixtureConfig, null, 2));
	const config = await loadSpawnConfig(path);
	assert.throws(() => resolveAgents(config, ["opus", "unknown"]), /unknown/i);
	await rm(dir, { recursive: true, force: true });
});

test("resolveAgents resolves explicit named agents", () => {
	const agents = resolveAgents(fixtureConfig, ["flash", "opus"]);
	assert.deepEqual(
		agents.map((a) => ({ name: a.name, model: a.model, thinking: a.thinking })),
		[
			{ name: "flash", model: "google/gemini-2.5-flash", thinking: "low" },
			{ name: "opus", model: "anthropic/claude-opus-4", thinking: "high" },
		],
	);
});
