import { getLanguage } from "../i18n/index.ts";
import { h, swatch } from "../dom.ts";
import { formatCount, formatDuration, formatPercent } from "./format.ts";
import type { StatsHistory, StatsMark } from "./screen/stats-history.ts";

/** The chart's own words: it loads with the end screen, so they stay out of the first visit's texts. */
const TEXT = {
  en: {
    title: "The game, minute by minute",
    land: "Land",
    troops: "Troops",
    metric: "Show",
    you: "{name} (you)",
    chart:
      "Chart of each player's {metric} over the game. Left and right arrows move through time.",
    goal: "Win at {share}",
    table: "Show as a table",
    player: "Player",
    finalLand: "Land at the end",
    peakLand: "Largest land",
    finalTroops: "Troops at the end",
    allied: "Allied with {name}",
    ended: "Alliance with {name} ended",
    brokeBy: "{name} broke their alliance with you",
    broke: "You broke the alliance with {name}",
    out: "{name} was eliminated",
    outYou: "You were eliminated",
    others: "{count} more players are not drawn.",
  },
  fr: {
    title: "La partie, minute par minute",
    land: "Terres",
    troops: "Troupes",
    metric: "Afficher",
    you: "{name} (vous)",
    chart:
      "Courbes de {metric} de chaque joueur au fil de la partie. Les flèches gauche et droite parcourent le temps.",
    goal: "Victoire à {share}",
    table: "Afficher en tableau",
    player: "Joueur",
    finalLand: "Terres à la fin",
    peakLand: "Plus grand territoire",
    finalTroops: "Troupes à la fin",
    allied: "Allié avec {name}",
    ended: "Alliance avec {name} terminée",
    brokeBy: "{name} a rompu son alliance avec vous",
    broke: "Vous avez rompu l'alliance avec {name}",
    out: "{name} est éliminé",
    outYou: "Vous avez été éliminé",
    others: "{count} autres joueurs ne sont pas tracés.",
  },
} as const;

type TextKey = keyof (typeof TEXT)["en"];

function say(key: TextKey, params: Record<string, string | number> = {}): string {
  let text: string = TEXT[getLanguage()][key];
  for (const [name, value] of Object.entries(params))
    text = text.replace(`{${name}}`, String(value));
  return text;
}

type Metric = "land" | "troops";

/** Lines drawn: the leaders at the end, and the player at this screen. */
const LINES = 6;
/** Rows in the tooltip: the players whose line is closest to the pointer. */
const TIP_ROWS = 3;
const WIDTH = 320;
const HEIGHT = 130;
const PAD = { left: 34, right: 8, top: 8, bottom: 20 };
const SVG = "http://www.w3.org/2000/svg";

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number> = {},
  ...children: SVGElement[]
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  element.append(...children);
  return element;
}

export interface StatsChartOptions {
  history: StatsHistory;
  you: number;
  ownableTiles: number;
  /** Share of the land that wins, in percent. */
  winShare: number;
  color: (player: number) => string;
}

/**
 * Land and troops of each player over the game, as lines. Drawn as SVG by
 * hand; hover, touch and the arrow keys read the values at one moment.
 */
export function statsChart(options: StatsChartOptions): HTMLElement | undefined {
  const { history, you, ownableTiles, winShare, color } = options;
  const count = history.ticks.length;
  if (count < 2) return undefined;
  const last = count - 1;
  const lastTiles = history.tiles[last] as Uint32Array;
  const ids: number[] = [];
  for (let id = 1; id < lastTiles.length; id++) if (history.names[id] !== undefined) ids.push(id);
  // The leaders by what they held at the end, then the player if lower.
  const ranked = [...ids].sort(
    (a, b) => (lastTiles[b] as number) - (lastTiles[a] as number) || a - b,
  );
  const drawn = ranked.slice(0, LINES);
  if (ids.includes(you) && !drawn.includes(you)) drawn.push(you);
  const hidden = ids.length - drawn.length;

  let metric: Metric = "land";
  let cursor = last;

  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const endTick = history.ticks[last] as number;
  const x = (index: number): number =>
    PAD.left +
    (plotW * ((history.ticks[index] as number) - (history.ticks[0] as number))) /
      Math.max(1, endTick - (history.ticks[0] as number));
  const value = (index: number, id: number): number =>
    ((metric === "land" ? history.tiles : history.troops)[index] as Uint32Array)[id] as number;
  const name = (id: number): string =>
    id === you ? say("you", { name: history.names[id] ?? "" }) : (history.names[id] ?? "");

  const plot = svg("g");
  const marksLayer = svg("g");
  const cursorLine = svg("line", { class: "stats-cursor", y1: PAD.top, y2: PAD.top + plotH });
  const dots = svg("g");
  const svgElement = svg(
    "svg",
    {
      viewBox: `0 0 ${String(WIDTH)} ${String(HEIGHT)}`,
      class: "stats-svg",
      "aria-hidden": "true",
    },
    plot,
    marksLayer,
    cursorLine,
    dots,
  );
  const tooltip = h("div", { class: "stats-tooltip", hidden: true });
  const frame = h(
    "div",
    {
      class: "stats-plot",
      tabindex: 0,
      role: "group",
    },
    svgElement,
    tooltip,
  );

  const yMax = (): number => {
    let top = 1;
    for (let i = 0; i < count; i++) for (const id of drawn) top = Math.max(top, value(i, id));
    return top;
  };

  const draw = (): void => {
    plot.replaceChildren();
    const top = yMax();
    const y = (v: number): number => PAD.top + plotH - (plotH * v) / top;
    const label = (v: number): string =>
      metric === "land" ? formatPercent(v / ownableTiles) : formatCount(v);
    for (const fraction of [0, 0.5, 1]) {
      const v = top * fraction;
      plot.append(
        svg("line", {
          class: "stats-grid",
          x1: PAD.left,
          x2: WIDTH - PAD.right,
          y1: y(v),
          y2: y(v),
        }),
        Object.assign(
          svg("text", { class: "stats-axis", x: PAD.left - 4, y: y(v) + 3, "text-anchor": "end" }),
          {
            textContent: label(v),
          },
        ),
      );
    }
    for (const fraction of [0, 0.5, 1]) {
      const tick =
        (history.ticks[0] as number) + fraction * (endTick - (history.ticks[0] as number));
      plot.append(
        Object.assign(
          svg("text", {
            class: "stats-axis",
            x: PAD.left + plotW * fraction,
            y: HEIGHT - 5,
            "text-anchor": fraction === 0 ? "start" : fraction === 1 ? "end" : "middle",
          }),
          { textContent: formatDuration(tick / history.ticksPerSecond) },
        ),
      );
    }
    if (metric === "land") {
      const goal = (ownableTiles * winShare) / 100;
      if (goal <= top) {
        plot.append(
          svg("line", {
            class: "stats-goal",
            x1: PAD.left,
            x2: WIDTH - PAD.right,
            y1: y(goal),
            y2: y(goal),
          }),
          Object.assign(
            svg("text", {
              class: "stats-axis",
              x: WIDTH - PAD.right,
              y: y(goal) - 3,
              "text-anchor": "end",
            }),
            {
              textContent: say("goal", { share: formatPercent(winShare / 100) }),
            },
          ),
        );
      }
    }
    // The player's line is drawn last, on top.
    const order = [...drawn].sort((a, b) => Number(a === you) - Number(b === you));
    const stride = Math.max(1, Math.ceil(count / 200));
    const sampled: number[] = [];
    for (let i = 0; i < last; i += stride) sampled.push(i);
    sampled.push(last);
    for (const id of order) {
      let path = "";
      for (const i of sampled)
        path += `${path ? "L" : "M"}${x(i).toFixed(1)} ${y(value(i, id)).toFixed(1)}`;
      const line = svg("path", { class: id === you ? "stats-line you" : "stats-line", d: path });
      line.style.stroke = color(id);
      plot.append(line);
    }
    // Moments worth a mark, along the time axis.
    marksLayer.replaceChildren(
      ...history.marks.map((mark) => {
        const at = nearest(mark.tick);
        const cx = x(at);
        const base = PAD.top + plotH;
        return svg("path", {
          class: `stats-mark ${mark.kind}`,
          d: `M${cx.toFixed(1)} ${String(base - 1)} l-3 -5 h6 z`,
        });
      }),
    );
    move(cursor, false);
  };

  const nearest = (tick: number): number => {
    let best = 0;
    for (let i = 0; i < count; i++) {
      if (
        Math.abs((history.ticks[i] as number) - tick) <
        Math.abs((history.ticks[best] as number) - tick)
      )
        best = i;
    }
    return best;
  };

  const markText = (mark: StatsMark): string => {
    const other = mark.a === you ? mark.b : mark.a;
    const who = history.names[other] ?? "";
    switch (mark.kind) {
      case "allied":
        return say("allied", { name: who });
      case "ended":
        return say("ended", { name: who });
      case "betrayed":
        return say(mark.a === you ? "broke" : "brokeBy", { name: who });
      case "out":
        return mark.a === you ? say("outYou") : say("out", { name: history.names[mark.a] ?? "" });
    }
  };

  /** Moves the cursor to a sample and tells its values. */
  const move = (index: number, show = true, pointerY?: number): void => {
    cursor = Math.max(0, Math.min(last, index));
    const top = yMax();
    const cx = x(cursor);
    const y = (v: number): number => PAD.top + plotH - (plotH * v) / top;
    cursorLine.setAttribute("x1", String(cx));
    cursorLine.setAttribute("x2", String(cx));
    dots.replaceChildren(
      ...drawn.map((id) => {
        const dot = svg("circle", {
          class: "stats-dot",
          cx,
          cy: PAD.top + plotH - (plotH * value(cursor, id)) / top,
          r: id === you ? 4 : 3,
        });
        dot.style.fill = color(id);
        return dot;
      }),
    );
    // Few rows, so the box never hides much of the chart: those nearest the pointer, or the leaders.
    const here = [...drawn]
      .sort((a, b) =>
        pointerY === undefined
          ? value(cursor, b) - value(cursor, a)
          : Math.abs(y(value(cursor, a)) - pointerY) - Math.abs(y(value(cursor, b)) - pointerY),
      )
      .slice(0, TIP_ROWS)
      .sort((a, b) => value(cursor, b) - value(cursor, a));
    const now = history.ticks[cursor] as number;
    const near = history.marks.filter(
      (mark) =>
        Math.abs(mark.tick - now) <= 3 * 5 * history.ticksPerSecond &&
        nearest(mark.tick) === cursor,
    );
    tooltip.replaceChildren(
      h("strong", {}, formatDuration(now / history.ticksPerSecond)),
      ...here.map((id) =>
        h(
          "div",
          { class: id === you ? "stats-row you" : "stats-row" },
          swatch(color(id)),
          h("span", {}, name(id)),
          h(
            "b",
            {},
            metric === "land"
              ? formatPercent(value(cursor, id) / ownableTiles)
              : formatCount(value(cursor, id)),
          ),
        ),
      ),
      ...near.slice(0, 1).map((mark) => h("em", {}, markText(mark))),
    );
    tooltip.hidden = !show;
    // Left of the cursor when it is in the right half, so the box stays inside the frame.
    tooltip.classList.toggle("left", cx > WIDTH / 2);
    tooltip.style.left = `${String((cx / WIDTH) * 100)}%`;
  };

  const at = (event: PointerEvent): void => {
    const rect = svgElement.getBoundingClientRect();
    if (rect.width === 0) return;
    const sx = ((event.clientX - rect.left) / rect.width) * WIDTH;
    const target =
      (history.ticks[0] as number) +
      ((sx - PAD.left) / plotW) * (endTick - (history.ticks[0] as number));
    move(nearest(target), true, ((event.clientY - rect.top) / rect.height) * HEIGHT);
  };
  frame.addEventListener("pointermove", at);
  frame.addEventListener("pointerdown", at);
  frame.addEventListener("pointerleave", () => {
    if (document.activeElement !== frame) move(last, false);
  });
  frame.addEventListener("focus", () => {
    move(cursor);
  });
  frame.addEventListener("blur", () => {
    move(last, false);
  });
  frame.addEventListener("keydown", (event) => {
    const step = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (step !== 0) move(cursor + step);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(last);
    else return;
    event.preventDefault();
  });

  const tab = (id: Metric): HTMLButtonElement => {
    const button = h(
      "button",
      { type: "button", class: "stats-tab", "aria-pressed": id === metric },
      say(id),
    );
    button.addEventListener("click", () => {
      metric = id;
      for (const other of tabs) other.setAttribute("aria-pressed", String(other === button));
      frame.setAttribute("aria-label", say("chart", { metric: say(id).toLowerCase() }));
      draw();
    });
    return button;
  };
  const tabs = [tab("land"), tab("troops")];
  frame.setAttribute("aria-label", say("chart", { metric: say("land").toLowerCase() }));

  const legend = h(
    "ul",
    { class: "stats-legend" },
    ...drawn.map((id) =>
      h("li", { class: id === you ? "you" : "" }, swatch(color(id)), h("span", {}, name(id))),
    ),
  );

  const rows = [...drawn]
    .sort((a, b) => (lastTiles[b] as number) - (lastTiles[a] as number))
    .map((id) => {
      let peak = 0;
      for (let i = 0; i < count; i++)
        peak = Math.max(peak, (history.tiles[i] as Uint32Array)[id] as number);
      return h(
        "tr",
        {},
        h("th", { scope: "row" }, name(id)),
        h("td", {}, formatPercent((lastTiles[id] as number) / ownableTiles)),
        h("td", {}, formatPercent(peak / ownableTiles)),
        h("td", {}, formatCount((history.troops[last] as Uint32Array)[id] as number)),
      );
    });
  const table = h(
    "details",
    { class: "stats-table" },
    h("summary", {}, say("table")),
    h(
      "table",
      {},
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          h("th", { scope: "col" }, say("player")),
          h("th", { scope: "col" }, say("finalLand")),
          h("th", { scope: "col" }, say("peakLand")),
          h("th", { scope: "col" }, say("finalTroops")),
        ),
      ),
      h("tbody", {}, ...rows),
    ),
  );

  const section = h(
    "section",
    { class: "end-stats-chart", "aria-labelledby": "stats-title" },
    h(
      "div",
      { class: "stats-head" },
      h("h2", { id: "stats-title" }, say("title")),
      h("div", { class: "stats-tabs", role: "group", "aria-label": say("metric") }, ...tabs),
    ),
    frame,
    legend,
    ...(hidden > 0 ? [h("p", { class: "stats-note" }, say("others", { count: hidden }))] : []),
    table,
  );
  draw();
  return section;
}
