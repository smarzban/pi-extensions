import { join } from "node:path";
import { Type } from "typebox";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SPAWN_COMMAND, SPAWN_TOOL, SPAWN_FOLLOW_UP_TOOL, formatSpawnResult } from "./core.mjs";
import { installSpawn as installSpawnCore } from "./install.mjs";
import { defaultRunHeadless, defaultRunHerdr, defaultRunHerdrFollowUp, runCommand } from "./runners.mjs";

export { formatSpawnResult, SPAWN_COMMAND, SPAWN_TOOL, SPAWN_FOLLOW_UP_TOOL };
export { runCommand, defaultRunHeadless, defaultRunHerdr, defaultRunHerdrFollowUp };
export { installSpawn as installSpawnCore } from "./install.mjs";

export type InstallSpawnDeps = {
	configPath?: string;
	runHeadless?: typeof defaultRunHeadless;
	runHerdr?: typeof defaultRunHerdr;
	runHerdrFollowUp?: typeof defaultRunHerdrFollowUp;
	baseDir?: string;
	getCwd?: (ctx: { cwd: string }) => string;
	getHerdrEnv?: () => string | undefined;
};

/**
 * Register /spawn and spawn_run. Exported for unit tests with injectable deps.
 */
export function installSpawn(pi: ExtensionAPI, deps: InstallSpawnDeps = {}) {
	installSpawnCore(pi, {
		configPath: deps.configPath ?? join(getAgentDir(), "spawn.json"),
		runHeadless: deps.runHeadless ?? defaultRunHeadless,
		runHerdr: deps.runHerdr ?? defaultRunHerdr,
		runHerdrFollowUp: deps.runHerdrFollowUp ?? defaultRunHerdrFollowUp,
		baseDir: deps.baseDir ?? join(getAgentDir(), "spawn-runs"),
		getCwd: deps.getCwd,
		getHerdrEnv: deps.getHerdrEnv,
		followUpParameters: Type.Object({
			question: Type.String({ description: "Question sent to the existing spawned agents" }),
			names: Type.Optional(Type.Array(Type.String(), { description: "Optional subset of prior agents" })),
			runId: Type.Optional(Type.String({ description: "Prior Herdr spawn run ID; omit for most recent" })),
		}),
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
	});
}

export default function (pi: ExtensionAPI) {
	installSpawn(pi);
}
