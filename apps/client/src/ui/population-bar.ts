import { DEFAULT_BALANCE, troopGrowth } from "@frontfall/engine";
import { t } from "../i18n/index.ts";
import { h } from "./dom.ts";
import { formatCount } from "./format.ts";

/** The band is where troops grow at least this share of their fastest. */
const BAND_SHARE = 0.85;

/** The fills, from 0 to 1, where an army under `cap` grows near its fastest (R-ECO-02). */
export function growthBand(cap: number): { from: number; to: number } {
  if (cap <= 0) return { from: 0, to: 0 };
  const steps = 100;
  const values = Array.from({ length: steps + 1 }, (_, i) =>
    troopGrowth(DEFAULT_BALANCE, cap, Math.floor((cap * i) / steps)),
  );
  const best = Math.max(...values);
  const inside = values.flatMap((value, i) => (value >= best * BAND_SHARE ? [i / steps] : []));
  return { from: inside[0] ?? 0, to: inside.at(-1) ?? 0 };
}

/**
 * How the player's troops grow: their army against its cap, the band where
 * it grows fastest, and the troops it gains each second. A press explains it.
 */
export class PopulationBar {
  readonly element: HTMLButtonElement;
  private readonly fill = h("span", { class: "pop-fill" });
  private readonly band = h("span", { class: "pop-band" });
  private readonly rate = h("span", { class: "pop-rate" });
  private span = { from: 0, to: 0 };
  private bandCap = -1;

  constructor(onExplain: (text: string) => void) {
    this.element = h(
      "button",
      { type: "button", class: "pop-bar", "aria-describedby": "build-tip" },
      h("span", { class: "pop-track", "aria-hidden": "true" }, this.fill, this.band),
      h("span", { class: "pop-figures" }, this.rate),
    );
    // A finger has no tooltip: a press shows the figures, which a phone hides, and how growth works.
    this.element.addEventListener("click", () => {
      onExplain(`${this.element.getAttribute("aria-label") ?? ""} ${t("hud.growthHelp")}`);
    });
  }

  /** Where the band lies for a cap; it moves with the cap, so it is drawn again when the cap changes. */
  private place(cap: number): void {
    if (cap === this.bandCap) return;
    this.bandCap = cap;
    this.span = growthBand(cap);
    const { from, to } = this.span;
    this.band.style.left = `${String(from * 100)}%`;
    this.band.style.width = `${String((to - from) * 100)}%`;
  }

  update(troops: number, cap: number, growth: number): void {
    this.place(cap);
    const fill = cap > 0 ? Math.min(1, troops / cap) : 0;
    this.fill.style.width = `${String(fill * 100)}%`;
    const { from, to } = this.span;
    this.element.classList.toggle("in-band", growth > 0 && fill >= from && fill <= to);
    this.element.classList.toggle("full", growth === 0 && fill >= 1);
    const count = formatCount(growth);
    this.rate.textContent = t("hud.growthRate", { troops: count });
    // The name starts with the figures shown, so a voice command can name the button by them.
    this.element.setAttribute("aria-label", t("hud.growthNow", { troops: count }));
    this.element.title = t("hud.growthHelp");
  }
}
