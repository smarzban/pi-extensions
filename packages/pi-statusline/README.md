# @pi-extensions/pi-statusline

Custom **statusline** for [pi](https://github.com/earendil-works/pi): a rounded editor text box with a prompt and bottom-right session name, plus a footer with model/effort, context, provider remaining, git branch, PR, and diff.

Part of the [pi-extensions](https://github.com/smarzban/pi-extensions) monorepo.

## Highlights

- **Rounded text box** with `╭─╮`, `│ │`, and `╰─╯` corners plus a `›` prompt
- **Session name on the editor's bottom-right border**
- **Model · effort** from the active model + thinking level
- **Context** as `ctx N% · used/total`: green below 50%, yellow at 50%+, red at 70%+
- **Session cost** `$x.xxx` from assistant `usage.cost.total` when non-zero
- **Provider remaining** for **openai-codex**, **opt-in, off by default** (see [Provider usage](#provider-usage))
- **Git** `⎇ branch +staged *unstaged ?untracked` plus ahead/behind; **PR** via `gh` when present
- **Local by default** with no network calls or token reads unless you enable provider usage

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

Example (default, no provider-usage segment until you opt in):

```text
╭─────────────────────────────╮
│ › type here…                │
╰────────────────────── my task ─╯
[gpt-5-codex · high]  [ctx 12% · 24k/200k]  [$0.042]  [⎇ main +1 *2 ?1]  [#12]
```

After `/statusline usage on`, a Codex quota segment appears: `[5h 80% rem · 4h]`.

## Commands

```text
/statusline            # status + current segments
/statusline on         # enable custom footer (default)
/statusline off        # restore pi’s default footer
/statusline usage on   # opt in to provider quota (reads auth, calls provider)
/statusline usage off  # disable provider quota (default)
/statusline refresh    # re-fetch git (+ provider usage if enabled) now
```

Both `on/off` and `usage on/off` persist to `~/.pi/agent/statusline.json`.

## Provider usage

**Opt-in and off by default.** With usage off, the statusline reads **no** auth files and makes **no**
network calls. Turn it on with `/statusline usage on`; turn it back off with `/statusline usage off`.

When on, it reads your provider token and calls that provider's usage API:

| Provider id in pi | Remaining / windows | Reads | Sends token to |
|-------------------|---------------------|-------|----------------|
| `openai-codex` | Primary + secondary windows (`% rem` + reset time) | `~/.pi/agent/auth.json` → `openai-codex`, or `~/.codex/auth.json` | `chatgpt.com/backend-api` |

Only your own credentials are used, and the token goes only to that provider. Other providers (xAI,
OpenCode Go, …) have no reliable remaining-% API with pi's credentials, so the segment is omitted for
them even when usage is on.

## Costs

Yes, pi exposes per-assistant-message `usage.cost.total` (USD estimate from model pricing). The footer sums those across the session and shows `$x.xxx` when non-zero. Subscription OAuth turns may still report a computed cost even when you are not billed per-token.

## Install methods

| Method | Loads | Command |
|--------|-------|---------|
| **npm** (recommended) | This package only | `pi install npm:@pi-extensions/pi-statusline` |
| **local** | This package only | `pi install /absolute/path/to/pi-extensions/packages/pi-statusline` |
| **git** (whole monorepo) | All packages in the repo | `pi install git:github.com/smarzban/pi-extensions` |

See [docs/install](../../docs/install/README.md) for one package vs whole monorepo.

## License

[MIT](LICENSE)
