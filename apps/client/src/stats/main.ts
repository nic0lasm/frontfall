// The public statistics page: the charts of /api/stats, or of a saved copy of it.
// It imports nothing from the game, so the game's first download stays as it is.
import "./stats.css";
import { readStats, type Bar, type Charts } from "./stats.ts";

const SVG = "http://www.w3.org/2000/svg";
const WIDTH = 360;
const LABEL_WIDTH = 96;
const VALUE_WIDTH = 44;
const ROW = 22;
const COLUMNS_HEIGHT = 120;

function svgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number>,
  text?: string,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  if (text !== undefined) element.textContent = text;
  return element;
}

const plural = (count: number): string => `${String(count)} game${count === 1 ? "" : "s"}`;

/** One row per bar, its value written after it: colour is never the only cue. */
function rows(bars: Bar[]): SVGSVGElement {
  const svg = svgElement("svg", { viewBox: `0 0 ${String(WIDTH)} ${String(bars.length * ROW)}` });
  const max = Math.max(1, ...bars.map((bar) => bar.value));
  const room = WIDTH - LABEL_WIDTH - VALUE_WIDTH;
  bars.forEach((bar, index) => {
    const y = index * ROW;
    const length = Math.max(1, Math.round((bar.value / max) * room));
    svg.append(
      svgElement("text", { x: LABEL_WIDTH - 6, y: y + 15, "text-anchor": "end" }, bar.label),
      svgElement("rect", { x: LABEL_WIDTH, y: y + 4, width: length, height: ROW - 8, rx: 2 }),
      svgElement("text", { x: LABEL_WIDTH + length + 6, y: y + 15 }, String(bar.value)),
    );
  });
  return svg;
}

/** One column per day; each names its day and count, and the axis gives the extremes. */
function columns(bars: Bar[]): SVGSVGElement {
  const height = COLUMNS_HEIGHT + 20;
  const svg = svgElement("svg", { viewBox: `0 0 ${String(WIDTH)} ${String(height)}` });
  const max = Math.max(1, ...bars.map((bar) => bar.value));
  const step = (WIDTH - VALUE_WIDTH) / bars.length;
  bars.forEach((bar, index) => {
    const size = Math.round((bar.value / max) * COLUMNS_HEIGHT);
    const column = svgElement("rect", {
      x: VALUE_WIDTH + index * step + step * 0.1,
      y: COLUMNS_HEIGHT - size,
      width: step * 0.8,
      height: size,
    });
    column.append(svgElement("title", {}, `${bar.label}: ${plural(bar.value)}`));
    svg.append(column);
  });
  svg.append(
    svgElement("text", { x: VALUE_WIDTH - 6, y: 10, "text-anchor": "end" }, String(max)),
    svgElement("text", { x: VALUE_WIDTH - 6, y: COLUMNS_HEIGHT, "text-anchor": "end" }, "0"),
    svgElement("text", { x: VALUE_WIDTH, y: height - 4 }, bars[0]?.label ?? ""),
    svgElement("text", { x: WIDTH, y: height - 4, "text-anchor": "end" }, bars.at(-1)?.label ?? ""),
  );
  return svg;
}

function chart(title: string, bars: Bar[], draw: (bars: Bar[]) => SVGSVGElement): HTMLElement {
  const figure = document.createElement("figure");
  const caption = document.createElement("figcaption");
  caption.textContent = title;
  figure.append(caption);
  if (bars.length === 0) {
    const none = document.createElement("p");
    none.textContent = "No game counted yet.";
    figure.append(none);
  } else {
    figure.append(draw(bars));
  }
  return figure;
}

const charts = document.querySelector<HTMLElement>("#charts");
const status = document.querySelector<HTMLElement>("#status");
const picker = document.querySelector<HTMLInputElement>("#saved");

function show(stats: Charts, source: string): void {
  if (!charts || !status) return;
  const total = stats.perDay.reduce((sum, bar) => sum + bar.value, 0);
  status.textContent =
    `${source}: ${plural(total)} over the last ${String(stats.perDay.length)} days` +
    (stats.since ? `, counted since ${stats.since}` : "") +
    (stats.release ? `, release ${stats.release}.` : ".");
  charts.replaceChildren(
    chart("Games per day", stats.perDay, columns),
    chart("Maps played, in total", stats.maps, rows),
    chart("Game length in minutes, in total", stats.minutes, rows),
  );
}

function fail(message: string): void {
  if (status) status.textContent = message;
  if (picker) picker.hidden = false;
}

picker?.addEventListener("change", () => {
  const file = picker.files?.[0];
  if (!file) return;
  void file
    .text()
    .then((text) => {
      show(readStats(JSON.parse(text)), file.name);
    })
    .catch((error: unknown) => {
      fail(
        `${file.name} could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
});

// Relative, so that the page works behind a path prefix such as /frontfall/.
fetch("api/stats")
  .then(async (response) => {
    if (!response.ok) throw new Error(`the server answered ${String(response.status)}`);
    show(readStats(await response.json()), "This server");
  })
  .catch((error: unknown) => {
    fail(
      `No figures from the server (${error instanceof Error ? error.message : String(error)}). ` +
        "Open a saved copy of /api/stats instead:",
    );
  });
