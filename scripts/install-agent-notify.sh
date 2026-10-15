#!/usr/bin/env bash
# Install agent-notify (webhook on agent turn end) for Claude Code and pi.
# Works on macOS and Linux. Run from a checkout of smarzban/pi-extensions:
#   bash scripts/install-agent-notify.sh            # pi package from this checkout
#   PI_SOURCE=git:github.com/smarzban/pi-extensions bash scripts/install-agent-notify.sh
# Idempotent. Never overwrites an existing env file.
set -eu
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
# Empty AGENT_NOTIFY_URL disables notifications (silent no-op).
AGENT_NOTIFY_URL=
AGENT_NOTIFY_KEY=
# Default: "Authorization: Bearer $AGENT_NOTIFY_KEY".
# Set to a custom name (e.g. X-Webhook-Key) to send the raw key in that header.
AGENT_NOTIFY_KEY_HEADER=
ENV
  echo "created $CFG_DIR/env (fill in URL and key)"
else
  echo "kept existing $CFG_DIR/env"
fi
chmod 600 "$CFG_DIR/env"

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

# 4. pi extension
if command -v pi >/dev/null 2>&1; then
  pi install "${PI_SOURCE:-$REPO}" && echo "pi package installed: ${PI_SOURCE:-$REPO}"
else
  echo "pi not found; skip. Later: pi install ${PI_SOURCE:-$REPO}"
fi
echo "Done. Edit $CFG_DIR/env, then restart Claude Code / pi sessions."
