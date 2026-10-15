#!/usr/bin/env bash
# Install agent-notify (webhook on agent turn end) for Claude Code, grok and pi.
# Works on macOS and Linux. Run from a checkout of smarzban/pi-extensions:
#   bash scripts/install-agent-notify.sh            # pi package from this checkout
#   PI_SOURCE=git:github.com/smarzban/pi-extensions bash scripts/install-agent-notify.sh
#
# Opt-in model: plain `pi` / `claude` stay silent. With a URL, aliases
# `pin` and `ccn` are added to ~/.zshrc and set AGENT_NOTIFY_URL per run.
#
# Options:
#   --url URL        webhook URL for the aliases (or env AGENT_NOTIFY_URL)
#   --key-from-env   store env AGENT_NOTIFY_KEY in the env file (never printed)
#   --header NAME    store AGENT_NOTIFY_KEY_HEADER (e.g. X-Webhook-Key)
# Idempotent. Existing env file values are kept unless a flag sets them.
# If ~/.claude/settings.json exists but is not valid JSON, the install
# stops and leaves that file unchanged. An existing backup is never overwritten.
set -eu
URL="${AGENT_NOTIFY_URL-}"; KEY_FROM_ENV=0; HEADER=""
while [ $# -gt 0 ]; do
  case "$1" in
    --url) URL="${2-}"; shift 2 ;;
    --url=*) URL="${1#*=}"; shift ;;
    --key-from-env) KEY_FROM_ENV=1; shift ;;
    --header) HEADER="${2-}"; shift 2 ;;
    --header=*) HEADER="${1#*=}"; shift ;;
    http://*|https://*) URL="$1"; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
REPO="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$HOME/.local/bin"
CFG_DIR="$HOME/.config/agent-notify"
CLAUDE_SETTINGS="$HOME/.claude/settings.json"

# 1. Notifier
mkdir -p "$BIN_DIR"
cp "$REPO/packages/pi-agent-notify/bin/agent-notify" "$BIN_DIR/agent-notify"
chmod 755 "$BIN_DIR/agent-notify"
echo "installed $BIN_DIR/agent-notify"

# 2. Env file (placeholders only)
mkdir -p "$CFG_DIR"; chmod 700 "$CFG_DIR"
if [ ! -f "$CFG_DIR/env" ]; then
  cat > "$CFG_DIR/env" <<'ENV'
# agent-notify config. Env vars of the same name override these.
# Leave AGENT_NOTIFY_URL empty: notifications are opt-in per run via
# the pin / ccn aliases (they set AGENT_NOTIFY_URL in the environment).
AGENT_NOTIFY_URL=
AGENT_NOTIFY_KEY=
# Default: "Authorization: Bearer $AGENT_NOTIFY_KEY".
# Set to a custom name (e.g. X-Webhook-Key) to send the raw key in that header.
AGENT_NOTIFY_KEY_HEADER=
ENV
  echo "created $CFG_DIR/env"
else
  echo "kept existing $CFG_DIR/env"
fi
chmod 600 "$CFG_DIR/env"

# Quote a value as a shell single-quoted string. A raw ' becomes '\'' so
# sourcing the env file cannot break out of the quotes.
shell_sq() {
  local s="$1"
  s=${s//\'/\'\\\'\'}
  printf "'%s'" "$s"
}

# set_var NAME VALUE: replace or append NAME=VALUE in the env file (portable, no sed -i)
set_var() {
  local tmp q
  q="$(shell_sq "$2")"
  tmp="$(mktemp "$CFG_DIR/env.XXXXXX")"
  chmod 600 "$tmp"
  AN_NAME="$1" AN_QUOTED="$q" awk 'BEGIN{n=ENVIRON["AN_NAME"]; v=ENVIRON["AN_QUOTED"]; d=0}
    index($0, n"=")==1 {print n"="v; d=1; next} {print}
    END{if(!d) print n"="v}' "$CFG_DIR/env" > "$tmp"
  mv "$tmp" "$CFG_DIR/env"
  chmod 600 "$CFG_DIR/env"
}
if [ "$KEY_FROM_ENV" = 1 ]; then
  if [ -n "${AGENT_NOTIFY_KEY-}" ]; then set_var AGENT_NOTIFY_KEY "$AGENT_NOTIFY_KEY"; echo "stored AGENT_NOTIFY_KEY in $CFG_DIR/env"
  else echo "--key-from-env given but AGENT_NOTIFY_KEY is empty; key not changed"; fi
fi
[ -n "$HEADER" ] && set_var AGENT_NOTIFY_KEY_HEADER "$HEADER" && echo "set AGENT_NOTIFY_KEY_HEADER=$HEADER"

# Opt-in aliases in ~/.zshrc (marked block, replaced on rerun)
ZSHRC="$HOME/.zshrc"
if [ -n "$URL" ]; then
  case "$URL" in *\'*|*\"*|*'$'*|*'`'*) echo "URL must not contain quotes, \$ or backticks" >&2; exit 2 ;; esac
  touch "$ZSHRC"
  tmp="$(mktemp "${TMPDIR:-/tmp}/zshrc.XXXXXX")"
  awk '/^# >>> agent-notify >>>$/{skip=1} !skip{print} /^# <<< agent-notify <<<$/{skip=0}' "$ZSHRC" > "$tmp"
  {
    echo "# >>> agent-notify >>>"
    echo "alias pin='AGENT_NOTIFY_URL=\"$URL\" pi'"
    echo "alias ccn='AGENT_NOTIFY_URL=\"$URL\" claude'"
    echo "alias grokn='AGENT_NOTIFY_URL=\"$URL\" grok'"
    echo "# <<< agent-notify <<<"
  } >> "$tmp"
  cat "$tmp" > "$ZSHRC"; rm -f "$tmp"
  echo "wrote pin/ccn/grokn aliases to $ZSHRC (open a new shell or: source ~/.zshrc)"
else
  echo "no URL given (--url or AGENT_NOTIFY_URL); skipped pin/ccn/grokn aliases"
fi

# 3. Claude Code Stop hook (merge, keep everything else)
# Quote $HOME so a home directory with spaces is one shell word.
HOOK_CMD="\"\$HOME/.local/bin/agent-notify\" --source claude --skip-if stop_hook_active --pick session_id,cwd,transcript_path,last_assistant_message,hook_event_name"

# Merge the Stop hook into settings.json. Node is preferred; python3 is the
# fallback. With neither, skip this step (the rest of the install still finishes).
# Never write the file when the existing JSON cannot be parsed.
merge_claude_stop_hook() {
  local editor
  if command -v node >/dev/null 2>&1; then
    editor=node
  elif command -v python3 >/dev/null 2>&1; then
    editor=python3
  else
    echo "node and python3 not found; skipped Claude Stop hook (settings left unchanged)." >&2
    echo "Add this command under hooks.Stop in $CLAUDE_SETTINGS, then rerun:" >&2
    echo "  $HOOK_CMD" >&2
    return 0
  fi
  mkdir -p "$(dirname "$CLAUDE_SETTINGS")"
  if [ "$editor" = node ]; then
    HOOK_CMD="$HOOK_CMD" SETTINGS="$CLAUDE_SETTINGS" node <<'JS'
const fs = require("fs");
const f = process.env.SETTINGS;
const cmd = process.env.HOOK_CMD;
const bak = f + ".bak.agent-notify";
function fail(msg) {
  console.error(msg);
  process.exit(1);
}
let s = {};
const existed = fs.existsSync(f);
if (existed) {
  let raw;
  try {
    raw = fs.readFileSync(f, "utf8");
  } catch (e) {
    fail("error: cannot read " + f + ": " + e.message);
  }
  try {
    s = JSON.parse(raw);
  } catch (e) {
    fail("error: " + f + " is not valid JSON; left unchanged. Fix the file and rerun the installer. (" + e.message + ")");
  }
  if (s === null || typeof s !== "object" || Array.isArray(s)) {
    fail("error: " + f + " must be a JSON object; left unchanged.");
  }
}
if (s.hooks == null) s.hooks = {};
if (typeof s.hooks !== "object" || Array.isArray(s.hooks)) {
  fail("error: " + f + " hooks must be a JSON object; left unchanged.");
}
if (s.hooks.Stop == null) s.hooks.Stop = [];
if (!Array.isArray(s.hooks.Stop)) {
  fail("error: " + f + " hooks.Stop must be an array; left unchanged.");
}
const has = s.hooks.Stop.some(g => {
  const hooks = (g && Array.isArray(g.hooks)) ? g.hooks : [];
  return hooks.some(h => String((h && h.command) || "").includes("agent-notify"));
});
if (!has) s.hooks.Stop.push({ hooks: [{ type: "command", command: cmd, timeout: 10 }] });
if (existed && !fs.existsSync(bak)) {
  try {
    fs.copyFileSync(f, bak);
  } catch (e) {
    fail("error: could not back up " + f + " to " + bak + ": " + e.message);
  }
  console.log("backed up " + f + " to " + bak);
} else if (existed) {
  console.log("kept existing backup " + bak);
}
try {
  fs.writeFileSync(f, JSON.stringify(s, null, 2) + "\n");
} catch (e) {
  fail("error: could not write " + f + ": " + e.message);
}
console.log(has ? "Claude Stop hook already present" : "added Claude Stop hook to " + f);
JS
  else
    HOOK_CMD="$HOOK_CMD" SETTINGS="$CLAUDE_SETTINGS" python3 - <<'PY'
import json, os, shutil, sys
f = os.environ["SETTINGS"]
cmd = os.environ["HOOK_CMD"]
bak = f + ".bak.agent-notify"

def fail(msg):
    print(msg, file=sys.stderr)
    sys.exit(1)

s = {}
existed = os.path.exists(f)
if existed:
    try:
        with open(f, encoding="utf-8") as fh:
            raw = fh.read()
    except OSError as e:
        fail("error: cannot read " + f + ": " + str(e))
    try:
        s = json.loads(raw)
    except json.JSONDecodeError as e:
        fail("error: " + f + " is not valid JSON; left unchanged. Fix the file and rerun the installer. (" + str(e) + ")")
    if not isinstance(s, dict):
        fail("error: " + f + " must be a JSON object; left unchanged.")
hooks = s.get("hooks")
if hooks is None:
    s["hooks"] = {}
    hooks = s["hooks"]
if not isinstance(hooks, dict):
    fail("error: " + f + " hooks must be a JSON object; left unchanged.")
stop = hooks.get("Stop")
if stop is None:
    hooks["Stop"] = []
    stop = hooks["Stop"]
if not isinstance(stop, list):
    fail("error: " + f + " hooks.Stop must be an array; left unchanged.")
has = False
for g in stop:
    if not isinstance(g, dict):
        continue
    hs = g.get("hooks")
    if not isinstance(hs, list):
        continue
    for h in hs:
        if isinstance(h, dict) and "agent-notify" in str(h.get("command") or ""):
            has = True
            break
    if has:
        break
if not has:
    stop.append({"hooks": [{"type": "command", "command": cmd, "timeout": 10}]})
if existed and not os.path.exists(bak):
    try:
        shutil.copy2(f, bak)
    except OSError as e:
        fail("error: could not back up " + f + " to " + bak + ": " + str(e))
    print("backed up " + f + " to " + bak)
elif existed:
    print("kept existing backup " + bak)
try:
    with open(f, "w", encoding="utf-8") as fh:
        json.dump(s, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
except OSError as e:
    fail("error: could not write " + f + ": " + str(e))
print("Claude Stop hook already present" if has else "added Claude Stop hook to " + f)
PY
  fi
}
merge_claude_stop_hook

# 3b. grok Stop hook (own file in ~/.grok/hooks, rewritten on rerun)
# grok payload is camelCase. Skip continuation fires, session-teardown Stop
# (no promptId) and subagent stops.
if [ -d "$HOME/.grok" ] || command -v grok >/dev/null 2>&1; then
  mkdir -p "$HOME/.grok/hooks"
  cat > "$HOME/.grok/hooks/agent-notify.json" <<'GROK'
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\"$HOME/.local/bin/agent-notify\" --source grok --skip-if stopHookActive --require promptId --skip-present subagentType --pick sessionId,promptId,cwd,workspaceRoot,lastAssistantMessage,hook_event_name",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
GROK
  echo "wrote grok Stop hook $HOME/.grok/hooks/agent-notify.json"
else
  echo "grok not found; skipped grok hook"
fi

# 4. pi extension
if command -v pi >/dev/null 2>&1; then
  pi install "${PI_SOURCE:-$REPO}" && echo "pi package installed: ${PI_SOURCE:-$REPO}"
else
  echo "pi not found; skip. Later: pi install ${PI_SOURCE:-$REPO}"
fi
echo "Done. Plain pi/claude/grok stay silent; use pin/ccn/grokn to notify."
