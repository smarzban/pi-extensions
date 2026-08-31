# Verification report · pi-spawn

**Branch:** `feat/pi-spawn`
**Head:** pre-PR suite green (`node --test` 45/45, `npm pack --dry-run` ok)
**Green bar:** `cd packages/pi-spawn && node --test && npm pack --dry-run`

## AC → proof map

| Criterion | Type | Proof |
| --- | --- | --- |
| AC-1 | test-backed | resolveAgents expands default set from spawn.json, resolveAgents rejects unknown names, resolveAgents resolves explicit named agents |
| AC-2 | test-backed | assertConfirmed blocks unconfirmed brief, assertConfirmed blocks empty brief even when confirmed, assertConfirmed passes confirmed brief through, planSpawnRun refuses unconfirmed brief before building launches |
| AC-3 | test-backed | chooseRuntime uses herdr when HERDR_ENV=1 and not background, chooseRuntime uses headless outside Herdr, chooseRuntime forces headless when background requested even in Herdr |
| AC-4 | test-backed | buildChildLaunch includes cwd model thinking tools brief timeout and finding path, buildChildLaunch herdr plan names tab and pi kind, buildChildLaunch includes done-ping only for herdr children with a parent pane |
| AC-5 | test-backed | awaitAndCollect returns finished findings and marks missing after timeout, executeSpawnRun times out without waiting forever for hung runner |
| AC-6 | test-backed | cleanupRunDir deletes temp findings after collect, executeSpawnRun cleans run dir when every agent delivered, executeSpawnRun keeps run dir when collect throws |
| AC-7 | test-backed | parseSpawnArgs bare /spawn asks for topic, parseSpawnArgs named agent on this, parseSpawnArgs the agents on this, SPAWN_COMMAND and SPAWN_TOOL names are spawn, installSpawn registers /spawn command and spawn_run tool |
| AC-8 | reviewer-checked | Does skills/spawn/SKILL.md plus package.json pi.skills teach draft → confirm → spawn_run (not manual Herdr)? Yes — skill and package metadata ship that workflow. |
| AC-9 | test-backed | package.json declares spawn extension and skills |
| AC-10 | reviewer-checked | Are editor-model / research-compare modes / non-Pi agents / persisted history / per-agent follow-ups absent from the shipped surface? Yes — only /spawn + spawn_run + named spawn.json agents. |

## Notes

- Owner amended AC-6 (2026-09): keep run dir and Herdr tabs while stragglers are outstanding; children ping the parent pane when late.
- Final suite evidence is in `build-report.md` → `## Final suite (pre-PR)`.
