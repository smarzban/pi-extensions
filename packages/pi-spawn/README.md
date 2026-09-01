# @smarzban/pi-spawn

**Give Pi one question, have it send the same confirmed brief to several named models in parallel, then get one synthesized answer back in your conversation.**

`pi-spawn` is a Pi extension for work where a second or third opinion helps: researching an unfamiliar codebase, comparing implementation approaches, reviewing a design, or pressure-testing a plan. You choose the model aliases once, then ask Pi to fan a brief out when you need them.

- **Named model team:** map memorable names such as `fable`, `sol`, and `kimi` to the models and thinking levels you want.
- **Confirm before spend:** Pi drafts the brief and waits for your explicit yes before it starts any children.
- **One parent conversation:** child findings return to the parent, which compares and synthesizes them for you.
- **Visible when using Herdr:** each child gets its own named tab. Outside Herdr, children run headlessly.
- **No guessed finish time:** by default, Pi waits until every child finishes. You can optionally set a safety ceiling.

## What it feels like

You are weighing how to implement a feature and want independent views:

```text
You: /spawn

Pi: What should the agents look into?

You: Should we use human-readable task IDs, and should they be global or project-scoped?

Pi: Draft brief
    Investigate a human-readable task-ID scheme. Compare global and
    project-scoped identifiers, migration implications, collision handling,
    and a recommended default. Return a concise rationale.

    Spawn fable, sol, and kimi? (yes / edit / cancel)

You: yes

Pi: Starts the three agents, waits for them, then synthesizes their findings
    into one recommendation with disagreements called out.
```

The agents receive the **same** brief. `pi-spawn` is for parallel perspectives on one problem, not a task queue or a chain of delegated implementation work.

## Quickstart

Install the package, create your named-agent configuration, then reload Pi:

```bash
pi install npm:@smarzban/pi-spawn
mkdir -p ~/.pi/agent
```

Create `~/.pi/agent/spawn.json`:

```json
{
  "agents": {
    "fable": { "model": "anthropic/claude-fable-5", "thinking": "high" },
    "sol": { "model": "openai-codex/gpt-5.6-sol", "thinking": "high" },
    "kimi": { "model": "opencode-go/kimi-k3", "thinking": "high" }
  },
  "defaultSet": ["fable", "sol", "kimi"],
  "timeoutMs": null
}
```

Run `/reload` or start a new Pi session. Then use `/spawn`, describe what you want investigated, and approve Pi's draft brief.

> The model identifiers are examples. Use models available in your Pi setup.

## Ways to start a spawn

| You say | What Pi does |
| --- | --- |
| `/spawn` | Asks what the agents should investigate, then drafts a brief for confirmation. |
| `/spawn the agents on this` | Drafts a brief from the current conversation and uses `defaultSet`. |
| `/spawn fable on this` | Drafts a brief from the current conversation for only `fable`. |
| `/spawn background the agents on this` | Uses the default set headlessly, even in a Herdr session. |
| “Spawn the agents to investigate …” | The bundled `spawn` skill follows the same draft → confirm → run flow. |
| `/spawn status` | Shows partial or cancelled runs retained for later inspection. |

A current-topic command still asks for confirmation. Nothing starts until you approve the displayed brief.

## What happens after you confirm

```text
confirmed brief
      │
      ├── fable ──┐
      ├── sol ────┼── finding files ──> parent Pi ──> synthesized answer
      └── kimi ──┘
```

1. Pi resolves the requested aliases from `spawn.json`.
2. It starts one child per alias with the same brief and the parent working directory.
3. Each child researches or implements using normal Pi tools, then writes a Markdown finding.
4. `spawn_run` waits until every child has finished, then returns all findings to the parent.
5. The parent compares them and answers you. Findings are treated as untrusted child data, not instructions.

With `HERDR_ENV=1`, children appear in `spawn:<name>` tabs. Otherwise they run with headless `pi -p --no-session`. Spawn tabs are never closed automatically.

## Configuration

`~/.pi/agent/spawn.json` contains no secrets. It is just the named team Pi can select.

| Field | Meaning |
| --- | --- |
| `agents` | Object mapping a stable alias to `model` and optional `thinking` level. |
| `defaultSet` | Non-empty list of configured aliases used by “the agents”. |
| `timeoutMs` | `null` or omitted waits until every child completes (or you cancel). A positive number is a safety ceiling for a stuck child, not the expected duration. |

Supported `thinking` values: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`.

## Partial runs and status

A completed run is cleaned up. If you cancel a run or its safety ceiling is reached, its directory is retained under `~/.pi/agent/spawn-runs/` so findings that land later are not lost.

Use `/spawn status` to see which agents delivered and where their finding files live. For a still-running Herdr child, inspect it with non-blocking `herdr_agent get` or `herdr_agent read`. Do **not** call `herdr_agent wait` from the parent conversation: it blocks the chat.

## What this is not

- It does not start agents without an explicit confirmation.
- It does not choose an editor or “best” model for you.
- It does not run a parent-pane ping when a child completes.
- It does not close your Herdr spawn tabs.
- It does not orchestrate follow-up conversations with individual children.

## Local development

From this monorepo:

```bash
pi install /absolute/path/to/pi-extensions/packages/pi-spawn
cd /absolute/path/to/pi-extensions/packages/pi-spawn && npm test
```

## License

MIT © Saeed Marzban
