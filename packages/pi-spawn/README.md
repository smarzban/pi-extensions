# @smarzban/pi-spawn

Fan out one confirmed brief to named Pi agents in parallel, collect findings, and synthesize in the parent chat.

## Install

```bash
pi install npm:@smarzban/pi-spawn
```

Or from this monorepo:

```bash
pi install /absolute/path/to/pi-extensions/packages/pi-spawn
```

Restart pi (or start a new session) so the extension and skill load.

## Config

Create `~/.pi/agent/spawn.json`:

```json
{
  "agents": {
    "opus": { "model": "anthropic/claude-opus-4", "thinking": "high" },
    "fable": { "model": "openai/gpt-5", "thinking": "medium" }
  },
  "defaultSet": ["opus", "fable"],
  "timeoutMs": null
}
```

- **named agents** — stable names bound to model + thinking
- **default set** — used for “the agents”
- **timeoutMs** — `null`/omit = wait until every child finishes (or you cancel). A positive number is only a safety ceiling for hung children.

## Usage

Surfaces:

- `/spawn` — asks what to look into
- `/spawn <name> on this` — named agent on the current topic
- `/spawn the agents on this` — default set on the current topic
- `/spawn status` — list kept partial/cancelled runs and which findings landed
- Natural language via the bundled `spawn` skill

Flow: parent drafts a brief → user confirms in chat → `spawn_run` fans out → waits until all finish → parent synthesizes findings.

Runtime:

- `HERDR_ENV=1` → Herdr tabs
- otherwise headless `pi -p --no-session`
- “background” / “headless” request forces headless even inside Herdr

Children inherit the parent cwd and normal Pi tools and write findings under `~/.pi/agent/spawn-runs/`. Complete runs are cleaned up. Partial/cancelled runs are kept so `/spawn status` can pick up late findings. Children do **not** ping the parent chat.

Herdr spawn tabs are never closed by the extension, on success or failure; the parent assistant inspects missing agents' panes with non-blocking herdr get/read before concluding, and tabs are closed only when you ask. Do not call `herdr_agent wait` on spawn children (it freezes the parent chat).

## Scope (v1)

**In scope:** named agents, chat confirm before fan-out, Herdr/headless runtime, wait-until-all (optional safety timeout), `/spawn status`, bundled skill, parent-in-chat synthesis.

**Non-goals:** editor/optimizer model, research/compare modes, non-Pi agents, parent-pane pings, per-agent follow-up orchestration.

## License

MIT © Saeed Marzban
