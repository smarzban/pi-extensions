import { spawn } from "node:child_process";

/**
 * @typedef {{ stdout: string, stderr: string, code: number }} ExecResult
 */

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, timeoutMs?: number, signal?: AbortSignal }} [options]
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
		});
		let stdout = "";
		let stderr = "";
		let settled = false;
		const finish = (fn) => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			options.signal?.removeEventListener("abort", onAbort);
			fn();
		};
		const timer =
			options.timeoutMs && options.timeoutMs > 0
				? setTimeout(() => {
						child.kill("SIGTERM");
						finish(() =>
							reject(new Error(`${command} timed out after ${options.timeoutMs}ms`)),
						);
					}, options.timeoutMs)
				: undefined;
		const onAbort = () => {
			child.kill("SIGTERM");
			finish(() => reject(new Error(`${command} aborted`)));
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
