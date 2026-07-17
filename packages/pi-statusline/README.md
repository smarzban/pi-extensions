# @pi-extensions/pi-statusline

Custom **statusline** for [pi](https://github.com/earendil-works/pi) — session name on the **editor top border** (right side), plus a footer with model/effort, context, provider remaining, git branch, PR, and diff.

Part of the [pi-extensions](https://github.com/smarzban/pi-extensions) monorepo.

## Highlights

- **Session name on the text-box top border** — `──────── the-name ─` (right-aligned on the top edge)
- **Model · effort** from the active model + thinking level
- **Context** as `ctx N% · used/total` from `getContextUsage()`
- **Provider remaining** for supported subscriptions (when the provider exposes it)
- **Git** branch, dirty `*`, ahead/behind; **PR** number via `gh` when available

## Quickstart

```bash
pi install npm:@pi-extensions/pi-statusline
# or local
pi install /absolute/path/to/pi-extensions/packages/pi-statusline
```

Restart pi. Name the session so it shows:

```text
/name my task
```

Example:

```text
──────────────────── my task ─
│ type here…                 │
─────────────────────────────
[gpt-5.4 · high]  [ctx 12% · 24k/200k]  [5h 80% rem · 4h]  [main * ↑1]  [#12]
```

## Commands

```text
/statusline          # status + current segments
/statusline on       # enable custom footer (default)
/statusline off      # restore pi’s default footer
/statusline refresh  # re-fetch git + provider usage now
```

## Provider usage

| Provider id in pi | Remaining / windows | Auth source |
|-------------------|---------------------|-------------|
| `openai-codex` | Primary + secondary windows (`used%` + reset) | `~/.pi/agent/auth.json` → `openai-codex`, or `~/.codex/auth.json` |
| `opencode-go` | Best-effort (response rate-limit headers when present) | `opencode-go` key / `OPENCODE_API_KEY` |
| `xai` | Best-effort (response rate-limit headers when present) | `/login xai` OAuth in `auth.json` |

Codex uses ChatGPT’s subscription usage endpoint (same family as other pi footers). OpenCode Go and xAI do not currently expose a stable public remaining-% API that works with pi’s stored credentials; when response headers include ratelimit fields, those are shown. Otherwise the usage segment is omitted.

## Install methods

| Method | Command |
|--------|---------|
| **npm** | `pi install npm:@pi-extensions/pi-statusline` |
| **git** | `pi install git:github.com/smarzban/pi-extensions` |
| **local** | `pi install /absolute/path/to/pi-extensions/packages/pi-statusline` |

## License

[MIT](LICENSE)
