/**
 * Pac-Man Thinking Extension
 *
 * Replaces pi's streaming working indicator with a Pac-Man animation.
 *
 * Install:
 *   pi install /path/to/pi-extensions/packages/pi-pacman
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
const GHOSTS = {
	blinky: "\x1b[38;2;255;0;0m",
	scared: "\x1b[38;2;33;33;255m",
} as const;

/** Full-width looks (classic / chase) — snappier chomp. */
const FRAME_MS_FULL = 80;
/** Fixed-width looks (mini / arcade / fruit) — a bit slower. */
const FRAME_MS_FIXED = 110;
/** Default strip length for mini / arcade / fruit (cells). Overridable via config. */
const DEFAULT_CELLS = 10;
const CELLS_MIN = 4;
const CELLS_MAX = 40;

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

function clampCells(n: number): number {
	if (!Number.isFinite(n)) return DEFAULT_CELLS;
	return Math.max(CELLS_MIN, Math.min(CELLS_MAX, Math.round(n)));
}

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
		blurb: "fixed-width pellet run",
		message: "chomp chomp...",
		frames: (track) => runTrack(track),
	},
	{
		id: "arcade",
		blurb: "fixed-width maze tunnel with blue walls",
		message: "insert coin...",
		frames: (track) => {
			const last = track - 1;
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
			frames.push(`${wall}${paint(WALL, "≈".repeat(track))}${wall}`);
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
		blurb: "fixed-width cherry bonus run",
		message: "fruit bonus...",
		frames: (track) => {
			const last = track - 1;
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
			return frames;
		},
	},
];

const LOOK_BY_ID = new Map(LOOKS.map((l) => [l.id, l]));
/** Rotate only cycles short looks — full-width classic/chase stay opt-in via /pacman <look>. */
const ROTATE_LOOKS = LOOKS.filter((l) => !l.fullWidth).map((l) => l.id);

/** Fun working-line blurbs; one is picked at random each agent turn (unless custom message). */
const MESSAGE_POOL = [
	"waka waka...",
	"chomp chomp...",
	"nom nom nom...",
	"pellet run...",
	"extra life...",
	"maze clear...",
	"level up...",
	"thinking in 8-bit...",
	"chomping tokens...",
	"munching context...",
	"dot duty...",
	"blinky inbound...",
	"still hungry...",
	"just one more pellet...",
	"pac-ing thoughts...",
	"busy in the maze...",
	"sampling next token...",
	"warming up the weights...",
	"attention is all you need...",
	"prompt cache go brrr...",
	"context window snacking...",
	"tool call pending...",
	"reasoning tokens burning...",
	"embedding the maze...",
	"softmaxing vibes...",
	"gradient descending...",
	"hallucinating less... hopefully...",
	"compacting the snack tray...",
	"waiting on the model...",
	"streaming tokens...",
	"fine-tuning my appetite...",
	"loading more context...",
	"thinking tokens go chomp...",
	"RAG-ing the pellets...",
	"temperature set to spicy...",
	"beam search for snacks...",
];

type Mode = string;

interface PersistedState {
	mode?: string;
	/** @deprecated old field — migrated to `rotate` */
	mix?: string;
	rotate?: boolean;
	rotateIndex?: number;
	customMessage?: string;
	/** Fixed strip length for mini / arcade / fruit (cells). Default 10. */
	cells?: number;
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

function resolveTrack(look: Look, message: string, cells: number): number {
	if (look.fullWidth) return indicatorWidth(message);
	return cells;
}

function getIndicator(
	mode: Mode,
	message: string,
	cells: number,
): WorkingIndicatorOptions | undefined {
	if (mode === "off") return { frames: [] };
	const look = LOOK_BY_ID.get(mode);
	if (!look) return undefined;
	const track = resolveTrack(look, message, cells);
	const intervalMs = look.fullWidth ? FRAME_MS_FULL : FRAME_MS_FIXED;
	return { frames: look.frames(track), intervalMs };
}

function describeMode(mode: Mode): string {
	if (mode === "off") return "hidden";
	const look = LOOK_BY_ID.get(mode);
	return look ? `${look.id} — ${look.blurb}` : mode;
}

function pickRandomMessage(previous?: string): string {
	const pool =
		previous && MESSAGE_POOL.length > 1
			? MESSAGE_POOL.filter((m) => m !== previous)
			: MESSAGE_POOL;
	return pool[Math.floor(Math.random() * pool.length)]!;
}

function listLooks(): string {
	const lines = LOOKS.map((l) => {
		const tag = l.fullWidth ? " (full width)" : "";
		const rot = !l.fullWidth ? " · in rotate" : "";
		return `  ${l.id.padEnd(8)} ${l.blurb}${tag}${rot}`;
	});
	return [
		"Pac-Man looks:",
		...lines,
		"",
		"  rotate   Cycle short looks each message (mini/arcade/fruit)",
		"  off      Hide indicator",
		"",
		"Working text is random each run (unless /pacman message …).",
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
	let cells =
		typeof saved.cells === "number" ? clampCells(saved.cells) : DEFAULT_CELLS;
	/** Last auto-picked blurb (not persisted); used to avoid immediate repeats. */
	let autoMessage: string = pickRandomMessage();
	let lastUi: ExtensionUIContext | undefined;

	const persist = () => {
		saveState({
			mode,
			rotate,
			rotateIndex,
			customMessage,
			cells,
		});
	};

	const statusLabel = () => {
		if (mode === "off") return `ᗧ off`;
		return `ᗧ ${mode}${rotate ? " ↻" : ""}`;
	};

	const workingMessage = (): string => {
		if (mode === "off") return " ";
		if (customMessage) return customMessage;
		return autoMessage;
	};

	const refreshAutoMessage = () => {
		if (customMessage) return;
		autoMessage = pickRandomMessage(autoMessage);
	};

	const apply = (ctx: ExtensionContext) => {
		lastUi = ctx.ui;
		const message = workingMessage();
		ctx.ui.setWorkingIndicator(getIndicator(mode, message, cells));
		ctx.ui.setWorkingMessage(message);
		ctx.ui.setStatus("pacman-thinking", ctx.ui.theme.fg("dim", statusLabel()));
		persist();
	};

	const isFullWidthMode = () => LOOK_BY_ID.get(mode)?.fullWidth === true;

	const pickNextRotatedLook = () => {
		if (ROTATE_LOOKS.length === 0) return;
		mode = ROTATE_LOOKS[rotateIndex % ROTATE_LOOKS.length]!;
		rotateIndex++;
	};

	const reapplyIfFullWidth = () => {
		if (!lastUi || !isFullWidthMode()) return;
		const message = workingMessage();
		lastUi.setWorkingIndicator(getIndicator(mode, message, cells));
	};

	process.stdout.on?.("resize", reapplyIfFullWidth);

	pi.on("session_start", async (_event, ctx) => {
		// Don't advance rotate here — agent_start picks per message.
		refreshAutoMessage();
		apply(ctx);
	});

	pi.on("agent_start", async (_event, ctx) => {
		// Fresh random blurb every run (unless user set /pacman message)
		refreshAutoMessage();
		if (rotate) {
			pickNextRotatedLook();
			apply(ctx);
			return;
		}
		// Always re-apply so the new message (and full-width width) stick
		apply(ctx);
	});

	pi.on("session_shutdown", async () => {
		// Drop the resize listener so reloads don't stack duplicates.
		process.stdout.off?.("resize", reapplyIfFullWidth);
	});

	pi.registerCommand("pacman", {
		description: "Pac-Man indicator. Try: /pacman list · /pacman rotate",
		handler: async (args, ctx) => {
			const raw = args.trim();
			if (!raw) {
				const msg = workingMessage();
				const extra = isFullWidthMode()
					? ` · width ${indicatorWidth(msg)} cells`
					: LOOK_BY_ID.has(mode)
						? ` · width ${cells} cells`
						: "";
				const rotInfo = rotate ? " · rotate on (short looks)" : "";
				const msgMode = customMessage ? "custom" : "auto";
				ctx.ui.notify(
					`Pac-Man: ${describeMode(mode)}${rotInfo} · cells ${cells} · message (${msgMode}): "${msg}"${extra}`,
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
				if (!customMessage) refreshAutoMessage();
				apply(ctx);
				ctx.ui.notify(
					customMessage
						? `Working message locked to: ${customMessage}`
						: `Working message is auto again (now: "${autoMessage}")`,
					"info",
				);
				return;
			}

			if (head === "cells" || head === "width") {
				const rawN = rest[0]?.trim();
				if (!rawN) {
					ctx.ui.notify(
						`Pac-Man cells: ${cells} (default ${DEFAULT_CELLS}, range ${CELLS_MIN}–${CELLS_MAX}). Set with /pacman cells <n> or in ~/.pi/agent/pacman-thinking.json`,
						"info",
					);
					return;
				}
				const n = Number(rawN);
				if (!Number.isFinite(n)) {
					ctx.ui.notify(`Invalid cells "${rawN}". Use a number ${CELLS_MIN}–${CELLS_MAX}.`, "error");
					return;
				}
				cells = clampCells(n);
				apply(ctx);
				ctx.ui.notify(`Pac-Man short-look width: ${cells} cells`, "info");
				return;
			}

			if (head === "rotate" || head === "cycle") {
				rotate = true;
				// Only short looks participate; jump into that cycle cleanly
				const idx = ROTATE_LOOKS.indexOf(mode);
				rotateIndex = idx >= 0 ? idx : 0;
				pickNextRotatedLook();
				refreshAutoMessage();
				apply(ctx);
				ctx.ui.notify(
					`Pac-Man rotate on — short looks only: ${ROTATE_LOOKS.join(", ")} (now: ${mode}).`,
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
