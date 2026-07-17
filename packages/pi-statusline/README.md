# @pi-extensions/pi-statusline

Custom **statusline** for [pi](https://github.com/earendil-works/pi) — session name on the **editor top border** (right side), plus a footer with model/effort, context, provider remaining, git branch, PR, and diff.

Part of the [pi-extensions](https://github.com/smarzban/pi-extensions) monorepo.

## Highlights

- **Session name on the text-box top border** — `──────── the-name ─` (right-aligned on the top edge)
- **Model · effort** from the active model + thinking level
- **Context** as `ctx N% · used/total` — green below 50%, yellow at 50%+, red at 70%+
- **Session cost** `$x.xxx` from assistant `usage.cost.total` when non-zero
- **Provider remaining** for **openai-codex** only (real quota windows)
- **Git** `⎇ branch +staged *unstaged ?untracked` plus ahead/behind; **PR** via `gh` when present

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
[gpt-5.4 · high]  [ctx 12% · 24k/200k]  [$0.042]  [5h 80% rem · 4h]  [⎇ main +1 *2 ?1]  [#12]
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
| `openai-codex` | Primary + secondary windows (`% rem` + reset time) | `~/.pi/agent/auth.json` → `openai-codex`, or `~/.codex/auth.json` |

Other providers (xAI, OpenCode Go, …) have no reliable remaining-% API with pi’s credentials, so that segment is omitted for them.

## Costs

Yes — pi exposes per-assistant-message `usage.cost.total` (USD estimate from model pricing). The footer sums those across the session and shows `$x.xxx` when non-zero. Subscription OAuth turns may still report a computed cost even when you are not billed per-token.

## Install methods

| Method | Command |
|--------|---------|
| **npm** | `pi install npm:@pi-extensions/pi-statusline` |
| **git** | `pi install git:github.com/smarzban/pi-extensions` |
| **local** | `pi install /absolute/path/to/pi-extensions/packages/pi-statusline` |

## License

[MIT](LICENSE)
