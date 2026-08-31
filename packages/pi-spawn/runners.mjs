import { spawn } from "node:child_process";

/**
 * @typedef {{ stdout: string, stderr: string, code: number }} ExecResult
 */

const DEFAULT_KILL_GRACE_MS = 2_000;

function killProcessTree(child, signal) {
	if (!child?.pid) return;
	try {
		if (process.platform !== "win32") {
			process.kill(-child.pid, signal);
			return;
		}
	} catch {
		/* fall through to direct kill */
	}
	try {
		child.kill(signal);
	} catch {
		/* already dead */
	}
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{
 *   cwd?: string,
 *   env?: NodeJS.ProcessEnv,
 *   timeoutMs?: number,
 *   signal?: AbortSignal,
 *   killGraceMs?: number,
 * }} [options]
 * @returns {Promise<ExecResult>}
 */
export function runCommand(command, args, options = {}) {
	return new Promise((resolve, reject) => {
		if (options.signal?.aborted) {
			reject(new Error(`${command} aborted`));
			return;
		}
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: options.env ?? process.env,
			stdio: ["ignore", "pipe", "pipe"],
			detached: process.platform !== "win32",
		});
		let stdout = "";
		let stderr = "";
		let settled = false;
		let stopping = false;
		let stopReason = "";
		let killEscalation;
		let hardDeadline;
		const graceMs =
			Number.isFinite(options.killGraceMs) && options.killGraceMs >= 0
				? options.killGraceMs
				: DEFAULT_KILL_GRACE_MS;

		const finish = (fn) => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			if (killEscalation) clearTimeout(killEscalation);
			if (hardDeadline) clearTimeout(hardDeadline);
			options.signal?.removeEventListener("abort", onAbort);
			fn();
		};

		const forceStop = (reason) => {
			if (settled || stopping) return;
			stopping = true;
			stopReason = reason;
			killProcessTree(child, "SIGTERM");
			killEscalation = setTimeout(() => {
				killProcessTree(child, "SIGKILL");
			}, graceMs);
			// If the process ignores both signals, still settle so callers are not stuck.
			hardDeadline = setTimeout(() => {
				finish(() => reject(new Error(stopReason)));
			}, graceMs * 2 + 50);
		};

		const timer =
			options.timeoutMs && options.timeoutMs > 0
				? setTimeout(() => {
						forceStop(`${command} timed out after ${options.timeoutMs}ms`);
					}, options.timeoutMs)
				: undefined;

		const onAbort = () => {
			forceStop(`${command} aborted`);
		};
		options.signal?.addEventListener("abort", onAbort, { once: true });
		child.stdout.on("data", (chunk) => {
			stdout += String(chunk);
		});
		child.stderr.on("data", (chunk) => {
			stderr += String(chunk);
		});
		child.on("error", (err) => {
			finish(() => reject(err));
		});
		child.on("close", (code) => {
			if (stopping) {
				finish(() => reject(new Error(stopReason)));
				return;
			}
			finish(() => resolve({ stdout, stderr, code: code ?? 1 }));
		});
	});
}

function parseJsonLine(stdout) {
	const line = stdout
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean)
		.at(-1);
	if (!line) throw new Error("expected JSON from herdr");
	return JSON.parse(line);
}

export async function defaultRunHeadless(launch, opts = {}) {
	const [cmd, ...args] = launch.argv;
	const run = opts.runCommand ?? runCommand;
	const timeoutMs = opts.timeoutMs ?? launch.timeoutMs;
	return run(cmd, args, {
		cwd: launch.cwd,
		...(timeoutMs != null ? { timeoutMs } : {}),
		signal: opts.signal,
	});
}

const DEFAULT_START_RETRY_MS = 200;
const DEFAULT_START_BUDGET_MS = 60_000;

function isAgentPaneBusy(stderr = "", stdout = "") {
	const text = `${stderr}\n${stdout}`;
	return text.includes("agent_pane_busy") || /not an available shell/i.test(text);
}

function sleep(ms, signal, sleepFn) {
	if (signal?.aborted) return Promise.reject(new Error("herdr aborted"));
	if (sleepFn) return Promise.resolve(sleepFn(ms));
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(new Error("herdr aborted"));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

/**
 * Start a Herdr agent in a freshly created tab, retrying when Herdr reports the
 * pane is not yet an available shell (common under parallel tab create).
 */
export async function startHerdrAgentWithRetry(launch, paneId, opts = {}) {
	const run = opts.runCommand ?? runCommand;
	const timeoutMs = opts.timeoutMs ?? launch.herdr.timeoutMs ?? launch.timeoutMs;
	const budgetMs =
		Number.isFinite(opts.startBudgetMs) && opts.startBudgetMs > 0
			? opts.startBudgetMs
			: Number.isFinite(timeoutMs) && timeoutMs > 0
				? Math.min(timeoutMs, DEFAULT_START_BUDGET_MS)
				: DEFAULT_START_BUDGET_MS;
	const retryMs =
		Number.isFinite(opts.startRetryMs) && opts.startRetryMs >= 0
			? opts.startRetryMs
			: DEFAULT_START_RETRY_MS;
	const startedAt = Date.now();
	let lastErr = "";
	let attempts = 0;

	while (Date.now() - startedAt < budgetMs) {
		if (opts.signal?.aborted) throw new Error("herdr agent start aborted");
		attempts += 1;
		const remaining = Math.max(1_000, budgetMs - (Date.now() - startedAt));
		const started = await run(
			"herdr",
			[
				"agent",
				"start",
				launch.herdr.agentLabel,
				"--kind",
				launch.herdr.kind,
				"--pane",
				paneId,
				"--timeout",
				String(Math.min(remaining, 30_000)),
				"--",
				...launch.herdr.agentArgs,
			],
			{ timeoutMs: Math.min(remaining + 5_000, 60_000), signal: opts.signal },
		);
		if (started.code === 0) {
			const payload = parseJsonLine(started.stdout);
			const agent = payload?.result?.agent?.agent ?? payload?.result?.agent;
			const detected =
				typeof agent === "string"
					? agent
					: agent && typeof agent === "object"
						? agent.agent
						: undefined;
			if (!detected) {
				throw new Error(
					`herdr agent start returned success but no agent was detected in pane ${paneId}`,
				);
			}
			return { attempts, agent: detected, raw: payload };
		}

		lastErr = started.stderr || started.stdout || `exit ${started.code}`;
		if (!isAgentPaneBusy(started.stderr, started.stdout)) {
			throw new Error(`herdr agent start failed: ${lastErr}`);
		}
		await sleep(retryMs, opts.signal, opts.sleep);
	}

	throw new Error(
		`herdr agent start failed after ${attempts} attempt(s): pane ${paneId} never became an available shell (${lastErr})`,
	);
}

export async function defaultRunHerdr(launch, opts = {}) {
	const timeoutMs = opts.timeoutMs ?? launch.herdr.timeoutMs ?? launch.timeoutMs;
	const run = opts.runCommand ?? runCommand;
	// Spawn tabs are never closed here, on success or failure: they are the
	// user's visibility surface. Closing is a user decision in the parent chat.
	const created = await run(
		"herdr",
		["tab", "create", "--no-focus", "--cwd", launch.cwd, "--label", launch.herdr.tabLabel],
		{
			timeoutMs: timeoutMs != null ? Math.min(timeoutMs, 60_000) : 60_000,
			signal: opts.signal,
		},
	);
	if (created.code !== 0) {
		throw new Error(`herdr tab create failed: ${created.stderr || created.stdout}`);
	}
	const payload = parseJsonLine(created.stdout);
	const paneId = payload?.result?.root_pane?.pane_id;
	const tabId = payload?.result?.tab?.tab_id ?? payload?.result?.root_pane?.tab_id;
	if (!paneId) throw new Error("herdr tab create did not return pane_id");
	// Record pane/tab as soon as the tab exists so the parent can inspect
	// stragglers even if start later fails.
	opts.onStarted?.({ paneId, tabId });

	const started = await startHerdrAgentWithRetry(launch, paneId, opts);
	opts.onAgentRunning?.({ paneId, tabId, agent: started.agent, attempts: started.attempts });

	const promptArgs = ["agent", "prompt", paneId, launch.herdr.prompt, "--wait", "--until", "done", "--until", "idle"];
	if (timeoutMs != null) {
		promptArgs.push("--timeout", String(timeoutMs));
	}
	const prompted = await run("herdr", promptArgs, {
		...(timeoutMs != null ? { timeoutMs: timeoutMs + 5_000 } : {}),
		signal: opts.signal,
	});
	if (prompted.code !== 0) {
		throw new Error(`herdr agent prompt failed: ${prompted.stderr || prompted.stdout}`);
	}
	return { paneId, tabId, agent: started.agent, startAttempts: started.attempts };
}

