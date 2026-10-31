import "./guide.css";
import { DEFAULT_BALANCE } from "@frontfall/engine";
import { h, setText } from "./dom.ts";
import { formatCount } from "./format.ts";
import { tutorialText, type TutorialKey } from "./tutorial-text.ts";

/** Every step of the tutorial, in order; each one waits for the player to do it, or to read it and press Next. */
export const STEPS = [
  "start",
  "doctrine",
  "expand",
  "troops",
  "work",
  "citystates",
  "build",
  "port",
  "defend",
  "players",
  "diplomacy",
  "missiles",
  "win",
] as const;
export type Step = (typeof STEPS)[number];

/** The few steps of a first game that is not the tutorial: what a new player needs to last. */
export const FIRST_STEPS: readonly Step[] = [
  "start",
  "doctrine",
  "expand",
  "troops",
  "build",
  "defend",
  "players",
  "win",
];

/** What the guide watches in the game. */
export interface GuideState {
  phase: "spawn" | "play";
  /** The player's land, in tiles. */
  tiles: number;
  /** The player's land when the attacks opened; 0 before. */
  tilesAtPlay: number;
  /** Cities the player owns, built or being built. */
  cities: number;
  /** Ports the player owns, built or being built. */
  ports: number;
  /** Forts the player owns, built or being built. */
  forts: number;
  /** Where the doctrine stands: the game has none, the player may still pick, or they have. */
  doctrine: "none" | "open" | "picked";
  /** Whether the player moved the slider of the share of troops since the guide began. */
  ratioMoved: boolean;
  /** The same for the slider of the workers. */
  workMoved: boolean;
  /** Whether the game has city-states, and whether the player attacked one. */
  cityStates: boolean;
  cityStateAttacked: boolean;
  /** Whether the player asked another player for an alliance, or has an ally. */
  asked: boolean;
  /** The player's gold, for the meter of the steps that cost some. */
  gold: number;
}

/** What the steps quote: the price of the building each one asks for. */
export interface GuideCosts {
  city: number;
  port: number;
  fort: number;
}

/** Steps the player reads, then moves on with Next: no action of theirs shows they are done. */
const READ: ReadonlySet<Step> = new Set(["diplomacy", "missiles", "win"]);

/** Whether the player did what `step` asks, or has gone past it. */
function done(step: Step, state: GuideState): boolean {
  // A building, however far the player was asked to go, means they know the earlier steps.
  const built = state.cities > 0 || state.ports > 0 || state.forts > 0;
  switch (step) {
    case "start":
      return state.tiles > 0;
    case "doctrine":
      // Nothing to pick in a game without doctrines, or once the attacks open.
      return state.doctrine !== "open" || state.phase === "play";
    case "expand":
      return state.phase === "play" && state.tiles > state.tilesAtPlay;
    // Moving a slider is a thing the player may skip: Next, or a building, moves on.
    case "troops":
      return state.ratioMoved || built;
    case "work":
      return state.workMoved || built;
    case "citystates":
      return !state.cityStates || state.cityStateAttacked || built;
    case "build":
      return state.cities > 0;
    case "port":
      return state.ports > 0;
    case "defend":
      return state.forts > 0;
    case "players":
      return state.asked;
    // Read, not done: Next moves on.
    case "diplomacy":
    case "missiles":
    case "win":
      return false;
  }
}

/** The step the player is on once they have done what `step` asks, or `step` itself. */
export function advance(step: Step, state: GuideState, steps: readonly Step[] = STEPS): Step {
  let index = Math.max(0, steps.indexOf(step));
  // A player who already did a later step is not asked for it: it is skipped too.
  while (
    index < steps.length - 1 &&
    !READ.has(steps[index] as Step) &&
    done(steps[index] as Step, state)
  )
    index++;
  return steps[index] as Step;
}

/** What each step points at on screen, the first one that shows: a narrow screen keeps the buildings behind a button. */
const TARGETS: Readonly<Partial<Record<Step, readonly string[]>>> = {
  doctrine: [".doctrine-picker:not([hidden])"],
  troops: ["#attack-ratio"],
  work: ["#work-share"],
  build: ["#build-city", "#build-toggle"],
  port: ["#build-port", "#build-toggle"],
  defend: ["#build-fort", "#build-toggle"],
  players: ["#leaderboard-toggle"],
};

/** The steps that cost gold, and which price each one quotes. */
const COSTLY: Readonly<Partial<Record<Step, keyof GuideCosts>>> = {
  build: "city",
  port: "port",
  defend: "fort",
};

/** Marks the element a step points at; see guide.css. */
const TARGET_CLASS = "guide-target";

/** The text key of a step, for a mouse or a finger; a step with one text for both has no `Touch` form. */
const TOUCH_TEXTS: ReadonlySet<Step> = new Set([
  "start",
  "expand",
  "troops",
  "build",
  "port",
  "defend",
  "players",
]);

/**
 * The tutorial's card: small, out of the way, with one thing to do at a time.
 * It never blocks the game; each step moves on when the player does it, or
 * with Next, and Hide puts the guide away for good. A first game that is not
 * the tutorial shows the few steps of FIRST_STEPS.
 */
export class Guide {
  readonly element: HTMLElement;
  private step: Step;
  private readonly title = h("h2", { class: "guide-title", id: "guide-title" });
  private readonly text = h("p", { class: "guide-text", id: "guide-text" });
  private readonly meterText = h("span", { class: "guide-meter-text" });
  private readonly meterBar = h("progress", { class: "guide-meter-bar", max: 1, value: 0 });
  private readonly meter = h(
    "div",
    { class: "guide-meter", hidden: true },
    this.meterBar,
    this.meterText,
  );
  private readonly next = h("button", { type: "button", class: "secondary", id: "guide-next" });
  private readonly hide = h("button", { type: "button", class: "guide-hide", id: "guide-hide" });
  private costs: GuideCosts = { city: 0, port: 0, fort: 0 };
  /** Whether the attacks have opened: until then the player can only wait, after choosing a start. */
  private waiting = false;
  private target: Element | undefined;

  /**
   * `onComplete`: the player is through the guide or put it away, so it is not shown again.
   * `onFinish`: they went through all of it, and the tutorial says goodbye.
   */
  constructor(
    private readonly touch: boolean,
    private readonly onComplete: () => void,
    private readonly steps: readonly Step[] = STEPS,
    private readonly onFinish: () => void = () => undefined,
  ) {
    this.step = steps[0] as Step;
    this.next.addEventListener("click", () => {
      const index = this.steps.indexOf(this.step);
      if (index >= this.steps.length - 1) {
        this.finish(true);
        return;
      }
      this.show(this.steps[index + 1] as Step);
    });
    this.hide.addEventListener("click", () => {
      this.finish(false);
    });
    this.element = h(
      "section",
      { class: "panel guide", id: "guide", "aria-labelledby": "guide-title" },
      this.title,
      // Read out when the step changes, without taking the focus from the map.
      h("div", { "aria-live": "polite" }, this.text),
      this.meter,
      h("div", { class: "guide-actions" }, this.hide, this.next),
    );
    this.show(this.step);
  }

  /** Follows the game: moves on when the player did what the step asks. */
  update(state: GuideState, costs: GuideCosts): void {
    const step = advance(this.step, state, this.steps);
    const waiting = step === "expand" && state.phase === "spawn";
    const changed =
      step !== this.step ||
      waiting !== this.waiting ||
      this.priced(step, costs) !== this.priced(step, this.costs);
    this.costs = costs;
    this.waiting = waiting;
    if (changed) this.show(step);
    // A narrow screen opens and closes the tray of buildings: the pointer follows.
    else this.point(step);
    this.measure(step, state.gold);
  }

  /** Language changed: the texts again. */
  refresh(): void {
    this.show(this.step);
  }

  private priced(step: Step, costs: GuideCosts): number {
    const key = COSTLY[step];
    return key === undefined ? 0 : costs[key];
  }

  private show(step: Step): void {
    this.step = step;
    const index = this.steps.indexOf(step);
    const last = index === this.steps.length - 1;
    setText(
      this.title,
      `${tutorialText("step", { step: index + 1, count: this.steps.length })} · ${tutorialText(`name.${step}` as TutorialKey)}`,
    );
    const touch = this.touch && TOUCH_TEXTS.has(step);
    const key: TutorialKey =
      step === "expand" && this.waiting
        ? "expandWait"
        : (`${step}${touch ? "Touch" : ""}` as TutorialKey);
    setText(
      this.text,
      tutorialText(key, {
        share: `${String(DEFAULT_BALANCE.winSharePercent)} %`,
      }),
    );
    setText(this.next, tutorialText(last ? "finish" : "next"));
    setText(this.hide, tutorialText("hide"));
    this.meter.hidden = COSTLY[step] === undefined;
    this.element.dataset.step = step;
    this.point(step);
  }

  /** The meter of a step that costs gold: how far the player's gold is from the price. */
  private measure(step: Step, gold: number): void {
    const key = COSTLY[step];
    if (key === undefined) return;
    const cost = this.costs[key];
    const ready = cost > 0 && gold >= cost;
    this.meterBar.max = Math.max(1, cost);
    this.meterBar.value = Math.min(gold, Math.max(1, cost));
    this.meter.classList.toggle("ready", ready);
    setText(
      this.meterText,
      ready
        ? tutorialText("meterReady")
        : tutorialText("meter", { gold: formatCount(gold), cost: formatCount(cost) }),
    );
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

  private finish(completed: boolean): void {
    this.target?.classList.remove(TARGET_CLASS);
    this.element.remove();
    this.onComplete();
    if (completed) this.onFinish();
  }

  /** Whether the guide is still on screen. */
  get shown(): boolean {
    return this.element.isConnected;
  }
}
