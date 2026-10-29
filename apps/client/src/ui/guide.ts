import "./guide.css";
import { applyTranslations, type MessageKey } from "../i18n/index.ts";
import { h } from "./dom.ts";
import { formatCount } from "./format.ts";

/** The steps of a first game, in order; each one waits for the player to do it. */
export const STEPS = ["start", "expand", "troops", "build", "defend", "players", "done"] as const;
export type Step = (typeof STEPS)[number];

/** What the guide watches in the game. */
export interface GuideState {
  phase: "spawn" | "play";
  /** The player's land, in tiles. */
  tiles: number;
  /** The player's land when the attacks opened; 0 before. */
  tilesAtPlay: number;
  /** Cities the player owns, built or being built. */
  cities: number;
  /** Forts the player owns, built or being built. */
  forts: number;
  /** Whether the player moved the slider of the share of troops since the guide began. */
  ratioMoved: boolean;
  /** Whether the menu of another player is open. */
  playerMenu: boolean;
}

/** What the steps quote: the price of the building they ask for. */
export interface GuideCosts {
  city: number;
}

/** The step the player is on once they have done what `step` asks, or `step` itself. */
export function advance(step: Step, state: GuideState): Step {
  const done: Record<Step, boolean> = {
    start: state.tiles > 0,
    expand: state.phase === "play" && state.tiles > state.tilesAtPlay,
    // Moving the slider is the one thing here the player may skip: Next, or a building, moves on.
    troops: state.ratioMoved || state.cities > 0 || state.forts > 0,
    build: state.cities > 0,
    defend: state.forts > 0,
    players: state.playerMenu,
    done: false,
  };
  let index = STEPS.indexOf(step);
  // A player who already did a later step is not asked for it: it is skipped too.
  while (done[STEPS[index] as Step] && index < STEPS.length - 1) index++;
  return STEPS[index] as Step;
}

const TEXTS: Readonly<Record<Step, { mouse: MessageKey; touch: MessageKey }>> = {
  start: { mouse: "guide.start", touch: "guide.startTouch" },
  expand: { mouse: "guide.expand", touch: "guide.expandTouch" },
  troops: { mouse: "guide.troops", touch: "guide.troopsTouch" },
  build: { mouse: "guide.build", touch: "guide.buildTouch" },
  defend: { mouse: "guide.defend", touch: "guide.defendTouch" },
  players: { mouse: "guide.players", touch: "guide.playersTouch" },
  done: { mouse: "guide.done", touch: "guide.doneTouch" },
};

/** What each step points at on screen, the first one that shows: a narrow screen keeps the buildings behind a button. */
const TARGETS: Readonly<Partial<Record<Step, readonly string[]>>> = {
  troops: ["#attack-ratio"],
  build: ["#build-city", "#build-toggle"],
  defend: ["#build-fort", "#build-toggle"],
  players: ["#leaderboard-toggle"],
};

/** Marks the element a step points at; see guide.css. */
const TARGET_CLASS = "guide-target";

/**
 * First steps for a new player: a small card, out of the way, with one thing
 * to do at a time. It never blocks the game; each step moves on when the
 * player does it, or with Next, and Hide puts the guide away for good.
 */
export class Guide {
  readonly element: HTMLElement;
  private step: Step = "start";
  private readonly title = h("h2", { class: "guide-title", id: "guide-title" });
  private readonly text = h("p", { class: "guide-text", id: "guide-text" });
  private readonly next = h("button", { type: "button", class: "secondary", id: "guide-next" });
  private readonly hide = h("button", {
    type: "button",
    class: "guide-hide",
    id: "guide-hide",
    "data-i18n": "guide.hide",
  });
  private costs: GuideCosts = { city: 0 };
  /** Whether the attacks have opened: until then the player can only wait, after choosing a start. */
  private waiting = false;
  private target: Element | undefined;

  /** `onComplete`: the player is through the guide or put it away, so it is not shown again. */
  constructor(
    private readonly touch: boolean,
    private readonly onComplete: () => void,
  ) {
    this.next.addEventListener("click", () => {
      if (this.step === "done") {
        this.finish();
        return;
      }
      this.show(STEPS[STEPS.indexOf(this.step) + 1] as Step);
    });
    this.hide.addEventListener("click", () => {
      this.finish();
    });
    this.element = h(
      "section",
      { class: "panel guide", id: "guide", "aria-labelledby": "guide-title" },
      this.title,
      // Read out when the step changes, without taking the focus from the map.
      h("div", { "aria-live": "polite" }, this.text),
      h("div", { class: "guide-actions" }, this.hide, this.next),
    );
    this.show("start");
  }

  /** Follows the game: moves on when the player did what the step asks. */
  update(state: GuideState, costs: GuideCosts): void {
    const step = advance(this.step, state);
    const costChanged = step === "build" && costs.city !== this.costs.city;
    const waiting = step === "expand" && state.phase === "spawn";
    const waitChanged = waiting !== this.waiting;
    this.costs = costs;
    this.waiting = waiting;
    if (step !== this.step || costChanged || waitChanged) this.show(step);
    // A narrow screen opens and closes the tray of buildings: the pointer follows.
    else this.point(step);
  }

  /** Language changed: the texts again. */
  refresh(): void {
    this.show(this.step);
  }

  private show(step: Step): void {
    this.step = step;
    const number = STEPS.indexOf(step) + 1;
    this.title.dataset.i18n = "guide.title";
    this.title.dataset.i18nParams = JSON.stringify({
      step: Math.min(number, STEPS.length - 1),
      count: STEPS.length - 1,
    });
    this.text.dataset.i18n =
      step === "expand" && this.waiting
        ? "guide.expandWait"
        : TEXTS[step][this.touch ? "touch" : "mouse"];
    this.text.dataset.i18nParams = JSON.stringify({ cost: formatCount(this.costs.city) });
    this.next.dataset.i18n = step === "done" ? "guide.close" : "guide.next";
    this.hide.hidden = step === "done";
    this.element.dataset.step = step;
    applyTranslations(this.element);
    this.point(step);
    if (step === "done") this.onComplete();
  }

  /** Lights the control the step asks the player to use, and only that one. */
  private point(step: Step): void {
    const next = (TARGETS[step] ?? [])
      .map((selector) => document.querySelector(selector))
      .find((element) => element && element.getClientRects().length > 0);
    if (next === this.target) return;
    this.target?.classList.remove(TARGET_CLASS);
    next?.classList.add(TARGET_CLASS);
    this.target = next ?? undefined;
  }

  private finish(): void {
    this.target?.classList.remove(TARGET_CLASS);
    this.element.remove();
    this.onComplete();
  }

  /** Whether the guide is still on screen. */
  get shown(): boolean {
    return this.element.isConnected;
  }
}
