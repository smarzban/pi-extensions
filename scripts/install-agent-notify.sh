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

# set_var NAME VALUE: replace or append NAME=VALUE in the env file (portable, no sed -i)
set_var() {
  tmp="$(mktemp "$CFG_DIR/env.XXXXXX")"; chmod 600 "$tmp"
  AN_NAME="$1" AN_VAL="$2" awk 'BEGIN{n=ENVIRON["AN_NAME"]; v=ENVIRON["AN_VAL"]; d=0}
    index($0, n"=")==1 {print n"=\047"v"\047"; d=1; next} {print}
    END{if(!d) print n"=\047"v"\047"}' "$CFG_DIR/env" > "$tmp"
  mv "$tmp" "$CFG_DIR/env"; chmod 600 "$CFG_DIR/env"
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
HOOK_CMD="\$HOME/.local/bin/agent-notify --source claude --skip-if stop_hook_active --pick session_id,cwd,transcript_path,last_assistant_message,hook_event_name"
mkdir -p "$(dirname "$CLAUDE_SETTINGS")"
[ -f "$CLAUDE_SETTINGS" ] && cp "$CLAUDE_SETTINGS" "$CLAUDE_SETTINGS.bak.agent-notify"
HOOK_CMD="$HOOK_CMD" SETTINGS="$CLAUDE_SETTINGS" node -e '
const fs=require("fs"); const f=process.env.SETTINGS, cmd=process.env.HOOK_CMD;
let s={}; try{s=JSON.parse(fs.readFileSync(f,"utf8"))}catch{}
s.hooks=s.hooks||{}; s.hooks.Stop=s.hooks.Stop||[];
const has=s.hooks.Stop.some(g=>(g.hooks||[]).some(h=>String(h.command||"").includes("agent-notify")));
if(!has) s.hooks.Stop.push({hooks:[{type:"command",command:cmd,timeout:10}]});
fs.writeFileSync(f,JSON.stringify(s,null,2)+"\n");
console.log(has?"Claude Stop hook already present":"added Claude Stop hook to "+f);'

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
            "command": "$HOME/.local/bin/agent-notify --source grok --skip-if stopHookActive --require promptId --skip-present subagentType --pick sessionId,promptId,cwd,workspaceRoot,lastAssistantMessage,hook_event_name",
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
