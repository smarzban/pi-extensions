## Brief

### Problem / intent

When deciding how to research or implement something, the user wants several named Pi agents (different models/thinking levels) to work the same brief in parallel, then get one synthesized answer back in the parent chat. Today that means manually opening Herdr tabs, picking models, copy-pasting prompts, and stitching answers by hand.

### Scope & non-goals

**In scope (v1)**
- New package `@smarzban/pi-spawn` in this monorepo (`packages/pi-spawn`)
- Named agents + default set in `~/.pi/agent/spawn.json`
- Parent session drafts the brief from conversation, presents it, and asks to spawn (chat confirm: yes / edit / cancel)
- Surfaces: `/spawn`, `/spawn <name> on this`, `/spawn the agents on this`, bare `/spawn` (asks what to look into), plus natural language via a bundled skill
- Fan-out: one agent per target; Herdr tabs when `HERDR_ENV=1`, else headless Pi; explicit “background/headless” forces headless even in Herdr
- Children inherit parent cwd, get normal Pi tools, write findings to a temp dir
- Parent waits (configurable timeout), synthesizes from finished findings in-chat, marks missing/failed agents; temp findings deleted after report

**Non-goals (v1)**
- Separate editor/optimizer model
- Research/compare/design modes or prompt templates
- Auto-merging into committed project docs
- Non-Pi agents (Claude/Codex/etc.)
- Persisted run history
- Per-agent follow-ups or “implement the chosen approach” orchestration

### Chosen approach

One package with an extension (command + tools) and a bundled skill. The **parent** owns prompt drafting, confirmation, waiting, and synthesis. Child agents only answer the confirmed brief and write a finding file. Display surface is Herdr when available, headless otherwise. Collect via temp files, not TUI scraping.

**Over alternatives**
- Tab-only with no report: user already wants collect + synthesize
- Dedicated synthesizer agent: extra hop; parent already has the conversation context
- Modes (`research`/`compare`): dropped; the confirmed brief carries intent
- Persisted run dirs: user prefers ephemeral temp findings

### Resolved key decisions

| Decision | Choice |
|---|---|
| Package | `@smarzban/pi-spawn` in `packages/pi-spawn` |
| Config | `~/.pi/agent/spawn.json` (named agents + default set + timeout) |
| Prompt drafting | Parent session only; always confirm in chat before spawn |
| Modes | None in v1 |
| “on this” | Parent’s short current-topic summary |
| Skill | Bundled in the package |
| Runtime | Herdr tabs if `HERDR_ENV=1`, else headless; background request → headless |
| Cwd | Parent session cwd |
| Child tools | Full normal Pi tools |
| Failure | Wait until timeout; synthesize partial; mark missing/failed; parent inspects stragglers' panes via herdr tools before concluding |
| Findings | Temp dir per run; deleted only when every agent delivered, kept while stragglers are outstanding so late findings can land |
| Tab lifecycle | Spawn tabs are never closed by the extension (success or failure); closing is a user decision |
| Straggler pings | Herdr children get the parent pane id and ping `spawn-ping: <agent> done` when they finish late |
| Synthesis | Parent in-chat |

### Glossary terms touched

See root `CONTEXT.md`: named agent, default set, brief, spawn run, finding, headless spawn.

### ADRs

None. Decisions are reversible product choices for a new package, not surprising hard-to-reverse platform bets.

## Acceptance Criteria
<!-- source: prompt + settled Brief · ingested 2026-08-31 -->

### AC-1 · Named agents load from spawn.json
Given `~/.pi/agent/spawn.json` defines named agents and a default set, when spawn resolves targets, then unknown names are rejected and “the agents” expands to the default set.
*Verification:* test-backed (unit)

### AC-2 · Brief confirm is required before fan-out
Given a spawn request with a draft brief, when the user has not confirmed, then no child agents are started; after explicit confirm, fan-out may proceed with that brief text.
*Verification:* test-backed (unit)

### AC-3 · Runtime surface follows Herdr / headless rules
Given `HERDR_ENV=1` and no background request, when a run starts, children use Herdr tabs; outside Herdr, or when background/headless is requested, children run headless Pi.
*Verification:* test-backed (unit)

### AC-4 · Children share parent cwd, full tools, same brief
Given a confirmed spawn run, when children start, each gets the parent cwd, normal Pi tools, its configured model+thinking, and the same confirmed brief, and is instructed to write a finding file.
*Verification:* test-backed (unit)

### AC-5 · Partial collect after timeout
Given a run with a timeout, when the timeout elapses, finished findings are returned, missing/failed agents are marked, and the run does not wait forever.
*Verification:* test-backed (unit)

### AC-6 · Temp findings cleaned after full collect
Given findings written under a temp run dir, when collect completes with every agent delivered, that temp dir is deleted and no persisted run history remains under the agent dir. When agents are still outstanding (timeout or collect failure), the run dir is kept so late findings can land.
*Verification:* test-backed (unit)
<!-- amended 2026-09: owner decided partial runs keep the dir; tabs never auto-close; children ping the parent pane when late -->

### AC-7 · /spawn command surfaces
Given the extension is loaded, `/spawn`, `/spawn <name> on this`, `/spawn the agents on this`, and bare `/spawn` are registered and parse into the spawn tool flow (ask for topic when bare).
*Verification:* test-backed (unit)

### AC-8 · Bundled skill teaches natural-language spawn
Given the package is installed, a skill is discoverable that tells the parent to draft → confirm → call spawn tools, not improvise Herdr manually.
*Verification:* reviewer-checked (Spec Conformance) — pass if `skills/` + `pi.skills` ship the spawn skill with that workflow. Hard to unit-assert skill prose quality cheaply.

### AC-9 · Package is installable in this monorepo
Given `packages/pi-spawn`, when listed in root package table/`pi.extensions` and packed, `npm pack --dry-run` succeeds and package metadata matches `@smarzban/pi-spawn`.
*Verification:* test-backed (manual/pack) — pack dry-run in task green bar

### AC-10 · Non-goals stay out
Given v1 scope, the package does not implement editor-model optimization, research/compare modes, non-Pi agents, or persisted run history.
*Verification:* reviewer-checked (Spec Conformance) — pass if those surfaces are absent from commands/config/docs.

### Verification map

| AC | Oracle |
|---|---|
| AC-1 | unit: resolveAgents |
| AC-2 | unit: confirm gate |
| AC-3 | unit: chooseRuntime |
| AC-4 | unit: child launch args / prompt |
| AC-5 | unit: await/collect timeout |
| AC-6 | unit: temp cleanup |
| AC-7 | unit: parseSpawnArgs |
| AC-8 | reviewer: skill present + workflow |
| AC-9 | pack dry-run |
| AC-10 | reviewer: no out-of-scope surfaces |

## Plan
<!-- source: prompt + settled Brief · ingested 2026-08-31 -->

Green bar for this package: `cd packages/pi-spawn && node --test && npm pack --dry-run`

### T-1 · Config + target resolution
*Advances:* AC-1
*Component:* none
*Deps:* none
*Files:* `packages/pi-spawn/package.json`, `packages/pi-spawn/LICENSE`, `packages/pi-spawn/core.mjs`, `packages/pi-spawn/core.test.mjs`
*Test first:* `resolveAgents` rejects unknown names and expands default set from a fixture `spawn.json`
*Do:* scaffold package metadata; implement load/validate `spawn.json` and resolve named agents / default set.

### T-2 · Brief confirm + arg parsing
*Advances:* AC-2, AC-7
*Component:* none
*Deps:* T-1
*Files:* `packages/pi-spawn/core.mjs`, `packages/pi-spawn/core.test.mjs`
*Test first:* `parseSpawnArgs` + `assertConfirmed` — bare `/spawn` asks; unconfirmed brief blocks start; confirmed brief passes through
*Do:* parse `/spawn`, `/spawn <name> on this`, `/spawn the agents on this`, bare `/spawn`; enforce confirm-before-start.

### T-3 · Runtime choice + child launch plan
*Advances:* AC-3, AC-4
*Component:* none
*Deps:* T-1, T-2
*Files:* `packages/pi-spawn/core.mjs`, `packages/pi-spawn/core.test.mjs`
*Test first:* `chooseRuntime` Herdr vs headless; `buildChildLaunch` includes cwd, model, thinking, tools, brief, finding path
*Do:* pure helpers for runtime selection and per-child launch descriptors (no live Herdr required in unit tests).

### T-4 · Await / collect / cleanup
*Advances:* AC-5, AC-6
*Component:* none
*Deps:* T-3
*Files:* `packages/pi-spawn/core.mjs`, `packages/pi-spawn/core.test.mjs`
*Test first:* collect returns finished findings + missing markers after timeout; temp run dir removed afterward
*Do:* temp run dir lifecycle, wait-with-timeout, partial results, cleanup.

### T-5 · Extension command + tools + skill + monorepo wiring
*Advances:* AC-7, AC-8, AC-9, AC-10
*Component:* none
*Deps:* T-1..T-4
*Files:* `packages/pi-spawn/index.ts`, `packages/pi-spawn/skills/spawn/SKILL.md`, `packages/pi-spawn/README.md`, `packages/pi-spawn/package.json`, root `package.json`, root `README.md`
*Test first:* pack dry-run lists skill + extension entry; unit smoke that command registration names include `spawn` via exported parser/help strings if needed
*Do:* register `/spawn` + spawn tools wrapping core; ship skill; wire monorepo listing; README documents v1 scope and non-goals.

### Task-to-criterion coverage

| AC | Tasks |
|---|---|
| AC-1 | T-1 |
| AC-2 | T-2 |
| AC-3 | T-3 |
| AC-4 | T-3 |
| AC-5 | T-4 |
| AC-6 | T-4 |
| AC-7 | T-2, T-5 |
| AC-8 | T-5 |
| AC-9 | T-5 |
| AC-10 | T-5 |
