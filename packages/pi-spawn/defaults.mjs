import { defaultRunHeadless, defaultRunHerdr, defaultRunHerdrFollowUp } from "./runners.mjs";

/** Apply the package's production runners while preserving test overrides. */
export function resolveSpawnRunners(deps = {}) {
	return {
		runHeadless: deps.runHeadless ?? defaultRunHeadless,
		runHerdr: deps.runHerdr ?? defaultRunHerdr,
		runHerdrFollowUp: deps.runHerdrFollowUp ?? defaultRunHerdrFollowUp,
	};
}
