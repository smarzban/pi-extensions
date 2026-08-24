# @smarzban/pi-usage

A private, local token-usage dashboard for [Pi](https://github.com/badlogic/pi-mono), Claude Code, Codex CLI, and Grok Build.

## Install

```bash
pi install npm:@smarzban/pi-usage
```

Run `/usage` to scan local session metadata and open today's centered overlay dashboard. The default view shows providers used through Pi only. Press `o` to show the other local sources, then Enter to drill from source to provider to model. Press `e` to choose any priced provider and model in Pi's local catalog, including models without configured credentials, and estimate the current selection at pay-as-you-go API rates. Use `/usage today`, `/usage 7d`, `/usage 30d`, `/usage month`, `/usage all`, or `/usage rebuild` for a full local index rebuild followed by today's view. `30d` is a rolling 30 local-calendar-day window, while `month` runs from the first local day of the current month through today. Arrow keys select rows, while Left Arrow or Backspace returns to the previous level. Terminals narrower than 100 columns automatically use a compact inspector layout.

## Data and privacy

`pi-usage` reads only whitelisted usage fields from JSONL session stores and writes a local, normalized JSON index at `~/.pi/agent/pi-usage/index.json`. The index includes source session identifiers and local source-file paths for incremental reconciliation, but never transcript content. It never sends network requests, reads credentials, or retains prompts, code, tool input, or raw transcript lines.

It imports Pi sessions, Claude Code assistant usage, Codex cumulative token snapshots, and Grok Build `turn_completed` usage. Cursor is intentionally unsupported because reliable local usage counters are not available and its database contains credentials.

The normalized total counts each consumed token bucket once. For Claude, whose transcript exposes disjoint uncached-input and cache buckets, the importer reconstructs that total; for other harnesses it preserves their reported total. Reasoning and cache columns remain source-native subsets, not values to add again. API-equivalent costs are native recorded values where a harness supplies one and explicitly unavailable otherwise. PAYG estimates apply the selected model's current Pi-catalog rates to the recorded token mix. They remain approximate because tokenization, caching behavior, discounts, and pricing can differ. Neither figure is a subscription balance or guaranteed vendor bill. Claude and Codex local formats can drift, retention and deleted files can make history incomplete, and large histories produce a correspondingly large local JSON index.

## License

[MIT](LICENSE)
