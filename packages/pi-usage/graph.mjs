import { freshTokens } from "./core.mjs";

const number = value => Number.isFinite(value) && value > 0 ? value : 0;
const MAX_GRAPH_DAYS = 5000;
const localDay = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const localHour = date => `${localDay(date)} ${String(date.getHours()).padStart(2, "0")}:00`;
const dayStart = date => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const addDays = (date, amount) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
const formatValue = value => value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1_000 ? `${(value / 1_000).toFixed(1)}k` : String(Math.round(value));

function domain(period, now, earliest) {
 const today = dayStart(now);
 if (period === "today") return Array.from({length:now.getHours() + 1}, (_, hour) => new Date(today.getFullYear(), today.getMonth(), today.getDate(), hour));
 let start, days;
 if (period === "7d") { start = addDays(today, -6); days = 7; }
 else if (period === "30d") { start = addDays(today, -29); days = 30; }
 else if (period === "month") { start = new Date(today.getFullYear(), today.getMonth(), 1); days = today.getDate(); }
 else start = earliest ? dayStart(earliest) : undefined;
 if (!start) return [];
 if (days === undefined) {
  const utcDay = date => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  days = Math.floor((utcDay(today) - utcDay(start)) / 86_400_000) + 1;
  if (days > MAX_GRAPH_DAYS) { days = MAX_GRAPH_DAYS; start = addDays(today,-(days-1)); }
 }
 return Array.from({length:Math.max(0, days)}, (_, index) => addDays(start, index));
}

export function bucketEvents(events, period, now = new Date()) {
 const byLabel = new Map();
 for (const event of events) {
  const date = new Date(event.timestamp);
  if (Number.isNaN(date.getTime())) continue;
  const label = period === "today" ? localHour(date) : localDay(date);
  const bucket = byLabel.get(label) || {label, fresh:0, cacheRead:0};
  bucket.fresh += freshTokens(event);
  bucket.cacheRead += number(event.cacheRead);
  byLabel.set(label, bucket);
 }
 const earliestTimestamp = events.reduce((minimum, event) => {
  const timestamp = Number(event.timestamp);
  return Number.isFinite(timestamp) && timestamp < minimum ? timestamp : minimum;
 }, Number.POSITIVE_INFINITY);
 const earliest = Number.isFinite(earliestTimestamp) ? new Date(earliestTimestamp) : undefined;
 return domain(period, now, earliest).map(date => {
  const label = period === "today" ? localHour(date) : localDay(date);
  return byLabel.get(label) || {label, fresh:0, cacheRead:0};
 });
}

export function compressBuckets(buckets, width) {
 const limit = Math.max(1, Math.floor(width));
 if (buckets.length <= limit) return buckets;
 const result = [];
 for (let index = 0; index < limit; index++) {
  const start = Math.floor(index * buckets.length / limit);
  const end = Math.floor((index + 1) * buckets.length / limit);
  const items = buckets.slice(start, Math.max(start + 1, end));
  result.push({
   label: items.length === 1 ? items[0].label : `${items[0].label}…${items.at(-1).label}`,
   fresh: items.reduce((sum, item) => sum + number(item.fresh), 0),
   cacheRead: items.reduce((sum, item) => sum + number(item.cacheRead), 0),
  });
 }
 return result;
}

const dotBits = [[1, 2, 4, 64], [8, 16, 32, 128]];
function setDot(cells, x, y) {
 if (x < 0 || y < 0 || x >= cells.length * 2 || y >= 16) return;
 cells[Math.floor(x / 2)][Math.floor(y / 4)] |= dotBits[x % 2][y % 4];
}
function connect(cells, from, to) {
 const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
 for (let step = 0; step <= steps; step++) setDot(cells, Math.round(from.x + (to.x - from.x) * step / Math.max(1, steps)), Math.round(from.y + (to.y - from.y) * step / Math.max(1, steps)));
}

export function renderBrailleGraph(buckets, metric, width) {
 const usable = Math.max(1, Math.floor(width));
 if (!buckets.length) return ["No data for this selection".slice(0, usable)];
 const axisWidth = usable >= 16 ? 8 : 0;
 const plotCells = Math.max(1, usable - axisWidth - 1);
 const points = compressBuckets(buckets, plotCells * 2);
 const values = points.map(point => number(point[metric]));
 const maximum = Math.max(...values, 0);
 if (maximum === 0) return [`No ${metric === "fresh" ? "Fresh" : "Cache Read"} usage for this selection`.slice(0, usable)];
 const prefix = label => axisWidth ? label.padStart(axisWidth) + "│" : "";
 const cells = Array.from({length:plotCells}, () => [0, 0, 0, 0]);
 let previous;
 values.forEach((value, index) => {
  const point = {x:Math.round(index * (plotCells * 2 - 1) / Math.max(1, values.length - 1)), y:15 - Math.round(value / maximum * 15)};
  if (previous) connect(cells, previous, point); else setDot(cells, point.x, point.y);
  previous = point;
 });
 const rows = [0, 1, 2, 3].map(row => `${prefix(formatValue(maximum * (1 - row / 3)))}${cells.map(cell => String.fromCodePoint(0x2800 + cell[row])).join("")}`.slice(0, usable));
 const start = points[0].label.replace(/^\d{4}-/, "");
 const end = points.at(-1).label.replace(/^\d{4}-/, "");
 const available = Math.max(0, usable - axisWidth);
 const xLabels = start.length + end.length <= available ? `${" ".repeat(axisWidth)}${start}${" ".repeat(Math.max(1, available - start.length - end.length))}${end}` : `${" ".repeat(axisWidth)}${start}`;
 rows.push(xLabels.slice(0, usable));
 return rows;
}
