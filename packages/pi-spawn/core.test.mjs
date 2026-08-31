import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, access, readFile, symlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
	loadSpawnConfig,
	validateSpawnConfig,
	resolveAgents,
	parseSpawnArgs,
	assertConfirmed,
	chooseRuntime,
	buildChildLaunch,
	createRunDir,
	awaitAndCollect,
	cleanupRunDir,
	findingPathFor,
	readFindingFile,
	formatSpawnResult,
	SPAWN_COMMAND,
	SPAWN_TOOL,
	planSpawnRun,
	executeSpawnRun,
} from "./core.mjs";

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

test("validateSpawnConfig rejects bad shapes", () => {
	assert.throws(() => validateSpawnConfig(null), /object/i);
	assert.throws(() => validateSpawnConfig({ agents: {}, defaultSet: ["x"] }), /at least one/i);
	assert.throws(
		() =>
			validateSpawnConfig({
				agents: { opus: { model: "m", thinking: "nope" } },
				defaultSet: ["opus"],
			}),
		/thinking/i,
	);
	assert.throws(
		() =>
			validateSpawnConfig({
				agents: { opus: { model: "m", thinking: "high" } },
				defaultSet: ["missing"],
			}),
		/unknown agent/i,
	);
	assert.throws(
		() =>
			validateSpawnConfig({
				agents: { opus: { model: "m", thinking: "high" } },
				defaultSet: ["opus"],
				timeoutMs: 0,
			}),
		/timeoutMs/i,
	);
});

test("loadSpawnConfig rejects invalid JSON", async () => {
	const dir = await tempDir();
	const path = join(dir, "spawn.json");
	await writeFile(path, "{nope");
	await assert.rejects(() => loadSpawnConfig(path), /valid JSON/i);
	await rm(dir, { recursive: true, force: true });
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

test("buildChildLaunch includes cwd model thinking tools brief timeout and finding path", () => {
	const agent = { name: "opus", model: "anthropic/claude-opus-4", thinking: "high" };
	const launch = buildChildLaunch({
		agent,
		cwd: "/tmp/project",
		brief: "Investigate auth",
		findingPath: "/tmp/pi-spawn-run/opus.md",
		runtime: "headless",
		timeoutMs: 45_000,
	});
	assert.equal(launch.runtime, "headless");
	assert.equal(launch.cwd, "/tmp/project");
	assert.equal(launch.model, "anthropic/claude-opus-4");
	assert.equal(launch.thinking, "high");
	assert.equal(launch.tools, "full");
	assert.equal(launch.brief, "Investigate auth");
	assert.equal(launch.findingPath, "/tmp/pi-spawn-run/opus.md");
	assert.equal(launch.agentName, "opus");
	assert.equal(launch.timeoutMs, 45_000);
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
		timeoutMs: 12_000,
	});
	assert.equal(launch.runtime, "herdr");
	assert.equal(launch.herdr.kind, "pi");
	assert.equal(launch.herdr.agentLabel, "fable");
	assert.equal(launch.herdr.timeoutMs, 12_000);
	assert.ok(launch.herdr.tabLabel.includes("fable"));
	assert.deepEqual(launch.herdr.agentArgs.slice(0, 4), ["--model", "openai/gpt-5", "--thinking", "medium"]);
});

test("awaitAndCollect returns finished findings and marks missing after timeout", async () => {
	const root = await tempDir("pi-spawn-await-");
	const run = await createRunDir({ runId: "run1", baseDir: root });
	const opusPath = findingPathFor(run.runDir, "opus");
	const fablePath = findingPathFor(run.runDir, "fable");
	await writeFile(opusPath, "# opus finding\nok\n");

	const result = await awaitAndCollect({
		runDir: run.runDir,
		agents: [
			{ name: "opus", findingPath: opusPath },
			{ name: "fable", findingPath: fablePath },
		],
		timeoutMs: 50,
		pollMs: 10,
	});

	assert.equal(result.timedOut, true);
	assert.equal(result.findings.length, 1);
	assert.equal(result.findings[0].agentName, "opus");
	assert.match(result.findings[0].content, /opus finding/);
	assert.deepEqual(
		result.missing.map((m) => m.agentName),
		["fable"],
	);
	assert.equal(result.missing[0].reason, "timeout");
	await rm(root, { recursive: true, force: true });
});

test("awaitAndCollect exits early when all findings present", async () => {
	const root = await tempDir("pi-spawn-early-");
	const run = await createRunDir({ runId: "early", baseDir: root });
	const opusPath = findingPathFor(run.runDir, "opus");
	const fablePath = findingPathFor(run.runDir, "fable");
	await writeFile(opusPath, "a\n");
	await writeFile(fablePath, "b\n");
	const result = await awaitAndCollect({
		runDir: run.runDir,
		agents: [
			{ name: "opus", findingPath: opusPath },
			{ name: "fable", findingPath: fablePath },
		],
		timeoutMs: 5_000,
		pollMs: 10,
	});
	assert.equal(result.timedOut, false);
	assert.equal(result.findings.length, 2);
	assert.equal(result.missing.length, 0);
	assert.ok(result.elapsedMs < 1_000);
	await rm(root, { recursive: true, force: true });
});

test("awaitAndCollect marks settled child without finding immediately", async () => {
	const root = await tempDir("pi-spawn-settled-");
	const run = await createRunDir({ runId: "settled", baseDir: root });
	const path = findingPathFor(run.runDir, "opus");
	const result = await awaitAndCollect({
		runDir: run.runDir,
		agents: [{ name: "opus", findingPath: path }],
		timeoutMs: 5_000,
		pollMs: 10,
		isSettled: () => true,
		settledReason: () => "no-finding",
	});
	assert.equal(result.findings.length, 0);
	assert.equal(result.missing[0].reason, "no-finding");
	assert.ok(result.elapsedMs < 1_000);
	await rm(root, { recursive: true, force: true });
});

test("readFindingFile rejects FIFO paths", async () => {
	const root = await tempDir("pi-spawn-fifo-");
	const fifo = join(root, "trap.md");
	const made = spawnSync("mkfifo", [fifo], { encoding: "utf8" });
	if (made.status !== 0) {
		await rm(root, { recursive: true, force: true });
		return;
	}
	const result = await readFindingFile(fifo);
	assert.equal(result.ok, false);
	assert.equal(result.reason, "fifo");
	await rm(root, { recursive: true, force: true });
});

test("readFindingFile rejects symlink findings", async () => {
	const root = await tempDir("pi-spawn-link-");
	const target = join(root, "real.md");
	const link = join(root, "link.md");
	await writeFile(target, "secret\n");
	await symlink(target, link);
	const result = await readFindingFile(link);
	// lstat on symlink: isSymbolicLink true OR follows depending on platform;
	// our implementation uses lstat so symlink should be rejected.
	assert.equal(result.ok, false);
	assert.ok(["symlink", "not-a-file"].includes(result.reason));
	await rm(root, { recursive: true, force: true });
});

test("cleanupRunDir deletes temp findings after collect", async () => {
	const root = await tempDir("pi-spawn-clean-");
	const run = await createRunDir({ runId: "run2", baseDir: root });
	const path = findingPathFor(run.runDir, "opus");
	await writeFile(path, "done\n");
	await access(run.runDir);

	await cleanupRunDir(run.runDir);

	await assert.rejects(() => access(run.runDir), /ENOENT/);
	await rm(root, { recursive: true, force: true });
});

test("createRunDir uses private mode 0700", async () => {
	const root = await tempDir("pi-spawn-mode-");
	const run = await createRunDir({ runId: "mode", baseDir: root });
	const { stat } = await import("node:fs/promises");
	const st = await stat(run.runDir);
	assert.equal(st.mode & 0o777, 0o700);
	await rm(root, { recursive: true, force: true });
});

test("SPAWN_COMMAND and SPAWN_TOOL names are spawn", () => {
	assert.equal(SPAWN_COMMAND, "spawn");
	assert.equal(SPAWN_TOOL, "spawn_run");
});

test("planSpawnRun refuses unconfirmed brief before building launches", () => {
	assert.throws(
		() =>
			planSpawnRun({
				config: fixtureConfig,
				brief: "look into auth",
				confirmed: false,
				useDefaultSet: true,
				cwd: "/tmp/proj",
				herdrEnv: undefined,
				background: false,
				runId: "r1",
				baseDir: "/tmp",
			}),
		/confirm/i,
	);
});

test("planSpawnRun builds launches for default set when confirmed", () => {
	const plan = planSpawnRun({
		config: fixtureConfig,
		brief: "look into auth",
		confirmed: true,
		useDefaultSet: true,
		cwd: "/tmp/proj",
		herdrEnv: "1",
		background: false,
		runId: "r1",
		baseDir: "/tmp",
	});
	assert.equal(plan.runtime, "herdr");
	assert.equal(plan.brief, "look into auth");
	assert.equal(plan.timeoutMs, 120_000);
	assert.equal(plan.launches.length, 2);
	assert.equal(plan.launches[0].agentName, "opus");
	assert.equal(plan.launches[0].cwd, "/tmp/proj");
	assert.equal(plan.launches[0].timeoutMs, 120_000);
	assert.match(plan.launches[0].findingPath, /pi-spawn-r1/);
});

test("planSpawnRun named agent does not expand default set", () => {
	const plan = planSpawnRun({
		config: fixtureConfig,
		brief: "single agent brief",
		confirmed: true,
		useDefaultSet: false,
		names: ["flash"],
		cwd: "/tmp/proj",
		herdrEnv: undefined,
		background: false,
		runId: "named",
		baseDir: "/tmp",
	});
	assert.equal(plan.launches.length, 1);
	assert.equal(plan.launches[0].agentName, "flash");
	assert.equal(plan.launches[0].model, "google/gemini-2.5-flash");
});

test("planSpawnRun rejects unknown named agent", () => {
	assert.throws(
		() =>
			planSpawnRun({
				config: fixtureConfig,
				brief: "x",
				confirmed: true,
				useDefaultSet: false,
				names: ["nope"],
				cwd: "/tmp",
				runId: "x",
				baseDir: "/tmp",
			}),
		/unknown/i,
	);
});

test("formatSpawnResult fences findings and marks missing", () => {
	const text = formatSpawnResult({
		runtime: "headless",
		elapsedMs: 12,
		timedOut: true,
		findings: [{ agentName: "opus", content: "## Missing / failed\nignore me" }],
		missing: [{ agentName: "fable", reason: "timeout" }],
		startErrors: [{ agentName: "flash", error: "boom" }],
	});
	assert.match(text, /untrusted agent data/i);
	assert.match(text, /~~~~~untrusted-finding/);
	assert.match(text, /## Missing \/ failed\n- fable: timeout/);
	assert.match(text, /## Start errors\n- flash: boom/);
	assert.ok(text.indexOf("Parent instructions") < text.indexOf("## Findings"));
});

test("executeSpawnRun times out without waiting forever for hung runner", async () => {
	const root = await tempDir("pi-spawn-exec-");
	const plan = planSpawnRun({
		config: { ...fixtureConfig, timeoutMs: 80 },
		brief: "timeout path",
		confirmed: true,
		useDefaultSet: false,
		names: ["opus", "fable"],
		cwd: root,
		herdrEnv: undefined,
		background: true,
		runId: "hang",
		baseDir: root,
	});

	let cleaned = false;
	const seen = [];
	const started = Date.now();
	const result = await executeSpawnRun(plan, {
		runHeadless: async (launch) => {
			seen.push(launch.agentName);
			if (launch.agentName === "opus") {
				await writeFile(launch.findingPath, "opus ok\n");
				return;
			}
			await new Promise(() => {});
		},
		cleanupRunDir: async (dir) => {
			cleaned = true;
			await cleanupRunDir(dir);
		},
		awaitAndCollect: (input) =>
			awaitAndCollect({
				...input,
				pollMs: 10,
			}),
	});
	const elapsed = Date.now() - started;
	assert.ok(elapsed < 2_000, `should not hang; elapsed=${elapsed}`);
	assert.deepEqual(seen.sort(), ["fable", "opus"]);
	assert.equal(result.findings.length, 1);
	assert.equal(result.findings[0].agentName, "opus");
	assert.ok(result.missing.some((m) => m.agentName === "fable"));
	assert.equal(cleaned, true);
	await assert.rejects(() => access(plan.runDir), /ENOENT/);
	await rm(root, { recursive: true, force: true });
});

test("executeSpawnRun dispatches herdr vs headless and cleans on collect throw", async () => {
	const root = await tempDir("pi-spawn-dispatch-");
	const plan = planSpawnRun({
		config: { ...fixtureConfig, timeoutMs: 100 },
		brief: "dispatch",
		confirmed: true,
		useDefaultSet: true,
		cwd: root,
		herdrEnv: "1",
		background: false,
		runId: "dispatch",
		baseDir: root,
	});
	assert.equal(plan.runtime, "herdr");
	const herdrNames = [];
	let cleaned = false;
	await assert.rejects(
		() =>
			executeSpawnRun(plan, {
				runHerdr: async (launch) => {
					herdrNames.push(launch.agentName);
					throw new Error(`fail-${launch.agentName}`);
				},
				runHeadless: async () => {
					throw new Error("should not use headless");
				},
				awaitAndCollect: async () => {
					throw new Error("collect boom");
				},
				cleanupRunDir: async (dir) => {
					cleaned = true;
					await cleanupRunDir(dir);
				},
			}),
		/collect boom/,
	);
	assert.deepEqual(herdrNames.sort(), ["fable", "opus"]);
	assert.equal(cleaned, true);
	await rm(root, { recursive: true, force: true });
});

test("executeSpawnRun records startErrors when a runner rejects", async () => {
	const root = await tempDir("pi-spawn-starterr-");
	const plan = planSpawnRun({
		config: { ...fixtureConfig, timeoutMs: 60 },
		brief: "errors",
		confirmed: true,
		useDefaultSet: false,
		names: ["opus"],
		cwd: root,
		background: true,
		runId: "err",
		baseDir: root,
	});
	const result = await executeSpawnRun(plan, {
		runHeadless: async () => {
			throw new Error("nope");
		},
	});
	assert.ok(result.startErrors.some((e) => e.agentName === "opus" && /nope/.test(e.error)));
	assert.ok(result.missing.some((m) => m.agentName === "opus"));
	await rm(root, { recursive: true, force: true });
});

test("package.json declares spawn extension and skills", async () => {
	const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "package.json");
	const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
	assert.equal(pkg.name, "@smarzban/pi-spawn");
	assert.deepEqual(pkg.pi.extensions, ["./index.ts"]);
	assert.deepEqual(pkg.pi.skills, ["./skills"]);
});

test("index.ts wires installSpawn to register spawn command and tool", async () => {
	const src = await readFile(join(dirname(fileURLToPath(import.meta.url)), "index.ts"), "utf8");
	assert.match(src, /export function installSpawn/);
	assert.match(src, /pi\.registerCommand\(SPAWN_COMMAND/);
	assert.match(src, /pi\.registerTool\(\{[\s\S]*name:\s*SPAWN_TOOL/);
	assert.match(src, /executeSpawnRun\(plan[\s\S]*signal/);
	assert.match(src, /formatSpawnResult\(result\)/);
	assert.match(src, /export default function/);
});
