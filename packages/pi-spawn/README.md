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
  "timeoutMs": 300000
}
```

- **named agents** — stable names bound to model + thinking
- **default set** — used for “the agents”
- **timeoutMs** — wait budget before partial collect

## Usage

Surfaces:

- `/spawn` — asks what to look into
- `/spawn <name> on this` — named agent on the current topic
- `/spawn the agents on this` — default set on the current topic
- Natural language via the bundled `spawn` skill

Flow: parent drafts a brief → user confirms in chat → `spawn_run` fans out → parent synthesizes findings.

Runtime:

- `HERDR_ENV=1` → Herdr tabs
- otherwise headless `pi -p --no-session`
- “background” / “headless” request forces headless even inside Herdr

Children inherit the parent cwd and normal Pi tools, write a finding to a temp path, and that temp run dir is deleted after collect.

## Scope (v1)

**In scope:** named agents, chat confirm before fan-out, Herdr/headless runtime, timeout partial collect, bundled skill, parent-in-chat synthesis.

**Non-goals:** editor/optimizer model, research/compare modes, non-Pi agents, persisted run history, per-agent follow-up orchestration.

## License

MIT © Saeed Marzban
