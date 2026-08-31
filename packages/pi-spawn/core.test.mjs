import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSpawnConfig, resolveAgents, parseSpawnArgs, assertConfirmed } from "./core.mjs";

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

test("parseSpawnArgs bare /spawn asks for topic", () => {
	const parsed = parseSpawnArgs("");
	assert.equal(parsed.form, "bare");
	assert.equal(parsed.asksForTopic, true);
	assert.equal(parsed.useDefaultSet, true);
	assert.equal(parsed.background, false);
	assert.equal(parsed.names, undefined);
});

test("parseSpawnArgs named agent on this", () => {
	const parsed = parseSpawnArgs("opus on this");
	assert.equal(parsed.form, "named");
	assert.deepEqual(parsed.names, ["opus"]);
	assert.equal(parsed.topic, "this");
	assert.equal(parsed.asksForTopic, false);
	assert.equal(parsed.useDefaultSet, false);
});

test("parseSpawnArgs the agents on this", () => {
	const parsed = parseSpawnArgs("the agents on this");
	assert.equal(parsed.form, "default-set");
	assert.equal(parsed.useDefaultSet, true);
	assert.equal(parsed.topic, "this");
	assert.equal(parsed.asksForTopic, false);
});

test("parseSpawnArgs background forces headless request flag", () => {
	const parsed = parseSpawnArgs("background the agents on this");
	assert.equal(parsed.background, true);
	assert.equal(parsed.form, "default-set");
	assert.equal(parsed.topic, "this");
});

test("assertConfirmed blocks unconfirmed brief", () => {
	assert.throws(() => assertConfirmed({ confirmed: false, brief: "look into X" }), /confirm/i);
});

test("assertConfirmed blocks empty brief even when confirmed", () => {
	assert.throws(() => assertConfirmed({ confirmed: true, brief: "  " }), /brief/i);
});

test("assertConfirmed passes confirmed brief through", () => {
	assert.equal(assertConfirmed({ confirmed: true, brief: " look into X " }), "look into X");
});
