import { DEFAULT_BALANCE } from "@frontfall/engine";
import { attackPreview, goldPerSecond } from "../game/attack-preview.ts";
import type { GameRules } from "../game/messages.ts";
import type { ClickMode, GameUpdate, PlayerView } from "../game/solo-game.ts";
import { applyTranslations, plural, t, type MessageKey } from "../i18n/index.ts";
import { colorOf } from "../palette.ts";
import { h } from "./dom.ts";
import { formatCount, formatDuration, formatPercent } from "./format.ts";
import { icon } from "./icons.ts";
import { LeaderList } from "./leader-list.ts";
import { PopulationBar } from "./population-bar.ts";
import { BUILD_MODES, costOf, numberOf, offers } from "./build-modes.ts";
import { workText } from "./work-text.ts";

// Also found here, where it was first defined.
export { offers };

/** B-ATTACK-RATIO-MIN and the interface default of R-ATTACK-02, in percent. */
export const MIN_RATIO = 5;
export const DEFAULT_RATIO = 30;
/** Steps of the work share slider (R-ECO-07), in percent: fine enough, and easy to hit with a finger. */
const WORK_STEP = 5;
/** Where the build panel is a tray and the bar has room for one slider only (game.css). */
const NARROW = "(width < 720px), (height < 560px)";
/** How long the attack preview stays once the pointer or the finger has left the land it was about. */
const PREVIEW_LINGER_MS = 1500;
/** The HUD is redrawn at most this often; the map keeps its own pace. */
const REFRESH_MS = 250;
/** Leaders listed at rest, then when the player opens the leaderboard. */
const LEADERBOARD_SHORT = 3;
const LEADERBOARD_SIZE = 10;
/** A press held this long on a build button explains it, as the long press on the map does. */
const HOLD_MS = 500;
/** How long that explanation stays up. */
const TIP_MS = 5000;

export interface HudActions {
  onPause(): void;
  onHelp(): void;
  onMenu(): void;
  /** Calls back one of the player's attacks, by id. */
  onRetreat(attack: number): void;
  /** A build button was pressed: what clicks on the map do next. */
  onMode(mode: ClickMode): void;
  /** A row of the leaderboard was picked: the menu of that player. */
  onPlayer(player: number): void;
  /** The work share was set, in percent (R-ECO-07). */
  onWork(share: number): void;
}

const MODE_BANNERS = {
  city: "hud.modeCity",
  palace: "hud.modePalace",
  fort: "hud.modeFort",
  port: "hud.modePort",
  silo: "hud.modeSilo",
  airDefense: "hud.modeAirDefense",
  warship: "hud.modeWarship",
  missile: "hud.modeMissile",
  heavyMissile: "hud.modeHeavyMissile",
  demolish: "hud.modeDemolish",
} as const;

/**
 * Numbers the player plays by: their troops, gold and land, the attack
 * ratio, what the game expects of them now, and the leading players.
 */
interface PaceSample {
  tick: number;
  share: number;
}

export class Hud {
  readonly element: HTMLElement;
  private readonly troops = h("strong", { class: "stat-value" });
  private readonly troopsCap = h("span", { class: "stat-cap" });
  private readonly gold = h("strong", { class: "stat-value" });
  private readonly goldRate = h("span", { class: "stat-cap gold-rate" });
  private readonly land = h("strong", { class: "stat-value" });
  private readonly population = new PopulationBar((text) => {
    this.explain(text);
  });
  private readonly banner = h(
    "p",
    { class: "banner", role: "status", "aria-live": "polite" },
    t("game.loading"),
  );
  private readonly leaders: LeaderList;
  /** The leaderboard panel: the menu of a player picked in it opens at its foot. */
  readonly leaderboard: HTMLElement;
  private readonly ratioInput = h("input", {
    id: "attack-ratio",
    type: "range",
    min: MIN_RATIO,
    max: 100,
    step: 1,
  });
  private readonly ratioValue = h("output", { for: "attack-ratio", class: "range-value" });
  private readonly workInput = h("input", {
    id: "work-share",
    type: "range",
    min: 0,
    max: DEFAULT_BALANCE.workMaxPercent,
    step: WORK_STEP,
    value: 0,
  });
  private readonly workValue = h("output", { for: "work-share", class: "range-value" });
  /** A share sent to the game and not yet in its updates: the slider keeps it meanwhile. */
  private workPending: number | undefined;
  /** What the attack preview is about: the owner of the land under the pointer, if any. */
  private hovered: number | undefined;
  private hoverTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly previewName = h("span", { class: "preview-name" });
  private readonly previewTiles = h("span", { class: "preview-tiles" });
  private readonly previewText = h("p", { class: "preview-text" });
  private readonly preview = h(
    "div",
    { class: "preview", role: "status", hidden: true },
    h("p", { class: "preview-title" }, this.previewName, this.previewTiles),
    this.previewText,
  );
  private lastRender = -Infinity;
  private last: GameUpdate | undefined;
  private readonly goal = h("p", { class: "goal-text" });
  private readonly goalLeader = h("span", { class: "goal-fill goal-leader" });
  private readonly goalYou = h("span", { class: "goal-fill goal-you" });
  private readonly clock = h("p", { class: "goal-clock" });
  /** Time before the leader wins at their current pace; hidden when there is no such pace. */
  private readonly eta = h("p", { class: "goal-eta", hidden: true });
  private readonly attackList = h("ul", { class: "attack-list" });
  private readonly attackPanel = h(
    "section",
    { class: "panel attacks", "data-i18n-attr": "aria-label:hud.attacks", hidden: true },
    this.preview,
    this.attackList,
  );
  /** One row per attack under way, kept across renders so a button under the pointer stays put. */
  private readonly attackRows = new Map<number, { row: HTMLElement; text: HTMLElement }>();
  private readonly onRetreat: (attack: number) => void;
  private readonly buildButtons = new Map<ClickMode, HTMLButtonElement>();
  private readonly cityCost = h("span", { class: "build-cost" });
  private readonly palaceCost = h("span", { class: "build-cost" });
  private readonly fortCost = h("span", { class: "build-cost" });
  private readonly portCost = h("span", { class: "build-cost" });
  private readonly warshipCost = h("span", { class: "build-cost" });
  private readonly siloCost = h("span", { class: "build-cost" });
  private readonly airDefenseCost = h("span", { class: "build-cost" });
  private readonly missileCost = h("span", { class: "build-cost" });
  private readonly heavyMissileCost = h("span", { class: "build-cost" });
  private readonly cityCount = h("span", { class: "build-count" });
  private mode: ClickMode = "attack";
  private leaderboardOpen = false;
  /** The leader's share of the land over the last half minute, for the time left before a win. */
  private readonly paces: PaceSample[] = [];
  private readonly buildPanel: HTMLElement;
  private readonly buildToggle: HTMLButtonElement;
  /** What a build button does, after a long press on it. */
  private readonly tip = h("p", {
    class: "build-tip",
    id: "build-tip",
    role: "status",
    hidden: true,
  });
  private tipTimer: ReturnType<typeof setTimeout> | undefined;
  private rules: GameRules = {
    ownableTiles: 1,
    ticksPerSecond: 10,
    winSharePercent: 100,
    maxDurationTicks: Infinity,
    retreatPenaltyPercent: 0,
    firstNation: Infinity,
    allianceRequestTicks: 200,
    growthFloorPercent: 100,
    teams: [],
    disabled: 0,
    special: { collapsingFronts: false, capitals: false },
  };

  private readonly touch: () => boolean;

  /** `pausable`: false online, where the game runs for everyone. */
  constructor(
    actions: HudActions,
    { pausable = true, touch = () => false }: { pausable?: boolean; touch?: () => boolean } = {},
  ) {
    this.touch = touch;
    this.onRetreat = (attack) => {
      actions.onRetreat(attack);
    };
    this.leaders = new LeaderList((player) => {
      actions.onPlayer(player);
    });
    this.ratioInput.addEventListener("input", () => {
      this.setRatio(Number(this.ratioInput.value));
    });
    this.setRatio(DEFAULT_RATIO);
    this.workInput.addEventListener("input", () => {
      this.showWork(Number(this.workInput.value));
    });
    // Sent once the slider is let go, or at each key press: one order per choice.
    this.workInput.addEventListener("change", () => {
      this.workPending = Number(this.workInput.value);
      actions.onWork(this.workPending);
    });
    this.showWork(0);

    const stat = (key: string, ...value: Node[]): HTMLElement =>
      h("div", { class: "stat" }, h("span", { class: "stat-label", "data-i18n": key }), ...value);

    const pause = h("button", {
      type: "button",
      class: "icon-button icon-pause",
      id: "pause",
      "data-i18n-attr": "aria-label:hud.pause;title:hud.pauseKey",
    });
    pause.append(icon("pause"));
    pause.addEventListener("click", () => {
      actions.onPause();
    });
    const help = h("button", {
      type: "button",
      class: "icon-button icon-help",
      id: "help",
      "data-i18n-attr": "aria-label:help.title;title:help.title",
    });
    help.append(icon("help"));
    help.addEventListener("click", () => {
      actions.onHelp();
    });
    const menu = h("button", {
      type: "button",
      class: "icon-button icon-menu",
      id: "leave",
      "data-i18n-attr": "aria-label:hud.menu;title:hud.menu",
    });
    menu.append(icon("leave"));
    menu.addEventListener("click", () => {
      actions.onMenu();
    });

    const buildPanel = h(
      "section",
      { class: "panel build", id: "build-panel", "data-i18n-attr": "aria-label:hud.build" },
      ...BUILD_MODES.map(({ mode, key }) => {
        const digit = numberOf(mode);
        const costs: Partial<Record<ClickMode, HTMLElement>> = {
          palace: this.palaceCost,
          fort: this.fortCost,
          port: this.portCost,
          silo: this.siloCost,
          airDefense: this.airDefenseCost,
          warship: this.warshipCost,
          missile: this.missileCost,
          heavyMissile: this.heavyMissileCost,
        };
        const cost = costs[mode];
        const price = mode === "city" ? this.cityCost : cost;
        const count = mode === "city" ? [this.cityCount] : [];
        const button = h(
          "button",
          {
            type: "button",
            class: `build-button build-${mode}`,
            id: `build-${mode}`,
            "aria-pressed": "false",
            "data-i18n-attr": `title:hud.${mode}Hint`,
            // The number that picks it, drawn in the corner by the styles: no text of its own.
            ...(digit === undefined ? {} : { "data-num": String(digit) }),
            "aria-keyshortcuts": digit === undefined ? key : `${key} ${String(digit)}`,
          },
          h("span", { class: "build-icon", "aria-hidden": "true" }, icon(mode)),
          // The cost stays under the icon, in the dock as in the tray.
          ...(price ? [price] : []),
          // Name and key: a bubble over the button on hover or focus.
          h(
            "span",
            { class: "build-info" },
            h("span", { class: "build-name", "data-i18n": `hud.${mode}` }),
            // The key, for players with a keyboard; hidden on touch screens (styles.css).
            h("kbd", { class: "build-key", "aria-hidden": "true" }, key),
            ...(digit === undefined
              ? []
              : [h("kbd", { class: "build-key", "aria-hidden": "true" }, String(digit))]),
            ...count,
          ),
        );
        // A finger has no tooltip: holding the button explains it instead.
        let hold: ReturnType<typeof setTimeout> | undefined;
        let explained = false;
        const release = (): void => {
          clearTimeout(hold);
          hold = undefined;
        };
        button.addEventListener("pointerdown", (event) => {
          explained = false;
          if (event.pointerType === "mouse") return;
          hold = setTimeout(() => {
            explained = true;
            this.explain(
              t("hud.named", {
                action: t(`hud.${mode}`),
                reason: t(`help.place.${mode}`, { spacing: DEFAULT_BALANCE.buildSpacing }),
              }),
            );
          }, HOLD_MS);
        });
        for (const type of ["pointerup", "pointercancel", "pointerleave"] as const) {
          button.addEventListener(type, release);
        }
        button.addEventListener("contextmenu", (event) => {
          event.preventDefault();
        });
        button.addEventListener("click", () => {
          if (explained) {
            explained = false;
            return;
          }
          actions.onMode(mode);
          // On a narrow screen the tray gives the map back once a choice is made.
          this.setBuildOpen(false);
        });
        this.buildButtons.set(mode, button);
        return button;
      }),
    );

    const leaderboardToggle = h("button", {
      type: "button",
      class: "leaderboard-toggle",
      id: "leaderboard-toggle",
      "aria-expanded": "false",
      "aria-controls": "leaderboard-list",
      "data-i18n": "hud.leaderboard",
    });
    leaderboardToggle.addEventListener("click", () => {
      this.leaderboardOpen = !this.leaderboardOpen;
      leaderboardToggle.setAttribute("aria-expanded", String(this.leaderboardOpen));
      this.leaderboard.classList.toggle("open", this.leaderboardOpen);
      if (this.last) this.renderLeaders(this.last);
    });
    this.leaderboard = h(
      "section",
      { class: "panel leaderboard", "aria-labelledby": "leaderboard-title" },
      h("h2", { id: "leaderboard-title" }, leaderboardToggle),
      this.leaders.element,
      h(
        "div",
        { class: "goal" },
        this.goal,
        // Both bars run from 0 to the winning share; the leader's is drawn under yours.
        h("div", { class: "goal-bar", "aria-hidden": "true" }, this.goalLeader, this.goalYou),
        this.clock,
        this.eta,
      ),
    );
    // Narrow screens keep the buildings behind this button (styles.css).
    this.buildToggle = h("button", {
      type: "button",
      class: "icon-button icon-build",
      id: "build-toggle",
      "aria-expanded": "false",
      "aria-controls": "build-panel",
      "data-i18n-attr": "aria-label:hud.build;title:hud.build",
    });
    this.buildToggle.append(icon("build"));
    this.buildToggle.addEventListener("click", () => {
      this.setBuildOpen(!this.buildPanel.classList.contains("open"));
    });
    this.buildPanel = buildPanel;
    const workRow = h(
      "div",
      { class: "ratio-row work-row" },
      h("label", { for: "work-share", class: "work-label" }),
      this.workInput,
      this.workValue,
    );
    this.element = h(
      "div",
      { class: "hud", id: "hud" },
      // On a wide screen these three make one bar at the foot of the map; elsewhere they
      // keep their own corners (the bar then has no box of its own, see game.css).
      h(
        "div",
        { class: "bar" },
        h(
          "section",
          { class: "panel stats", "data-i18n-attr": "aria-label:hud.yourEmpire" },
          stat("hud.troops", this.troops, this.troopsCap),
          stat("hud.gold", this.gold, this.goldRate),
          stat("hud.land", this.land),
          this.population.element,
        ),
        // R-ECO-07: what attacks take, and what stays at home to work, side by side.
        h(
          "div",
          { class: "panel ratio" },
          h(
            "div",
            { class: "ratio-row" },
            h("label", { for: "attack-ratio", "data-i18n": "hud.ratio" }),
            this.ratioInput,
            this.ratioValue,
          ),
          workRow,
        ),
        buildPanel,
      ),
      this.banner,
      this.leaderboard,
      this.attackPanel,
      this.tip,
      h("div", { class: "toolbar" }, this.buildToggle, help, ...(pausable ? [pause] : []), menu),
    );
    applyTranslations(this.element);
    this.translateWork();
    // Where the bar has no room for a second slider, the work share opens with the
    // buildings, at the top of their tray (game.css).
    const narrow = matchMedia(NARROW);
    const ratioPanel = workRow.parentElement;
    const place = (): void => {
      if (narrow.matches) buildPanel.prepend(workRow);
      else ratioPanel?.append(workRow);
    };
    narrow.addEventListener("change", place);
    place();
  }

  /** Opens or closes the tray of buildings where it is a tray (narrow screens). */
  private setBuildOpen(open: boolean): void {
    this.buildPanel.classList.toggle("open", open);
    this.buildToggle.setAttribute("aria-expanded", String(open));
  }

  /** Shows what a build button does, or a hint about building, in the tip over the bar for a few seconds. */
  explain(text: string): void {
    this.tip.textContent = text;
    this.tip.hidden = false;
    clearTimeout(this.tipTimer);
    this.tipTimer = setTimeout(() => {
      this.tip.hidden = true;
    }, TIP_MS);
  }

  /** Share of troops a new attack takes, in percent. */
  get ratio(): number {
    return Number(this.ratioInput.value);
  }

  setRatio(percent: number): void {
    const value = Math.max(MIN_RATIO, Math.min(100, Math.round(percent)));
    this.ratioInput.value = String(value);
    this.ratioValue.textContent = formatPercent(value / 100);
    if (this.last) this.renderPreview(this.last);
  }

  /** Share of the troops at home put to work, as the slider shows it (R-ECO-07). */
  get work(): number {
    return Number(this.workInput.value);
  }

  /** Shows a work share on the slider, with the gold it brings, before the game has it. */
  private showWork(share: number): void {
    this.workInput.value = String(share);
    this.workValue.textContent = formatPercent(share / 100);
    if (this.last) {
      const human = this.you(this.last);
      if (human) this.renderGold(human);
      this.renderPreview(this.last);
    }
  }

  /**
   * The owner of the land under the pointer or the finger, or undefined when
   * it left the map: what the attack preview is about. It stays a moment
   * after, so a finger lifted can still read it.
   */
  hover(owner: number | undefined): void {
    clearTimeout(this.hoverTimer);
    if (owner === undefined) {
      this.hoverTimer = setTimeout(() => {
        this.hovered = undefined;
        if (this.last) this.renderPreview(this.last);
      }, PREVIEW_LINGER_MS);
      return;
    }
    if (owner === this.hovered) return;
    this.hovered = owner;
    if (this.last) this.renderPreview(this.last);
  }

  /** Shows which build button, if any, the next click on the map follows. */
  setMode(mode: ClickMode): void {
    this.mode = mode;
    if (this.last) this.renderPreview(this.last);
    if (this.last) this.banner.textContent = this.bannerText(this.last, this.you(this.last));
    for (const [button, element] of this.buildButtons) {
      element.setAttribute("aria-pressed", String(button === mode));
    }
  }

  setRules(rules: GameRules): void {
    this.rules = { ...rules, ownableTiles: Math.max(1, rules.ownableTiles) };
    this.population.setFloor(rules.growthFloorPercent);
    for (const [mode, button] of this.buildButtons) button.hidden = !offers(mode, rules.disabled);
    // Colours depend on the rules (nations): rows are made again.
    this.leaders.clear();
  }

  /** Takes every update; draws only a few times per second, or at once when forced. */
  update(update: GameUpdate, now: number, force = false): void {
    const phaseChanged = this.last?.phase !== update.phase;
    this.last = update;
    if (!force && !phaseChanged && now - this.lastRender < REFRESH_MS) return;
    this.lastRender = now;
    this.render(update);
  }

  /** Redraws with the last update, after a language change for example. */
  refresh(): void {
    applyTranslations(this.element);
    this.translateWork();
    if (this.last) this.render(this.last);
  }

  private you(update: GameUpdate): PlayerView | undefined {
    return update.players.find((player) => player.id === update.you);
  }

  private render(update: GameUpdate): void {
    const human = this.you(update);
    if (human) {
      this.troops.textContent = formatCount(human.troops);
      this.troopsCap.textContent = t("hud.cap", { cap: formatCount(human.cap) });
      this.gold.textContent = formatCount(human.gold);
      this.syncWork(human);
      this.renderGold(human);
      this.land.textContent = this.share(human.tiles);
      this.population.update(human.troops, human.cap, update.economy.growth);
      this.renderBuild(update, human);
    }
    this.banner.textContent = this.bannerText(update, human);
    // R-CAP-05: the banner turns to an alarm while the capital is threatened.
    this.banner.classList.toggle("danger", this.besieged(update, human));
    this.renderLeaders(update);
    this.renderGoal(update, human);
    this.renderAttacks(update);
    this.renderPreview(update);
  }

  /** Follows the game's work share, unless the player is moving the slider or waits for theirs. */
  private syncWork(human: PlayerView): void {
    if (this.workPending === human.workShare) this.workPending = undefined;
    const dragging = document.activeElement === this.workInput && this.workPending === undefined;
    if (this.workPending === undefined && !dragging && this.work !== human.workShare) {
      this.showWork(human.workShare);
    }
    this.workInput.disabled = !human.alive;
  }

  /** Gold a second from the troops, with the share the slider shows. */
  private renderGold(human: PlayerView): void {
    const rate = goldPerSecond({ troops: human.troops, workShare: this.work });
    this.goldRate.textContent = workText("goldRate", { rate: formatCount(Math.floor(rate)) });
  }

  /** Labels made here rather than from the catalogues (ui/work-text.ts). */
  private translateWork(): void {
    const label = this.element.querySelector(".work-label");
    if (label) label.textContent = workText("work");
    const hint = workText("workHint", { factor: DEFAULT_BALANCE.workGoldFactor });
    this.workInput.title = hint;
    this.workInput.closest(".work-row")?.setAttribute("title", hint);
    this.goldRate.title = workText("goldRateHint");
  }

  /** What an attack on the land under the pointer would roughly do, with the ratio set now. */
  private renderPreview(update: GameUpdate): void {
    const found =
      this.mode === "attack" && this.hovered !== undefined
        ? attackPreview(update, this.hovered, this.ratio)
        : undefined;
    const human = this.you(update);
    // The slider's share, which the game may not have yet.
    const preview =
      found && human && this.work !== human.workShare
        ? attackPreview(
            {
              ...update,
              players: update.players.map((p) =>
                p.id === human.id ? { ...p, workShare: this.work } : p,
              ),
            },
            found.target,
            this.ratio,
          )
        : found;
    this.preview.hidden = preview === undefined;
    if (preview) {
      const defender = update.players.find((p) => p.id === preview.target);
      this.previewName.textContent =
        preview.target === 0 ? t("hud.unclaimed") : (defender?.name ?? t("hud.unclaimed"));
      this.previewTiles.textContent =
        preview.tiles === 0
          ? workText("previewShort")
          : defender && preview.tiles >= defender.tiles
            ? workText("previewAll")
            : workText(preview.tiles === 1 ? "previewTile" : "previewTiles", {
                count: formatCount(preview.tiles),
              });
      this.previewTiles.classList.toggle("short", preview.tiles === 0);
      const send = workText("previewSend", {
        troops: formatCount(preview.troops),
        cost: formatCount(preview.perTile),
      });
      this.previewText.textContent =
        preview.tiles === 0
          ? send
          : `${send}\n${workText("previewGain", { cap: formatCount(preview.capGain) })}`;
    }
    this.attackPanel.hidden = this.attackRows.size === 0 && this.preview.hidden;
  }

  /** Costs of the next city and fort, greyed out while the player cannot pay or has no room. */
  private renderBuild(update: GameUpdate, human: PlayerView): void {
    const { cityCost, palaceCost, fortCost, portCost, cities, cityLimit } = update.build;
    this.portCost.textContent = formatCount(portCost);
    this.warshipCost.textContent = formatCount(update.build.warshipCost);
    this.cityCost.textContent = formatCount(cityCost);
    this.palaceCost.textContent = formatCount(palaceCost);
    this.fortCost.textContent = formatCount(fortCost);
    const { siloCost, airDefenseCost, missileCost, heavyMissileCost, loaded } = update.build;
    this.siloCost.textContent = formatCount(siloCost);
    this.airDefenseCost.textContent = formatCount(airDefenseCost);
    this.missileCost.textContent = formatCount(missileCost);
    this.heavyMissileCost.textContent = formatCount(heavyMissileCost);
    this.cityCount.textContent = plural("hud.cities", cityLimit, { built: cities });
    const playing = update.phase === "play" && human.alive;
    const can: Partial<Record<ClickMode, boolean>> = {
      city: playing && human.gold >= cityCost && cities < cityLimit,
      palace: playing && human.gold >= palaceCost && cities + 2 <= cityLimit,
      fort: playing && human.gold >= fortCost,
      port: playing && human.gold >= portCost,
      silo: playing && human.gold >= siloCost,
      airDefense: playing && human.gold >= airDefenseCost,
      missile: playing && loaded && human.gold >= missileCost,
      heavyMissile: playing && loaded && human.gold >= heavyMissileCost,
      warship:
        playing &&
        human.gold >= update.build.warshipCost &&
        update.structures.some((s) => s.type === "port" && s.player === human.id && s.ready),
      demolish: playing,
    };
    // Still pressable: a click on the map then says what is missing.
    for (const [mode, button] of this.buildButtons) {
      const allowed = can[mode] === true;
      button.classList.toggle("unaffordable", !allowed);
      button.setAttribute("aria-disabled", String(!allowed));
      // The name and the cost sit in a bubble only the pointer reaches: say them to the rest.
      const price = costOf(mode, update.build);
      const name = t(`hud.${mode}` as MessageKey);
      const label =
        price === undefined ? name : t("hud.buildLabel", { name, cost: formatCount(price) });
      button.setAttribute("aria-label", label);
    }
  }

  /** The player's attacks under way, each with a button to call it back. */
  private renderAttacks(update: GameUpdate): void {
    const names = new Map(update.players.map((player) => [player.id, player.name]));
    const current = new Set<number>();
    for (const attack of update.attacks) {
      current.add(attack.id);
      let entry = this.attackRows.get(attack.id);
      if (!entry) {
        const text = h("span", { class: "attack-text" });
        const retreat = h("button", { type: "button", class: "attack-retreat" }, t("hud.retreat"));
        retreat.title = t("hud.retreatHint", {
          penalty: formatPercent(this.rules.retreatPenaltyPercent / 100),
        });
        retreat.addEventListener("click", () => {
          this.onRetreat(attack.id);
        });
        entry = { row: h("li", { class: "attack" }, text, retreat), text };
        this.attackRows.set(attack.id, entry);
        this.attackList.append(entry.row);
      }
      const target =
        attack.target === 0 ? t("hud.unclaimed") : (names.get(attack.target) ?? t("hud.unclaimed"));
      entry.text.textContent = t("hud.attackOn", { target, troops: formatCount(attack.troops) });
    }
    for (const [id, entry] of this.attackRows) {
      if (current.has(id)) continue;
      entry.row.remove();
      this.attackRows.delete(id);
    }
    this.attackPanel.hidden = current.size === 0 && this.preview.hidden;
  }

  /** Share of the land; a start on the World is a few hundredths of a percent. */
  private share(tiles: number): string {
    const share = tiles / this.rules.ownableTiles;
    return share > 0 && share < 0.001
      ? t("hud.under", { value: formatPercent(0.001) })
      : formatPercent(share);
  }

  private renderLeaders(update: GameUpdate): void {
    this.leaders.render(
      update,
      this.leaderboardOpen ? LEADERBOARD_SIZE : LEADERBOARD_SHORT,
      (id) => colorOf(id, this.rules.firstNation, this.rules.teams),
      (tiles) => this.share(tiles),
    );
  }

  /** How far the leader and the player are from winning, and the time left. */
  private renderGoal(update: GameUpdate, human: PlayerView | undefined): void {
    const { ownableTiles, ticksPerSecond, winSharePercent, maxDurationTicks } = this.rules;
    const win = winSharePercent / 100;
    this.goal.textContent = t("hud.goal", { share: formatPercent(win) });
    // R-WIN-02: among the players still in the game; teammates' land counts together (R-MODE-02).
    const { teams } = this.rules;
    const land = new Map<number, number>();
    for (const player of update.players) {
      if (!player.alive) continue;
      const side = teams[player.id] ? -(teams[player.id] as number) : player.id;
      land.set(side, (land.get(side) ?? 0) + player.tiles);
    }
    const leader = Math.max(0, ...land.values());
    const yourTeam = human ? (teams[human.id] ?? 0) : 0;
    const yours = yourTeam ? (land.get(-yourTeam) ?? 0) : (human?.tiles ?? 0);
    const width = (tiles: number): string =>
      `${String(Math.min(100, (tiles / ownableTiles / win) * 100))}%`;
    this.goalLeader.style.width = width(leader);
    this.goalYou.style.width = width(yours);
    const time = Number.isFinite(maxDurationTicks)
      ? t("hud.clock", {
          elapsed: formatDuration(update.tick / ticksPerSecond),
          limit: formatDuration(maxDurationTicks / ticksPerSecond),
        })
      : formatDuration(update.tick / ticksPerSecond);
    const eta = this.winEta(update.tick, leader / ownableTiles, win);
    this.clock.textContent = time;
    this.eta.hidden = eta === undefined;
    if (eta !== undefined) {
      this.eta.textContent = t("hud.eta", { time: formatDuration(eta / ticksPerSecond) });
    }
  }

  /**
   * Ticks before the leader reaches the winning share, if they keep their pace of the last
   * half minute of game time; none while they are not gaining or the game ends first.
   */
  private winEta(tick: number, share: number, win: number): number | undefined {
    const { ticksPerSecond, maxDurationTicks } = this.rules;
    const samples = this.paces;
    const lastSample = samples[samples.length - 1];
    // Going back (a replay seeking) starts over.
    if (lastSample && tick < lastSample.tick) samples.length = 0;
    if (!lastSample || tick - lastSample.tick >= ticksPerSecond) samples.push({ tick, share });
    while (samples.length > 1 && tick - (samples[0] as PaceSample).tick > 30 * ticksPerSecond) {
      samples.shift();
    }
    const first = samples[0] as PaceSample;
    const span = tick - first.tick;
    if (span < 10 * ticksPerSecond || share >= win) return undefined;
    const pace = (share - first.share) / span;
    if (pace <= 0) return undefined;
    const ticks = (win - share) / pace;
    return tick + ticks <= maxDurationTicks && ticks < 3600 * ticksPerSecond ? ticks : undefined;
  }

  /** Whether the player's capital is under threat (R-CAP-05). */
  private besieged(update: GameUpdate, human: PlayerView | undefined): boolean {
    return human?.alive === true && update.phase === "play" && (update.capitals?.threat ?? 0) !== 0;
  }

  private bannerText(update: GameUpdate, human: PlayerView | undefined): string {
    const seconds = Math.ceil(update.spawnTicksLeft / this.rules.ticksPerSecond);
    if (update.phase === "spawn") {
      const spawn =
        human && human.tiles > 0
          ? this.say("hud.spawnMove", { seconds })
          : this.say("hud.spawnPick", { seconds });
      // R-CAP-01: where the player starts is the tile they must hold.
      return update.capitals ? `${spawn} ${t("hud.spawnCapital")}` : spawn;
    }
    if (human && !human.alive) return t("hud.eliminated");
    if (this.besieged(update, human)) {
      const threat = update.capitals?.threat;
      const name = update.players.find((player) => player.id === threat)?.name ?? "";
      return t("hud.capitalThreat", { name });
    }
    const standsIn = update.capitals?.standsIn ?? 0;
    if (this.mode === "attack" && update.attacks.length === 0 && standsIn > 0) {
      return t("hud.capitalGrace", {
        time: formatDuration(Math.ceil(standsIn / this.rules.ticksPerSecond)),
      });
    }
    if (this.mode !== "attack") return this.say(MODE_BANNERS[this.mode]);
    if (update.attacks.length > 0) {
      const troops = update.attacks.reduce((sum, attack) => sum + attack.troops, 0);
      return t("hud.attacking", { count: update.attacks.length, troops: formatCount(troops) });
    }
    return this.say("hud.playHint");
  }

  /** The text of a click instruction, or its tap twin when a finger plays. */
  private say(key: MessageKey, values?: Record<string, string | number>): string {
    return t(this.touch() ? (`${key}Touch` as MessageKey) : key, values);
  }
}
