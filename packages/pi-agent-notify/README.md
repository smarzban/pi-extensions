# pi-agent-notify

POSTs a small JSON event to a webhook whenever Pi finishes (on `agent_end`, i.e. back at the prompt). Ships the portable `agent-notify` CLI, which the Claude Code `Stop` hook uses too.

## Install

```bash
AGENT_NOTIFY_KEY=... bash scripts/install-agent-notify.sh --url https://example/webhook --key-from-env
# options: --url URL (or env AGENT_NOTIFY_URL), --key-from-env, --header X-Webhook-Key
```

Installs the notifier, env file, Claude Stop hook and pi package. Rerunning is safe.

## Opt-in usage

Plain `pi` and `claude` stay silent: `AGENT_NOTIFY_URL` is empty in the env file. With `--url`, the installer writes a marked block to `~/.zshrc` (replaced on rerun):

```bash
# >>> agent-notify >>>
alias pin='AGENT_NOTIFY_URL="https://example/webhook" pi'
alias ccn='AGENT_NOTIFY_URL="https://example/webhook" claude'
# <<< agent-notify <<<
```

Use `pin` / `ccn` when you want a webhook event at the end of each turn.

## Configure

`~/.config/agent-notify/env` (chmod 600). Env vars of the same name override it.

| Var | Meaning |
| --- | --- |
| `AGENT_NOTIFY_URL` | Webhook URL. Empty in the file by default (off); a non-empty env var turns it on for that run. |
| `AGENT_NOTIFY_KEY` | Secret. |
| `AGENT_NOTIFY_KEY_HEADER` | Default `Authorization` (sent as `Bearer KEY`). Any other name, e.g. `X-Webhook-Key`, sends the raw key. |
| `AGENT_NOTIFY_BIN` | Override notifier path used by the pi extension. |

## Payload

```json
{"event":"turn_end","source":"pi","host":"mini","cwd":"/path","timestamp":"2026-10-15T18:00:00Z",
 "session_id":"...","last_assistant_message":"(max 2000 chars)","herdr_pane_id":"...","herdr":{"HERDR_...":"..."}}
```

Claude events carry `session_id`, `cwd`, `transcript_path`, `last_assistant_message`, `hook_event_name`. Runs in the background with `curl --max-time 5`, always exits 0, and skips Claude Stop events where `stop_hook_active` is true. The key is passed to curl via a temp config file, not argv.
