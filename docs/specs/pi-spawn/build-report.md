# Build report · pi-spawn

**Branch:** `feat/pi-spawn`  
**Tier:** light (no per-task reviewer)  
**Green bar:** `cd packages/pi-spawn && node --test && npm pack --dry-run`

## Task ledger

| Task | Status | Commit | AC advanced | Notes |
|------|--------|--------|-------------|-------|
| T-1 | done | `8a7af58` | AC-1 | Config load + resolveAgents |
| T-2 | done | `83c7005` | AC-2, AC-7 | parseSpawnArgs + assertConfirmed |
| T-3 | done | `c6780ed` | AC-3, AC-4 | chooseRuntime + buildChildLaunch |
| T-4 | done | `767283f` | AC-5, AC-6 | await/collect/cleanup |
| T-5 | done | `ce9f0cf` | AC-7, AC-8, AC-9, AC-10 | extension + skill + monorepo wiring |

## Deviations

None.

### T-1 (@ `8a7af58`)

```
$ cd packages/pi-spawn && node --test; echo test_rc=$?
✔ resolveAgents expands default set from spawn.json
✔ resolveAgents rejects unknown names
✔ resolveAgents resolves explicit named agents
ℹ tests 3 / pass 3 / fail 0
test_rc=0

$ cd packages/pi-spawn && npm pack --dry-run; echo pack_rc=$?
npm notice name: @smarzban/pi-spawn
npm notice version: 0.1.0
npm notice total files: 3
pack_rc=0
```

### T-2 (@ `83c7005`)

```
$ cd packages/pi-spawn && node --test; echo test_rc=$?
✔ resolveAgents expands default set from spawn.json
✔ resolveAgents rejects unknown names
✔ resolveAgents resolves explicit named agents
✔ parseSpawnArgs bare /spawn asks for topic
✔ parseSpawnArgs named agent on this
✔ parseSpawnArgs the agents on this
✔ parseSpawnArgs background forces headless request flag
✔ assertConfirmed blocks unconfirmed brief
✔ assertConfirmed blocks empty brief even when confirmed
✔ assertConfirmed passes confirmed brief through
ℹ tests 10 / pass 10 / fail 0
test_rc=0

$ cd packages/pi-spawn && npm pack --dry-run; echo pack_rc=$?
npm notice name: @smarzban/pi-spawn
pack_rc=0
```

### T-3 (@ `c6780ed`)

```
$ cd packages/pi-spawn && node --test; echo test_rc=$?
✔ chooseRuntime uses herdr when HERDR_ENV=1 and not background
✔ chooseRuntime uses headless outside Herdr
✔ chooseRuntime forces headless when background requested even in Herdr
✔ buildChildLaunch includes cwd model thinking tools brief and finding path
✔ buildChildLaunch herdr plan names tab and pi kind
ℹ tests 15 / pass 15 / fail 0
test_rc=0

$ cd packages/pi-spawn && npm pack --dry-run; echo pack_rc=$?
npm notice name: @smarzban/pi-spawn
pack_rc=0
```

### T-4 (@ `767283f`)

```
$ cd packages/pi-spawn && node --test; echo test_rc=$?
✔ awaitAndCollect returns finished findings and marks missing after timeout
✔ cleanupRunDir deletes temp findings after collect
ℹ tests 17 / pass 17 / fail 0
test_rc=0

$ cd packages/pi-spawn && npm pack --dry-run; echo pack_rc=$?
npm notice name: @smarzban/pi-spawn
pack_rc=0
```

### T-5 (@ `ce9f0cf`)

```
$ cd packages/pi-spawn && node --test; echo test_rc=$?
✔ SPAWN_COMMAND and SPAWN_TOOL names are spawn
✔ planSpawnRun refuses unconfirmed brief before building launches
✔ planSpawnRun builds launches for default set when confirmed
✔ package.json declares spawn extension and skills
ℹ tests 21 / pass 21 / fail 0
test_rc=0

$ cd packages/pi-spawn && npm pack --dry-run; echo pack_rc=$?
npm notice name: @smarzban/pi-spawn
npm notice 8.2kB index.ts
npm notice 1.8kB skills/spawn/SKILL.md
npm notice total files: 6
pack_rc=0
```

### T-5 (@ `bba143c`)

Pre-PR full suite (post-review fixes + owner amendments).

```
$ cd packages/pi-spawn && node --test; echo test_rc=$?
✔ resolveAgents expands default set from spawn.json (5.436875ms)
✔ resolveAgents rejects unknown names (1.870584ms)
✔ resolveAgents resolves explicit named agents (0.1535ms)
✔ validateSpawnConfig rejects bad shapes (0.30775ms)
✔ loadSpawnConfig rejects invalid JSON (1.618875ms)
✔ parseSpawnArgs bare /spawn asks for topic (0.133125ms)
✔ parseSpawnArgs named agent on this (0.288375ms)
✔ parseSpawnArgs the agents on this (0.142417ms)
✔ parseSpawnArgs background forces headless request flag (0.054458ms)
✔ assertConfirmed blocks unconfirmed brief (0.231208ms)
✔ assertConfirmed blocks empty brief even when confirmed (0.18025ms)
✔ assertConfirmed passes confirmed brief through (0.055875ms)
✔ chooseRuntime uses herdr when HERDR_ENV=1 and not background (0.037708ms)
✔ chooseRuntime uses headless outside Herdr (0.026375ms)
✔ chooseRuntime forces headless when background requested even in Herdr (0.021292ms)
✔ buildChildLaunch includes cwd model thinking tools brief timeout and finding path (0.212583ms)
✔ buildChildLaunch herdr plan names tab and pi kind (0.138417ms)
✔ sanitizeHerdrAgentName produces valid herdr agent names (0.151167ms)
✔ buildChildLaunch sanitizes herdr agentLabel but keeps agentName (0.055084ms)
✔ awaitAndCollect returns finished findings and marks missing after timeout (56.70275ms)
✔ awaitAndCollect exits early when all findings present (1.866375ms)
✔ awaitAndCollect marks settled child without finding immediately (0.677709ms)
✔ readFindingFile rejects FIFO paths (4.005166ms)
✔ readFindingFile rejects symlink findings (0.894417ms)
✔ cleanupRunDir deletes temp findings after collect (0.984541ms)
✔ createRunDir uses private mode 0700 (0.662291ms)
✔ SPAWN_COMMAND and SPAWN_TOOL names are spawn (0.040542ms)
✔ planSpawnRun refuses unconfirmed brief before building launches (0.101833ms)
✔ planSpawnRun builds launches for default set when confirmed (0.082792ms)
✔ planSpawnRun named agent does not expand default set (0.049375ms)
✔ planSpawnRun rejects unknown named agent (0.053583ms)
✔ formatSpawnResult fences findings and marks missing (0.129208ms)
✔ executeSpawnRun times out without waiting forever for hung runner (84.032042ms)
✔ executeSpawnRun cleans run dir when every agent delivered (14.020333ms)
✔ executeSpawnRun threads pane info from onStarted into result.panes (104.146209ms)
✔ executeSpawnRun keeps run dir when collect throws (2.331709ms)
✔ buildChildLaunch includes done-ping only for herdr children with a parent pane (0.272917ms)
✔ executeSpawnRun records startErrors when a runner rejects (65.25825ms)
✔ awaitAndCollect ignores in-progress finding until child is settled (51.476167ms)
✔ awaitAndCollect does not accept partial finding on timeout while unsettled (45.565959ms)
✔ readFindingFile classifies read failures instead of throwing (0.69725ms)
✔ runCommand escalates SIGTERM to SIGKILL and waits for close (87.744792ms)
✔ package.json declares spawn extension and skills (0.396459ms)
✔ installSpawn registers /spawn command and spawn_run tool (259.512625ms)
✔ index.ts wires installSpawn to register spawn command and tool (2.755292ms)
ℹ tests 45
ℹ suites 0
ℹ pass 45
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 858.722291
test_rc=0

$ cd packages/pi-spawn && npm pack --dry-run; echo pack_rc=$?
npm notice
npm notice 📦  @smarzban/pi-spawn@0.1.0
npm notice Tarball Contents
npm notice 1.1kB LICENSE
npm notice 2.2kB README.md
npm notice 23.3kB core.mjs
npm notice 2.0kB index.ts
npm notice 5.5kB install.mjs
npm notice 990B package.json
npm notice 5.0kB runners.mjs
npm notice 2.5kB skills/spawn/SKILL.md
npm notice Tarball Details
npm notice name: @smarzban/pi-spawn
npm notice version: 0.1.0
npm notice filename: smarzban-pi-spawn-0.1.0.tgz
npm notice package size: 13.4 kB
npm notice unpacked size: 42.6 kB
npm notice shasum: 6c6d7fbe0be48eb9faf52a2a3c02fddee25d0592
npm notice integrity: sha512-JifORunGbbunM[...]wAm4oURengxOg==
npm notice total files: 8
npm notice
smarzban-pi-spawn-0.1.0.tgz
pack_rc=0
```
