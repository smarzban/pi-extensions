/**
 * Pac-Man Thinking Extension
 *
 * Replaces pi's streaming working indicator with a Pac-Man animation.
 *
 * Install:
 *   pi install /path/to/pi-extentions/packages/pi-pacman
 *   pi --extension ./index.ts
 *
 * Commands:
 *   /pacman              Show current mode
 *   /pacman list         List all looks
 *   /pacman <look>       Lock to one look (stops rotate)
 *   /pacman rotate       Cycle a different look on every message
 *   /pacman off          Hide indicator (also stops rotate)
 *   /pacman message ...  Custom working message (empty = mode default)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionUIContext,
	WorkingIndicatorOptions,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

// ── palette ──────────────────────────────────────────────────────────
const RESET = "\x1b[39m";
const YELLOW = "\x1b[38;2;255;221;0m";
const PELLET = "\x1b[38;2;255;184;174m";
const POWER = "\x1b[38;2;255;184;255m";
const WALL = "\x1b[38;2;33;33;255m";
const CHERRY = "\x1b[38;2;255;0;0m";
const SCORE = "\x1b[38;2;255;255;255m";
const GHOSTS = {
	blinky: "\x1b[38;2;255;0;0m",
	scared: "\x1b[38;2;33;33;255m",
} as const;

/** Full-width looks (classic / chase) — snappier chomp. */
const FRAME_MS_FULL = 80;
/** Fixed 7-cell looks (mini / arcade / fruit) — a bit slower. */
const FRAME_MS_FIXED = 110;

type Facing = "right" | "left";

interface Look {
	id: string;
	blurb: string;
	message: string;
	/** `track` = number of cells across the strip. */
	frames: (track: number) => string[];
	fullWidth?: boolean;
}

function paint(color: string, text: string): string {
	return `${color}${text}${RESET}`;
}

function pac(open: boolean, facing: Facing = "right"): string {
	if (!open) return paint(YELLOW, "○"); // empty circle = closed mouth
	return paint(YELLOW, facing === "right" ? "ᗧ" : "ᗤ");
}

function pellet(): string {
	return paint(PELLET, "·");
}

function ghost(color: string): string {
	return paint(color, "ᗣ");
}

function power(): string {
	return paint(POWER, "○");
}

function flash(): string {
	return paint(YELLOW, "✦");
}

function cherry(): string {
	return paint(CHERRY, "♦");
}

function termCols(): number {
	const cols = process.stdout.columns || Number(process.env.COLUMNS) || 80;
	return Math.max(20, cols);
}

/** Visible width budget for the indicator strip (cells). */
function indicatorWidth(message: string): number {
	const reserve = Math.max(message.length, 12) + 3;
	return Math.max(8, termCols() - reserve);
}

/** Pac-Man walks right eating pellets across `track` cells, then left. */
function runTrack(track: number): string[] {
	const frames: string[] = [];
	const last = Math.max(1, track - 1);

	for (let i = 0; i <= last; i++) {
		for (const open of [true, false]) {
			let row = "";
			for (let c = 0; c <= last; c++) {
				if (c === i) row += pac(open, "right");
				else if (c > i) row += pellet();
				else row += " ";
			}
			frames.push(row);
		}
	}
	for (let i = last; i >= 0; i--) {
		for (const open of [true, false]) {
			let row = "";
			for (let c = 0; c <= last; c++) {
				if (c === i) row += pac(open, "left");
				else if (c < i) row += pellet();
				else row += " ";
			}
			frames.push(row);
		}
	}
	return frames;
}

// ── looks ────────────────────────────────────────────────────────────

/** Fixed strip length for mini / arcade / fruit (cells). */
const FIXED_CELLS = 7;

const LOOKS: Look[] = [
	{
		id: "classic",
		blurb: "Full-width pellet run — dots span the terminal",
		message: "waka waka...",
		fullWidth: true,
		frames: (track) => runTrack(track),
	},
	{
		id: "chase",
		blurb: "Full-width: Blinky hunts → power pellet → revenge",
		message: "run from blinky...",
		fullWidth: true,
		frames: (track) => {
			const last = Math.max(6, track - 1);
			const gap = Math.max(2, Math.min(5, Math.floor(last / 10)));
			const frames: string[] = [];

			const rowAt = (
				pacPos: number,
				open: boolean,
				facing: Facing,
				ghostPos: number | null,
				ghostColor: string,
				opts?: { powerAt?: number; flash?: boolean },
			) => {
				let row = "";
				for (let c = 0; c <= last; c++) {
					if (opts?.flash && c === pacPos) row += flash();
					else if (c === pacPos) row += pac(open, facing);
					else if (ghostPos !== null && c === ghostPos) row += ghost(ghostColor);
					else if (opts?.powerAt === c) row += power();
					else if (facing === "right" && c > pacPos) row += pellet();
					else if (facing === "left" && c < pacPos) row += pellet();
					else row += " ";
				}
				return row;
			};

			for (let i = gap; i <= last - 1; i++) {
				for (const open of [true, false]) {
					frames.push(rowAt(i, open, "right", i - gap, GHOSTS.blinky));
				}
			}

			frames.push(rowAt(last - 1, true, "right", last - 1 - gap, GHOSTS.blinky, { powerAt: last }));
			frames.push(rowAt(last - 1, false, "right", last - 1 - gap, GHOSTS.blinky, { powerAt: last }));
			frames.push(rowAt(last, true, "right", last - gap, GHOSTS.blinky, { flash: true }));
			frames.push(rowAt(last, false, "right", last - gap, GHOSTS.scared, { flash: true }));

			for (let i = last; i >= 0; i--) {
				for (const open of [true, false]) {
					const gPos = i - gap;
					frames.push(rowAt(i, open, "left", gPos >= 0 ? gPos : null, GHOSTS.scared));
				}
			}
			frames.push(rowAt(0, true, "left", null, GHOSTS.scared, { flash: true }));
			frames.push(" ".repeat(last + 1));
			return frames;
		},
	},
	{
		id: "mini",
		blurb: "7-cell pellet run",
		message: "chomp chomp...",
		frames: () => runTrack(FIXED_CELLS),
	},
	{
		id: "arcade",
		blurb: "7-cell maze tunnel with blue walls",
		message: "insert coin...",
		frames: () => {
			const last = FIXED_CELLS - 1;
			const frames: string[] = [];
			const wall = paint(WALL, "│");
			for (let i = 0; i <= last; i++) {
				for (const open of [true, false]) {
					let mid = "";
					for (let c = 0; c <= last; c++) {
						if (c === i) mid += pac(open, "right");
						else if (c > i) mid += pellet();
						else mid += " ";
					}
					frames.push(`${wall}${mid}${wall}`);
				}
			}
			frames.push(`${wall}${paint(WALL, "≈".repeat(FIXED_CELLS))}${wall}`);
			for (let i = last; i >= 0; i--) {
				for (const open of [true, false]) {
					let mid = "";
					for (let c = 0; c <= last; c++) {
						if (c === i) mid += pac(open, "left");
						else if (c < i) mid += pellet();
						else mid += " ";
					}
					frames.push(`${wall}${mid}${wall}`);
				}
			}
			return frames;
		},
	},
	{
		id: "fruit",
		blurb: "7-cell cherry bonus run",
		message: "fruit bonus...",
		frames: () => {
			const last = FIXED_CELLS - 1;
			const frames: string[] = [];

			// Rightward: cherry waits at the far end
			for (let i = 0; i <= last; i++) {
				for (const open of [true, false]) {
					let row = "";
					for (let c = 0; c <= last; c++) {
						if (c === i && i === last && !open) row += flash();
						else if (c === i) row += pac(open, "right");
						else if (c === last && i < last) row += cherry();
						else if (c > i) row += pellet();
						else row += " ";
					}
					frames.push(row);
				}
			}
			frames.push(`${" ".repeat(Math.max(0, FIXED_CELLS - 3))}${paint(SCORE, "100")}`);
			frames.push(`${" ".repeat(Math.max(0, FIXED_CELLS - 3))}${paint(SCORE, "100")}`);

			// Leftward: cherry waits at the start
			for (let i = last; i >= 0; i--) {
				for (const open of [true, false]) {
					let row = "";
					for (let c = 0; c <= last; c++) {
						if (c === i && i === 0 && !open) row += flash();
						else if (c === i) row += pac(open, "left");
						else if (c === 0 && i > 0) row += cherry();
						else if (c < i) row += pellet();
						else row += " ";
					}
					frames.push(row);
				}
			}
			frames.push(`${paint(SCORE, "300")}${" ".repeat(Math.max(0, FIXED_CELLS - 3))}`);
			frames.push(`${paint(SCORE, "300")}${" ".repeat(Math.max(0, FIXED_CELLS - 3))}`);
			return frames;
		},
	},
];

const LOOK_BY_ID = new Map(LOOKS.map((l) => [l.id, l]));
/** Looks eligible for rotate/random (excludes off/default). */
const ROTATE_LOOKS = LOOKS.map((l) => l.id);

type Mode = string;

interface PersistedState {
	mode?: string;
	/** @deprecated old field — migrated to `rotate` */
	mix?: string;
	rotate?: boolean;
	rotateIndex?: number;
	customMessage?: string;
}

function statePath(): string {
	return join(getAgentDir(), "pacman-thinking.json");
}

function loadState(): PersistedState {
	const path = statePath();
	if (!existsSync(path)) return {};
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as PersistedState;
	} catch {
		return {};
	}
}

function saveState(state: PersistedState): void {
	const path = statePath();
	try {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${JSON.stringify(state, null, "\t")}\n`, "utf-8");
	} catch {
		// Non-fatal — indicator still works without persistence
	}
}

function resolveTrack(look: Look, message: string): number {
	if (look.fullWidth) return indicatorWidth(message);
	return FIXED_CELLS;
}

function getIndicator(mode: Mode, message: string): WorkingIndicatorOptions | undefined {
	if (mode === "off") return { frames: [] };
	const look = LOOK_BY_ID.get(mode);
	if (!look) return undefined;
	const track = resolveTrack(look, message);
	const intervalMs = look.fullWidth ? FRAME_MS_FULL : FRAME_MS_FIXED;
	return { frames: look.frames(track), intervalMs };
}

function describeMode(mode: Mode): string {
	if (mode === "off") return "hidden";
	const look = LOOK_BY_ID.get(mode);
	return look ? `${look.id} — ${look.blurb}` : mode;
}

function defaultMessageFor(mode: Mode): string | undefined {
	if (mode === "off") return " ";
	return LOOK_BY_ID.get(mode)?.message;
}

function listLooks(): string {
	const lines = LOOKS.map((l) => {
		const tag = l.fullWidth ? " (full width)" : "";
		return `  ${l.id.padEnd(8)} ${l.blurb}${tag}`;
	});
	return [
		"Pac-Man looks:",
		...lines,
		"",
		"  rotate   Different look each message (cycle)",
		"  off      Hide indicator",
		"",
		"Pick a look name to lock it (stops rotate).",
	].join("\n");
}

export default function (pi: ExtensionAPI) {
	const saved = loadState();
	// Migrate old persisted values
	const savedMode =
		saved.mode === "default" || saved.mode === "random" || saved.mode === "score"
			? "classic"
			: saved.mode;
	let mode: Mode =
		savedMode && (LOOK_BY_ID.has(savedMode) || savedMode === "off") ? savedMode : "classic";
	let rotate =
		typeof saved.rotate === "boolean"
			? saved.rotate
			: saved.mix === "rotate"; // migrate old mix field
	let rotateIndex =
		typeof saved.rotateIndex === "number" && saved.rotateIndex >= 0 ? saved.rotateIndex : 0;
	let customMessage: string | undefined =
		typeof saved.customMessage === "string" && saved.customMessage.length > 0
			? saved.customMessage
			: undefined;
	let lastUi: ExtensionUIContext | undefined;

	const persist = () => {
		saveState({
			mode,
			rotate,
			rotateIndex,
			customMessage,
		});
	};

	const statusLabel = () => {
		if (mode === "off") return `ᗧ off`;
		return `ᗧ ${mode}${rotate ? " ↻" : ""}`;
	};

	const apply = (ctx: ExtensionContext) => {
		lastUi = ctx.ui;
		const message = customMessage ?? defaultMessageFor(mode) ?? "Working...";
		ctx.ui.setWorkingIndicator(getIndicator(mode, message));
		ctx.ui.setWorkingMessage(mode === "off" ? " " : message);
		ctx.ui.setStatus("pacman-thinking", ctx.ui.theme.fg("dim", statusLabel()));
		persist();
	};

	const isFullWidthMode = () => LOOK_BY_ID.get(mode)?.fullWidth === true;

	const pickNextRotatedLook = () => {
		mode = ROTATE_LOOKS[rotateIndex % ROTATE_LOOKS.length]!;
		rotateIndex++;
	};

	const reapplyIfFullWidth = () => {
		if (!lastUi || !isFullWidthMode()) return;
		const message = customMessage ?? defaultMessageFor(mode) ?? "Working...";
		lastUi.setWorkingIndicator(getIndicator(mode, message));
	};

	process.stdout.on?.("resize", reapplyIfFullWidth);

	pi.on("session_start", async (_event, ctx) => {
		// Don't advance rotate here — agent_start picks per message.
		apply(ctx);
	});

	pi.on("agent_start", async (_event, ctx) => {
		if (rotate) {
			pickNextRotatedLook();
			apply(ctx);
			return;
		}
		if (isFullWidthMode()) apply(ctx);
	});

	pi.registerCommand("pacman", {
		description: "Pac-Man indicator. Try: /pacman list · /pacman rotate",
		handler: async (args, ctx) => {
			const raw = args.trim();
			if (!raw) {
				const msg = customMessage ?? defaultMessageFor(mode) ?? "Working...";
				const extra = isFullWidthMode()
					? ` · width ${indicatorWidth(msg)} cells`
					: LOOK_BY_ID.has(mode)
						? ` · width ${FIXED_CELLS} cells`
						: "";
				const rotInfo = rotate ? " · rotate on" : "";
				ctx.ui.notify(
					`Pac-Man: ${describeMode(mode)}${rotInfo} · message: "${msg}"${extra}`,
					"info",
				);
				return;
			}

			const [cmd, ...rest] = raw.split(/\s+/);
			const head = cmd!.toLowerCase();

			if (head === "list" || head === "help" || head === "looks") {
				ctx.ui.setWidget("pacman-looks", listLooks().split("\n"), { placement: "belowEditor" });
				ctx.ui.notify(
					"Looks listed below the editor. /pacman <name> to switch. /pacman clear to hide list.",
					"info",
				);
				return;
			}

			if (head === "clear") {
				ctx.ui.setWidget("pacman-looks", undefined);
				ctx.ui.notify("Cleared look list", "info");
				return;
			}

			if (head === "message") {
				const text = rest.join(" ").trim();
				customMessage = text.length > 0 ? text : undefined;
				apply(ctx);
				ctx.ui.notify(
					customMessage
						? `Working message set to: ${customMessage}`
						: "Working message reset to mode default",
					"info",
				);
				return;
			}

			if (head === "rotate" || head === "cycle") {
				rotate = true;
				const idx = ROTATE_LOOKS.indexOf(mode);
				rotateIndex = idx >= 0 ? idx : 0;
				pickNextRotatedLook();
				apply(ctx);
				ctx.ui.notify(
					`Pac-Man rotate on — cycles each message (now: ${mode}). Pick a look to lock it.`,
					"info",
				);
				return;
			}

			if (head === "off" || head === "none" || head === "hide") {
				rotate = false;
				mode = "off";
				ctx.ui.setWidget("pacman-looks", undefined);
				apply(ctx);
				ctx.ui.notify("Pac-Man indicator hidden", "info");
				return;
			}

			if (!LOOK_BY_ID.has(head)) {
				ctx.ui.notify(`Unknown look "${head}". Try /pacman list`, "error");
				return;
			}

			// Picking a look locks it and stops rotate
			rotate = false;
			mode = head;
			ctx.ui.setWidget("pacman-looks", undefined);
			apply(ctx);
			ctx.ui.notify(`Pac-Man indicator: ${describeMode(mode)}`, "info");
		},
	});
}
