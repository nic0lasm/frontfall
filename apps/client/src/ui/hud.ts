import { DEFAULT_BALANCE } from "@frontfall/engine";
import type { GameRules } from "../game/messages.ts";
import type { ClickMode, GameUpdate, PlayerView } from "../game/solo-game.ts";
import { applyTranslations, plural, t, type MessageKey } from "../i18n/index.ts";
import { colorOf } from "../palette.ts";
import { h } from "./dom.ts";
import { formatCount, formatDuration, formatPercent } from "./format.ts";
import { icon } from "./icons.ts";
import { LeaderList } from "./leader-list.ts";
import { BUILD_MODES, costOf, offers } from "./build-modes.ts";

// Also found here, where it was first defined.
export { offers };

/** B-ATTACK-RATIO-MIN and the interface default of R-ATTACK-02, in percent. */
export const MIN_RATIO = 5;
export const DEFAULT_RATIO = 30;
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
export class Hud {
  readonly element: HTMLElement;
  private readonly troops = h("strong", { class: "stat-value" });
  private readonly troopsCap = h("span", { class: "stat-cap" });
  private readonly gold = h("strong", { class: "stat-value" });
  private readonly land = h("strong", { class: "stat-value" });
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
  private lastRender = -Infinity;
  private last: GameUpdate | undefined;
  private readonly goal = h("p", { class: "goal-text" });
  private readonly goalLeader = h("span", { class: "goal-fill goal-leader" });
  private readonly goalYou = h("span", { class: "goal-fill goal-you" });
  private readonly clock = h("p", { class: "goal-clock" });
  private readonly attackList = h("ul", { class: "attack-list" });
  private readonly attackPanel = h(
    "section",
    { class: "panel attacks", "data-i18n-attr": "aria-label:hud.attacks", hidden: true },
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
    teams: [],
    disabled: 0,
  };

  /** `pausable`: false online, where the game runs for everyone. */
  constructor(actions: HudActions, { pausable = true }: { pausable?: boolean } = {}) {
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
            "aria-keyshortcuts": key,
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
          stat("hud.gold", this.gold),
          stat("hud.land", this.land),
        ),
        h(
          "div",
          { class: "panel ratio" },
          h("label", { for: "attack-ratio", "data-i18n": "hud.ratio" }),
          this.ratioInput,
          this.ratioValue,
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
  }

  /** Opens or closes the tray of buildings where it is a tray (narrow screens). */
  private setBuildOpen(open: boolean): void {
    this.buildPanel.classList.toggle("open", open);
    this.buildToggle.setAttribute("aria-expanded", String(open));
  }

  /** Shows what a build button does for a few seconds. */
  private explain(text: string): void {
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
  }

  /** Shows which build button, if any, the next click on the map follows. */
  setMode(mode: ClickMode): void {
    this.mode = mode;
    if (this.last) this.banner.textContent = this.bannerText(this.last, this.you(this.last));
    for (const [button, element] of this.buildButtons) {
      element.setAttribute("aria-pressed", String(button === mode));
    }
  }

  setRules(rules: GameRules): void {
    this.rules = { ...rules, ownableTiles: Math.max(1, rules.ownableTiles) };
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
      this.land.textContent = this.share(human.tiles);
      this.renderBuild(update, human);
    }
    this.banner.textContent = this.bannerText(update, human);
    this.renderLeaders(update);
    this.renderGoal(update, human);
    this.renderAttacks(update);
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
    this.attackPanel.hidden = current.size === 0;
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
    this.clock.textContent = Number.isFinite(maxDurationTicks)
      ? t("hud.clock", {
          elapsed: formatDuration(update.tick / ticksPerSecond),
          limit: formatDuration(maxDurationTicks / ticksPerSecond),
        })
      : formatDuration(update.tick / ticksPerSecond);
  }

  private bannerText(update: GameUpdate, human: PlayerView | undefined): string {
    const seconds = Math.ceil(update.spawnTicksLeft / this.rules.ticksPerSecond);
    if (update.phase === "spawn") {
      return human && human.tiles > 0
        ? t("hud.spawnMove", { seconds })
        : t("hud.spawnPick", { seconds });
    }
    if (human && !human.alive) return t("hud.eliminated");
    if (this.mode !== "attack") return t(MODE_BANNERS[this.mode]);
    if (update.attacks.length > 0) {
      const troops = update.attacks.reduce((sum, attack) => sum + attack.troops, 0);
      return t("hud.attacking", { count: update.attacks.length, troops: formatCount(troops) });
    }
    return t("hud.playHint");
  }
}
