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
	return runCommand(cmd, args, {
		cwd: launch.cwd,
		timeoutMs: opts.timeoutMs ?? launch.timeoutMs,
		signal: opts.signal,
	});
}

export async function defaultRunHerdr(launch, opts = {}) {
	const timeoutMs = opts.timeoutMs ?? launch.herdr.timeoutMs ?? launch.timeoutMs ?? 300_000;
	let paneId;
	try {
		const created = await runCommand(
			"herdr",
			["tab", "create", "--no-focus", "--cwd", launch.cwd, "--label", launch.herdr.tabLabel],
			{ timeoutMs: Math.min(timeoutMs, 60_000), signal: opts.signal },
		);
		if (created.code !== 0) {
			throw new Error(`herdr tab create failed: ${created.stderr || created.stdout}`);
		}
		const payload = parseJsonLine(created.stdout);
		paneId = payload?.result?.root_pane?.pane_id;
		if (!paneId) throw new Error("herdr tab create did not return pane_id");

		const started = await runCommand(
			"herdr",
			[
				"agent",
				"start",
				launch.herdr.agentLabel,
				"--kind",
				launch.herdr.kind,
				"--pane",
				paneId,
				"--",
				...launch.herdr.agentArgs,
			],
			{ timeoutMs: Math.min(timeoutMs, 60_000), signal: opts.signal },
		);
		if (started.code !== 0) {
			throw new Error(`herdr agent start failed: ${started.stderr || started.stdout}`);
		}

		const prompted = await runCommand(
			"herdr",
			[
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
				String(timeoutMs),
			],
			{ timeoutMs: timeoutMs + 5_000, signal: opts.signal },
		);
		if (prompted.code !== 0) {
			throw new Error(`herdr agent prompt failed: ${prompted.stderr || prompted.stdout}`);
		}
		return { paneId };
	} catch (err) {
		if (paneId) {
			try {
				await runCommand("herdr", ["tab", "close", paneId], { timeoutMs: 15_000 });
			} catch {
				/* best-effort cleanup */
			}
		}
		throw err;
	}
}
