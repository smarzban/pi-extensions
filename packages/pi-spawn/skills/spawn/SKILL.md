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

## Surfaces

- `/spawn` — ask what to look into, then draft → confirm → `spawn_run`
- `/spawn <name> on this` — draft from current topic for that named agent
- `/spawn the agents on this` — draft from current topic for the default set
- Natural language (“spawn the agents on this”, “run opus and fable on …”) — same workflow

## Rules

- Never start children until the user confirms the brief.
- Never open Herdr tabs or run `pi -p` yourself for spawn; the tools own runtime selection (`HERDR_ENV=1` → Herdr tabs, else headless; background forces headless).
- Children inherit the parent cwd and normal Pi tools; they write temp findings the tool collects and deletes.
- Parent owns synthesis. There are no modes, no editor/optimizer model, and no persisted run history in v1.
