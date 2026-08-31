import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSpawnConfig, resolveAgents, parseSpawnArgs, assertConfirmed, chooseRuntime, buildChildLaunch } from "./core.mjs";

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

test("chooseRuntime uses herdr when HERDR_ENV=1 and not background", () => {
	assert.equal(chooseRuntime({ herdrEnv: "1", background: false }), "herdr");
});

test("chooseRuntime uses headless outside Herdr", () => {
	assert.equal(chooseRuntime({ herdrEnv: undefined, background: false }), "headless");
	assert.equal(chooseRuntime({ herdrEnv: "0", background: false }), "headless");
});

test("chooseRuntime forces headless when background requested even in Herdr", () => {
	assert.equal(chooseRuntime({ herdrEnv: "1", background: true }), "headless");
});

test("buildChildLaunch includes cwd model thinking tools brief and finding path", () => {
	const agent = { name: "opus", model: "anthropic/claude-opus-4", thinking: "high" };
	const launch = buildChildLaunch({
		agent,
		cwd: "/tmp/project",
		brief: "Investigate auth",
		findingPath: "/tmp/pi-spawn-run/opus.md",
		runtime: "headless",
	});
	assert.equal(launch.runtime, "headless");
	assert.equal(launch.cwd, "/tmp/project");
	assert.equal(launch.model, "anthropic/claude-opus-4");
	assert.equal(launch.thinking, "high");
	assert.equal(launch.tools, "full");
	assert.equal(launch.brief, "Investigate auth");
	assert.equal(launch.findingPath, "/tmp/pi-spawn-run/opus.md");
	assert.equal(launch.agentName, "opus");
	assert.ok(launch.prompt.includes("Investigate auth"));
	assert.ok(launch.prompt.includes("/tmp/pi-spawn-run/opus.md"));
	assert.ok(Array.isArray(launch.argv));
	assert.ok(launch.argv.includes("--model"));
	assert.ok(launch.argv.includes("anthropic/claude-opus-4"));
	assert.ok(launch.argv.includes("--thinking"));
	assert.ok(launch.argv.includes("high"));
	assert.ok(launch.argv.includes("-p") || launch.argv.includes("--print"));
	assert.ok(launch.argv.includes("--no-session"));
});

test("buildChildLaunch herdr plan names tab and pi kind", () => {
	const launch = buildChildLaunch({
		agent: { name: "fable", model: "openai/gpt-5", thinking: "medium" },
		cwd: "/work",
		brief: "Compare approaches",
		findingPath: "/tmp/run/fable.md",
		runtime: "herdr",
	});
	assert.equal(launch.runtime, "herdr");
	assert.equal(launch.herdr.kind, "pi");
	assert.equal(launch.herdr.agentLabel, "fable");
	assert.ok(launch.herdr.tabLabel.includes("fable"));
	assert.deepEqual(launch.herdr.agentArgs.slice(0, 4), ["--model", "openai/gpt-5", "--thinking", "medium"]);
});
