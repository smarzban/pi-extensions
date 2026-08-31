---
name: spawn
description: Fan out a confirmed research/implementation brief to named Pi agents in parallel via pi-spawn tools. Use when the user asks to spawn agents, run the agents on this, compare models on a question, or otherwise parallelize the same brief across configured named agents.
---

# Spawn parallel Pi agents

Use this skill instead of manually opening Herdr tabs or inventing your own fan-out.

## Workflow

1. **Draft** a short brief from the conversation (or from “on this”: summarize the current topic).
2. **Present** the brief in chat and ask the user to confirm: yes / edit / cancel.
3. **Only after explicit confirm**, call the `spawn_run` tool with:
   - `brief`: the confirmed text
   - `confirmed`: `true`
   - `useDefaultSet: true` for “the agents”, or `names: ["…"]` for a named agent
   - `background: true` if the user asked for background/headless
4. **Synthesize** the returned findings in chat. Mark missing/failed agents clearly. Do not claim they finished.
5. **Investigate stragglers**: for each missing agent that has a pane, use **non-blocking** herdr tools (`herdr_agent` get/read on its pane) to see whether it is stuck, blocked, waiting on usage limits, or still working. Only move on once the reason is clear. If it is still working, tell the user and offer to wait.
6. **Handle spawn-pings**: a later message like `spawn-ping: <agent> done, finding at <path>` means a straggler finished. Read that finding file and fold it into the report.

## Surfaces

- `/spawn` — ask what to look into, then draft → confirm → `spawn_run`
- `/spawn <name> on this` — draft from current topic for that named agent
- `/spawn the agents on this` — draft from current topic for the default set
- Natural language (“spawn the agents on this”, “run opus and fable on …”, “get the agents to investigate …”) — same workflow

## Rules

- Never start children until the user confirms the brief.
- Never open Herdr tabs or run `pi -p` yourself for spawn; the tools own runtime selection (`HERDR_ENV=1` → Herdr tabs, else headless; background forces headless).
- **Never call `herdr_agent wait` (or other blocking waits) on spawn children.** `spawn_run` already waits and collects findings; a parent-side wait freezes the chat. Completion for late agents arrives via `spawn-ping` or a non-blocking get/read.
- **Never close spawn tabs or panes, on success or failure, unless the user explicitly asks.** They are the user's visibility surface.
- Children inherit the parent cwd and normal Pi tools; they write temp findings the tool collects. The run dir is deleted only when every agent delivered; it is kept while stragglers are outstanding so late findings can still land.
- Parent owns synthesis. There are no modes, no editor/optimizer model, and no persisted run history in v1.
