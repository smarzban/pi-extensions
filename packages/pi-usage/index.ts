import { homedir } from "node:os";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import {
	eventsForPeriod,
	importAll,
	loadIndex,
	saveIndex,
	totalsForPeriod,
} from "./core.mjs";

type Period = "today" | "7d" | "30d" | "all";
type Group = "source" | "provider" | "model";

interface UsageEvent {
	source: string;
	provider: string;
	model: string;
	[key: string]: unknown;
}

interface SourceHealth {
	source: string;
	status: string;
	files: number;
	malformed: number;
	skipped: number;
}

const formatTokens = (value: number) => {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
	return String(value);
};

const costLabel = (totals: {
	recordedCost: number;
	recordedCostItems: number;
	estimatedCost: number;
	estimatedCostItems: number;
	unavailableCost: number;
}) => {
	const parts: string[] = [];
	if (totals.recordedCostItems) parts.push(`$${totals.recordedCost.toFixed(3)} rec`);
	if (totals.estimatedCostItems) parts.push(`~$${totals.estimatedCost.toFixed(3)} est`);
	if (totals.unavailableCost) parts.push("—");
	return parts.join(" + ") || "—";
};

class UsageDashboard {
	private period: Period;
	private group: Group = "source";
	private filters: { source?: string; provider?: string } = {};
	private cursor = 0;
	private offset = 0;
	private rowLabels: string[] = [];
	private readonly pageSize = 15;
	private readonly number = new Intl.NumberFormat();

	constructor(
		private readonly events: UsageEvent[],
		private readonly health: SourceHealth[],
		period: Period,
		private readonly done: () => void,
		private readonly theme: any,
	) {
		this.period = period;
	}

	private resetCursor() {
		this.cursor = 0;
		this.offset = 0;
	}

	private drillDown() {
		const label = this.rowLabels[this.cursor];
		if (!label) return;
		if (this.group === "source") {
			this.filters = { source: label };
			this.group = "provider";
		} else if (this.group === "provider") {
			this.filters.provider = label;
			this.group = "model";
		} else {
			return;
		}
		this.resetCursor();
	}

	private goBack() {
		if (this.group === "model") {
			delete this.filters.provider;
			this.group = "provider";
			this.resetCursor();
		} else if (this.group === "provider" && this.filters.source) {
			this.filters = {};
			this.group = "source";
			this.resetCursor();
		}
	}

	handleInput(data: string) {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c")) || data === "q") {
			this.done();
		} else if (data === "t" || data === "7" || data === "3" || data === "a") {
			this.period = data === "t" ? "today" : data === "7" ? "7d" : data === "3" ? "30d" : "all";
			this.resetCursor();
		} else if (data === "g") {
			this.filters = {};
			this.group =
				this.group === "source" ? "provider" : this.group === "provider" ? "model" : "source";
			this.resetCursor();
		} else if (matchesKey(data, Key.enter)) {
			this.drillDown();
		} else if (matchesKey(data, Key.left) || matchesKey(data, Key.backspace)) {
			this.goBack();
		} else if (matchesKey(data, Key.up) || data === "k") {
			this.cursor = Math.max(0, this.cursor - 1);
		} else if (matchesKey(data, Key.down) || data === "j") {
			this.cursor = Math.min(Math.max(0, this.rowLabels.length - 1), this.cursor + 1);
		} else if (matchesKey(data, Key.pageUp)) {
			this.cursor = Math.max(0, this.cursor - this.pageSize);
		} else if (matchesKey(data, Key.pageDown)) {
			this.cursor = Math.min(
				Math.max(0, this.rowLabels.length - 1),
				this.cursor + this.pageSize,
			);
		}
	}

	render(width: number) {
		const periodEvents = eventsForPeriod(this.events, this.period);
		const selected = periodEvents.filter(
			(event) =>
				(!this.filters.source || event.source === this.filters.source) &&
				(!this.filters.provider || event.provider === this.filters.provider),
		);
		const totals = totalsForPeriod(selected, "all");
		const grouped = new Map<string, UsageEvent[]>();
		for (const event of selected) {
			const key = String(event[this.group] ?? "unknown");
			const events = grouped.get(key) ?? [];
			events.push(event);
			grouped.set(key, events);
		}
		const rows = [...grouped.entries()]
			.map(([label, events]) => ({ label, totals: totalsForPeriod(events, "all") }))
			.sort((left, right) => right.totals.total - left.totals.total);
		this.rowLabels = rows.map((row) => row.label);
		this.cursor = Math.min(this.cursor, Math.max(0, rows.length - 1));
		if (this.cursor < this.offset) this.offset = this.cursor;
		if (this.cursor >= this.offset + this.pageSize) {
			this.offset = this.cursor - this.pageSize + 1;
		}
		const visibleRows = rows.slice(this.offset, this.offset + this.pageSize);
		const breadcrumb = [this.filters.source, this.filters.provider].filter(Boolean).join(" / ");
		const location = breadcrumb ? `${breadcrumb} · ${this.group}` : `grouped by ${this.group}`;

		const lines = [
			this.theme.fg(
				"accent",
				this.theme.bold(` Usage: ${this.period} · ${location}`),
			),
			this.theme.fg(
				"dim",
				"  Name                       Requests  Input  Output  Cache R  Cache W  Reasoning  Cost",
			),
			...visibleRows.map(({ label, totals }, visibleIndex) => {
				const rowIndex = this.offset + visibleIndex;
				const marker = rowIndex === this.cursor ? "›" : " ";
				const line = `${marker} ${label.padEnd(26).slice(0, 26)} ${this.number.format(totals.requests).padStart(8)} ${formatTokens(totals.input).padStart(6)} ${formatTokens(totals.output).padStart(7)} ${formatTokens(totals.cacheRead).padStart(8)} ${formatTokens(totals.cacheWrite).padStart(8)} ${formatTokens(totals.reasoning).padStart(10)}  ${costLabel(totals)}`;
				return rowIndex === this.cursor ? this.theme.fg("accent", line) : line;
			}),
			...(rows.length > this.pageSize
				? [
						this.theme.fg(
							"dim",
							`Rows ${this.offset + 1}-${Math.min(this.offset + this.pageSize, rows.length)} of ${rows.length}`,
						),
					]
				: []),
			"",
			`Total: ${formatTokens(totals.total)} normalized tokens, ${this.number.format(totals.requests)} requests, ${costLabel(totals)}`,
			this.theme.fg(
				"warning",
				"Reasoning and cache columns are source-native subsets, never add them to Total.",
			),
			this.theme.fg(
				"dim",
				`Sources: ${this.health
					.map(
						(item) =>
							`${item.source} ${item.status} (${item.files})${item.malformed || item.skipped ? ` [${item.malformed} malformed, ${item.skipped} skipped]` : ""}`,
					)
					.join(" · ")} · Cursor unsupported (usage is server-side).`,
			),
			this.theme.fg(
				"dim",
				"↑↓ select · enter drill down · ← back · g grouping · t/7/3/a period · esc close",
			),
		];
		return lines.map((line) => truncateToWidth(line, width));
	}

	invalidate() {}
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("usage", {
		description: "Local usage dashboard. Args: today, 7d, 30d, all, rebuild",
		handler: async (args, ctx) => {
			const requested = (args ?? "").trim().toLowerCase();
			if (!["", "today", "7d", "30d", "all", "rebuild"].includes(requested)) {
				ctx.ui.notify("Usage: /usage [today|7d|30d|all|rebuild]", "error");
				return;
			}
			const period: Period = (["today", "7d", "30d", "all"] as string[]).includes(requested)
				? (requested as Period)
				: "today";
			const indexPath = join(getAgentDir(), "pi-usage", "index.json");
			const previous = requested === "rebuild" ? undefined : await loadIndex(indexPath);
			const home = homedir();
			const result = await importAll(
				{
					pi: join(getAgentDir(), "sessions"),
					claude: join(home, ".claude", "projects"),
					codex: [
						join(home, ".codex", "sessions"),
						join(home, ".codex", "archived_sessions"),
					],
					grok: join(home, ".grok", "sessions"),
				},
				previous,
			);
			await saveIndex(indexPath, result.index);

			if (ctx.mode !== "tui") {
				const totals = totalsForPeriod(result.events, period);
				ctx.ui.notify(
					`Usage ${period}: ${formatTokens(totals.total)} tokens, ${totals.requests} requests`,
					"info",
				);
				return;
			}

			await ctx.ui.custom<void>((tui, theme, _keys, done) => {
				const view = new UsageDashboard(result.events, result.health, period, done, theme);
				return {
					render: (width: number) => view.render(width),
					invalidate: () => view.invalidate(),
					handleInput: (data: string) => {
						view.handleInput(data);
						tui.requestRender();
					},
				};
			});
		},
	});
}
