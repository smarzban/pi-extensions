import { homedir } from "node:os";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
	estimateModelCost,
	eventsForPeriod,
	importAll,
	loadIndex,
	saveIndex,
	totalsForPeriod,
} from "./core.mjs";

type Period = "today" | "7d" | "30d" | "month" | "all";
type Group = "source" | "provider" | "model";

interface UsageEvent {
	source: string;
	provider: string;
	model: string;
	[key: string]: unknown;
}

interface PriceRates {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	tiers?: Array<PriceRates & { inputTokensAbove: number }>;
}

interface PricingModel {
	provider: string;
	id: string;
	name: string;
	cost: PriceRates;
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
	private group: Group = "provider";
	private filters: { source?: string; provider?: string } = { source: "pi" };
	private sourcePickerActive = false;
	private screen: "usage" | "estimate-provider" | "estimate-model" = "usage";
	private estimateProvider?: string;
	private estimateTarget?: PricingModel;
	private pickerItems: Array<{ label: string; value: string | PricingModel }> = [];
	private cursor = 0;
	private offset = 0;
	private usageCursor = 0;
	private usageOffset = 0;
	private rowLabels: string[] = [];
	private viewSize = 15;
	private readonly number = new Intl.NumberFormat();
	private readonly rate = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 });

	constructor(
		private readonly events: UsageEvent[],
		private readonly pricingModels: PricingModel[],
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

	private frame(content: string[], width: number) {
		const innerWidth = Math.max(38, width - 2);
		const framedRow = (line: string) => {
			const clipped = truncateToWidth(line, innerWidth);
			return `${this.theme.fg("border", "│")}${clipped}${" ".repeat(Math.max(0, innerWidth - visibleWidth(clipped)))}${this.theme.fg("border", "│")}`;
		};
		return [
			this.theme.fg("border", `╭${"─".repeat(innerWidth)}╮`),
			...content.map(framedRow),
			this.theme.fg("border", `╰${"─".repeat(innerWidth)}╯`),
		];
	}

	private restoreUsagePosition() {
		this.screen = "usage";
		this.cursor = this.usageCursor;
		this.offset = this.usageOffset;
	}

	private chooseEstimateItem() {
		const item = this.pickerItems[this.cursor];
		if (!item) return;
		if (this.screen === "estimate-provider" && typeof item.value === "string") {
			this.estimateProvider = item.value;
			this.screen = "estimate-model";
			this.resetCursor();
		} else if (this.screen === "estimate-model" && typeof item.value !== "string") {
			this.estimateTarget = item.value;
			this.restoreUsagePosition();
		}
	}

	private leaveEstimatePicker() {
		if (this.screen === "estimate-model") {
			this.screen = "estimate-provider";
			this.resetCursor();
		} else {
			this.restoreUsagePosition();
		}
	}

	private renderEstimatePicker(width: number) {
		this.viewSize = width < 100 ? 12 : 18;
		if (this.screen === "estimate-provider") {
			const counts = new Map<string, number>();
			for (const model of this.pricingModels) {
				counts.set(model.provider, (counts.get(model.provider) ?? 0) + 1);
			}
			this.pickerItems = [...counts]
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([provider]) => ({ label: provider, value: provider }));
		} else {
			this.pickerItems = this.pricingModels
				.filter((model) => model.provider === this.estimateProvider)
				.sort((left, right) => left.name.localeCompare(right.name))
				.map((model) => ({ label: model.name || model.id, value: model }));
		}
		this.rowLabels = this.pickerItems.map((item) => item.label);
		this.cursor = Math.min(this.cursor, Math.max(0, this.pickerItems.length - 1));
		if (this.cursor < this.offset) this.offset = this.cursor;
		if (this.cursor >= this.offset + this.viewSize) {
			this.offset = this.cursor - this.viewSize + 1;
		}
		const visible = this.pickerItems.slice(this.offset, this.offset + this.viewSize);
		const title =
			this.screen === "estimate-provider"
				? " Estimate PAYG · choose provider"
				: ` Estimate PAYG · ${this.estimateProvider} · choose model`;
		const rows = visible.map((item, visibleIndex) => {
			const rowIndex = this.offset + visibleIndex;
			const marker = rowIndex === this.cursor ? "›" : " ";
			let detail = "";
			if (typeof item.value === "string") {
				const count = this.pricingModels.filter((model) => model.provider === item.value).length;
				detail = `${count} priced models`;
			} else {
				detail = `in $${this.rate.format(item.value.cost.input)}/M · out $${this.rate.format(item.value.cost.output)}/M`;
			}
			const line = `${marker} ${item.label.padEnd(width < 100 ? 28 : 48).slice(0, width < 100 ? 28 : 48)} ${detail}`;
			return rowIndex === this.cursor ? this.theme.fg("accent", line) : line;
		});
		const range =
			this.pickerItems.length > this.viewSize
				? ` Rows ${this.offset + 1}-${Math.min(this.offset + this.viewSize, this.pickerItems.length)} of ${this.pickerItems.length}`
				: "";
		return this.frame(
			[
				this.theme.fg("accent", this.theme.bold(title)),
				this.theme.fg(
					"dim",
					" Current Pi model catalog, credentials are not required for estimates",
				),
				"",
				...rows,
				...(range ? [this.theme.fg("dim", range)] : []),
				"",
				this.theme.fg("dim", " ↑↓ select · Enter choose · ← back · Esc back · q close"),
			],
			width,
		);
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
		} else if (
			this.group === "provider" &&
			this.filters.source &&
			this.sourcePickerActive
		) {
			this.filters = {};
			this.group = "source";
			this.resetCursor();
		}
	}

	handleInput(data: string) {
		if (matchesKey(data, Key.ctrl("c")) || data === "q") {
			this.done();
			return;
		}
		if (this.screen !== "usage") {
			if (
				matchesKey(data, Key.escape) ||
				matchesKey(data, Key.left) ||
				matchesKey(data, Key.backspace)
			) {
				this.leaveEstimatePicker();
			} else if (matchesKey(data, Key.enter)) {
				this.chooseEstimateItem();
			} else if (matchesKey(data, Key.up) || data === "k") {
				this.cursor = Math.max(0, this.cursor - 1);
			} else if (matchesKey(data, Key.down) || data === "j") {
				this.cursor = Math.min(Math.max(0, this.rowLabels.length - 1), this.cursor + 1);
			} else if (matchesKey(data, Key.pageUp)) {
				this.cursor = Math.max(0, this.cursor - this.viewSize);
			} else if (matchesKey(data, Key.pageDown)) {
				this.cursor = Math.min(
					Math.max(0, this.rowLabels.length - 1),
					this.cursor + this.viewSize,
				);
			}
			return;
		}
		if (matchesKey(data, Key.escape)) {
			this.done();
		} else if (data === "e") {
			this.usageCursor = this.cursor;
			this.usageOffset = this.offset;
			this.screen = "estimate-provider";
			this.resetCursor();
		} else if (
			data === "t" ||
			data === "7" ||
			data === "3" ||
			data === "m" ||
			data === "a"
		) {
			this.period =
				data === "t"
					? "today"
					: data === "7"
						? "7d"
						: data === "3"
							? "30d"
							: data === "m"
								? "month"
								: "all";
			this.resetCursor();
		} else if (data === "o") {
			this.filters = {};
			this.sourcePickerActive = true;
			this.group = "source";
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
			this.cursor = Math.max(0, this.cursor - this.viewSize);
		} else if (matchesKey(data, Key.pageDown)) {
			this.cursor = Math.min(
				Math.max(0, this.rowLabels.length - 1),
				this.cursor + this.viewSize,
			);
		}
	}

	render(width: number) {
		if (this.screen !== "usage") return this.renderEstimatePicker(width);
		const periodEvents = eventsForPeriod(this.events, this.period);
		const selected = periodEvents.filter(
			(event) =>
				(!this.filters.source || event.source === this.filters.source) &&
				(!this.filters.provider || event.provider === this.filters.provider),
		);
		const totals = totalsForPeriod(selected, "all");
		const paygEstimate = this.estimateTarget
			? estimateModelCost(selected, this.estimateTarget)
			: undefined;
		const paygLabel = paygEstimate !== undefined && Number.isFinite(paygEstimate)
			? `$${paygEstimate.toFixed(paygEstimate >= 100 ? 0 : 2)}`
			: undefined;
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
		this.viewSize = width < 100 ? 8 : 15;
		this.cursor = Math.min(this.cursor, Math.max(0, rows.length - 1));
		if (this.cursor < this.offset) this.offset = this.cursor;
		if (this.cursor >= this.offset + this.viewSize) {
			this.offset = this.cursor - this.viewSize + 1;
		}
		const visibleRows = rows.slice(this.offset, this.offset + this.viewSize);
		const breadcrumb = [this.filters.source, this.filters.provider].filter(Boolean).join(" / ");
		const location = breadcrumb ? `${breadcrumb} · ${this.group}` : `grouped by ${this.group}`;

		const rangeLine =
			rows.length > this.viewSize
				? this.theme.fg(
						"dim",
						`Rows ${this.offset + 1}-${Math.min(this.offset + this.viewSize, rows.length)} of ${rows.length}`,
					)
				: undefined;
		const stat = (label: string, value: string) =>
			`${this.theme.fg("dim", label)} ${this.theme.fg("accent", this.theme.bold(value))}`;
		const wideContent = [
			this.theme.fg("accent", this.theme.bold(` Usage · ${this.period} · ${location}`)),
			"",
			this.theme.fg("dim", " ↑↓ select   Enter drill down   e estimate   Esc close"),
			"",
			` ${stat("TOTAL", formatTokens(totals.total))}     ${stat("REQUESTS", this.number.format(totals.requests))}     ${stat("API EQ", costLabel(totals))}     ${stat("CACHE READ", formatTokens(totals.cacheRead))}`,
			...(this.estimateTarget && paygLabel
				? [
						"",
						` ${stat("EST PAYG", paygLabel)}     ${this.theme.fg("dim", `${this.estimateTarget.provider} / ${this.estimateTarget.name} · current catalog rates · recorded cache mix`)}`,
					]
				: []),
			"",
			this.theme.fg(
				"dim",
				"  Name                       Requests  Input  Output  Cache R  Cache W  Reasoning  Cost",
			),
			...visibleRows.map(({ label, totals: rowTotals }, visibleIndex) => {
				const rowIndex = this.offset + visibleIndex;
				const marker = rowIndex === this.cursor ? "›" : " ";
				const line = `${marker} ${label.padEnd(26).slice(0, 26)} ${this.number.format(rowTotals.requests).padStart(8)} ${formatTokens(rowTotals.input).padStart(6)} ${formatTokens(rowTotals.output).padStart(7)} ${formatTokens(rowTotals.cacheRead).padStart(8)} ${formatTokens(rowTotals.cacheWrite).padStart(8)} ${formatTokens(rowTotals.reasoning).padStart(10)}  ${costLabel(rowTotals)}`;
				return rowIndex === this.cursor ? this.theme.fg("accent", line) : line;
			}),
			...(rangeLine ? [rangeLine] : []),
			"",
			this.theme.fg(
				"dim",
				" t today · 7 7d · 3 30d · m month · a all time · o other sources · e estimate",
			),
		];
		const activeRow = rows[this.cursor];
		const compactContent = [
			this.theme.fg("accent", this.theme.bold(` Usage · ${this.period} · ${location}`)),
			` ${formatTokens(totals.total)} total · ${this.number.format(totals.requests)} requests`,
			...(this.estimateTarget && paygLabel
				? [
						"",
						` ${this.theme.fg("accent", `Est PAYG ${paygLabel}`)} · ${this.estimateTarget.provider}/${this.estimateTarget.name}`,
					]
				: []),
			"",
			...visibleRows.map(({ label, totals: rowTotals }, visibleIndex) => {
				const rowIndex = this.offset + visibleIndex;
				const marker = rowIndex === this.cursor ? "›" : " ";
				const line = `${marker} ${label.padEnd(24).slice(0, 24)} ${this.number.format(rowTotals.requests).padStart(7)} req  ${formatTokens(rowTotals.total).padStart(7)}`;
				return rowIndex === this.cursor ? this.theme.fg("accent", line) : line;
			}),
			...(rangeLine ? [rangeLine] : []),
			"",
			...(activeRow
				? [
						this.theme.fg("accent", ` ${activeRow.label}`),
						` Input ${formatTokens(activeRow.totals.input)} · Output ${formatTokens(activeRow.totals.output)} · Requests ${this.number.format(activeRow.totals.requests)}`,
						` Cache R ${formatTokens(activeRow.totals.cacheRead)} · Cache W ${formatTokens(activeRow.totals.cacheWrite)} · Reasoning ${formatTokens(activeRow.totals.reasoning)}`,
						` API eq ${costLabel(activeRow.totals)}`,
					]
				: []),
			"",
			this.theme.fg(
				"dim",
				" ↑↓ select · Enter drill · ← back · o sources · e estimate · Esc close",
			),
		];
		const content = width < 100 ? compactContent : wideContent;
		return this.frame(content, width);
	}

	invalidate() {}
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("usage", {
		description: "Local usage dashboard. Args: today, 7d, 30d, month, all, rebuild",
		handler: async (args, ctx) => {
			const requested = (args ?? "").trim().toLowerCase();
			if (!["", "today", "7d", "30d", "month", "all", "rebuild"].includes(requested)) {
				ctx.ui.notify("Usage: /usage [today|7d|30d|month|all|rebuild]", "error");
				return;
			}
			const period: Period = (["today", "7d", "30d", "month", "all"] as string[]).includes(requested)
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

			const hasCompleteRates = (cost: PriceRates) =>
				[cost?.input, cost?.output, cost?.cacheRead, cost?.cacheWrite].every(Number.isFinite);
			const pricingModels = [
				...new Map(
					ctx.modelRegistry
						.getAll()
						.filter((model) => {
							const cost = model.cost as PriceRates;
							const rates = [cost?.input, cost?.output, cost?.cacheRead, cost?.cacheWrite];
							return (
								hasCompleteRates(cost) &&
								(cost.tiers ?? []).every(hasCompleteRates) &&
								rates.some((rate) => Number(rate) > 0)
							);
						})
						.map((model) => [
							`${model.provider}/${model.id}`,
							{
								provider: model.provider,
								id: model.id,
								name: model.name || model.id,
								cost: model.cost,
							} as PricingModel,
						]),
				).values(),
			];

			await ctx.ui.custom<void>(
				(tui, theme, _keys, done) => {
					const view = new UsageDashboard(result.events, pricingModels, period, done, theme);
					return {
						render: (width: number) => view.render(width),
						invalidate: () => view.invalidate(),
						handleInput: (data: string) => {
							view.handleInput(data);
							tui.requestRender();
						},
					};
				},
				{
					overlay: true,
					overlayOptions: {
						anchor: "center",
						width: "92%",
						minWidth: 48,
						maxHeight: "90%",
						margin: 1,
					},
				},
			);
		},
	});
}
