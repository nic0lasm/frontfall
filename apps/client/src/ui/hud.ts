import type { GameRules } from "../game/messages.ts";
import type { ClickMode, GameUpdate, PlayerView } from "../game/solo-game.ts";
import { applyTranslations, plural, t } from "../i18n/index.ts";
import { playerColor } from "../palette.ts";
import { betaBadge } from "./beta.ts";
import { h, present, swatch } from "./dom.ts";
import { formatCount, formatDuration, formatPercent } from "./format.ts";

/** B-ATTACK-RATIO-MIN and the interface default of R-ATTACK-02, in percent. */
export const MIN_RATIO = 5;
export const DEFAULT_RATIO = 30;
/** The HUD is redrawn at most this often; the map keeps its own pace. */
const REFRESH_MS = 250;
const LEADERBOARD_SIZE = 10;

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
  fort: "hud.modeFort",
  demolish: "hud.modeDemolish",
} as const;

/** The build buttons, with their shortcut keys (game-screen.ts). */
const BUILD_MODES = [
  { mode: "city", key: "C" },
  { mode: "fort", key: "F" },
  { mode: "demolish", key: "X" },
] as const satisfies readonly { mode: ClickMode; key: string }[];

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
  private readonly leaders = h("ol", { class: "leaderboard-list" });
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
  private readonly onPlayer: (player: number) => void;
  /** Leaderboard rows by player id, kept across renders so focus stays on a picked row. */
  private readonly leaderRows = new Map<number, LeaderRow>();
  private readonly buildButtons = new Map<ClickMode, HTMLButtonElement>();
  private readonly cityCost = h("span", { class: "build-cost" });
  private readonly fortCost = h("span", { class: "build-cost" });
  private readonly cityCount = h("span", { class: "build-count" });
  private mode: ClickMode = "attack";
  private rules: GameRules = {
    ownableTiles: 1,
    ticksPerSecond: 10,
    winSharePercent: 100,
    maxDurationTicks: Infinity,
    retreatPenaltyPercent: 0,
    allianceRequestTicks: 200,
  };

  /** `pausable`: false online, where the game runs for everyone. */
  constructor(actions: HudActions, { pausable = true }: { pausable?: boolean } = {}) {
    this.onRetreat = (attack) => {
      actions.onRetreat(attack);
    };
    this.onPlayer = (player) => {
      actions.onPlayer(player);
    };
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
    pause.addEventListener("click", () => {
      actions.onPause();
    });
    const help = h("button", {
      type: "button",
      class: "icon-button icon-help",
      id: "help",
      "data-i18n-attr": "aria-label:help.title;title:help.title",
    });
    help.addEventListener("click", () => {
      actions.onHelp();
    });
    const menu = h("button", {
      type: "button",
      class: "icon-button icon-menu",
      id: "leave",
      "data-i18n-attr": "aria-label:hud.menu;title:hud.menu",
    });
    menu.addEventListener("click", () => {
      actions.onMenu();
    });

    const buildPanel = h(
      "section",
      { class: "panel build", "data-i18n-attr": "aria-label:hud.build" },
      ...BUILD_MODES.map(({ mode, key }) => {
        const extra =
          mode === "city"
            ? [this.cityCost, this.cityCount]
            : mode === "fort"
              ? [this.fortCost]
              : [];
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
          h("span", { class: "build-icon", "aria-hidden": "true" }),
          h("span", { class: "build-name", "data-i18n": `hud.${mode}` }),
          ...extra,
        );
        button.addEventListener("click", () => {
          actions.onMode(mode);
        });
        this.buildButtons.set(mode, button);
        return button;
      }),
    );

    this.leaderboard = h(
      "section",
      { class: "panel leaderboard", "aria-labelledby": "leaderboard-title" },
      h("h2", { id: "leaderboard-title", "data-i18n": "hud.leaderboard" }),
      this.leaders,
      h(
        "div",
        { class: "goal" },
        this.goal,
        // Both bars run from 0 to the winning share; the leader's is drawn under yours.
        h("div", { class: "goal-bar", "aria-hidden": "true" }, this.goalLeader, this.goalYou),
        this.clock,
      ),
    );
    this.element = h(
      "div",
      { class: "hud", id: "hud" },
      h(
        "section",
        { class: "panel stats", "data-i18n-attr": "aria-label:hud.yourEmpire" },
        stat("hud.troops", this.troops, this.troopsCap),
        stat("hud.gold", this.gold),
        stat("hud.land", this.land),
      ),
      this.banner,
      this.leaderboard,
      h(
        "div",
        { class: "panel ratio" },
        h("label", { for: "attack-ratio", "data-i18n": "hud.ratio" }),
        this.ratioInput,
        this.ratioValue,
      ),
      this.attackPanel,
      buildPanel,
      h("div", { class: "toolbar" }, help, ...(pausable ? [pause] : []), menu),
      ...present(betaBadge("beta-hud")),
    );
    applyTranslations(this.element);
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
    const { cityCost, fortCost, cities, cityLimit } = update.build;
    this.cityCost.textContent = formatCount(cityCost);
    this.fortCost.textContent = formatCount(fortCost);
    this.cityCount.textContent = plural("hud.cities", cityLimit, { built: cities });
    const playing = update.phase === "play" && human.alive;
    const can: Partial<Record<ClickMode, boolean>> = {
      city: playing && human.gold >= cityCost && cities < cityLimit,
      fort: playing && human.gold >= fortCost,
      demolish: playing,
    };
    // Still pressable: a click on the map then says what is missing.
    for (const [mode, button] of this.buildButtons) {
      const allowed = can[mode] === true;
      button.classList.toggle("unaffordable", !allowed);
      button.setAttribute("aria-disabled", String(!allowed));
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

  /** How far the leader and the player are from winning, and the time left. */
  private renderGoal(update: GameUpdate, human: PlayerView | undefined): void {
    const { ownableTiles, ticksPerSecond, winSharePercent, maxDurationTicks } = this.rules;
    const win = winSharePercent / 100;
    this.goal.textContent = t("hud.goal", { share: formatPercent(win) });
    // R-WIN-02: among the players still in the game.
    const leader = Math.max(0, ...update.players.filter((p) => p.alive).map((p) => p.tiles));
    const width = (tiles: number): string =>
      `${String(Math.min(100, (tiles / ownableTiles / win) * 100))}%`;
    this.goalLeader.style.width = width(leader);
    this.goalYou.style.width = width(human?.tiles ?? 0);
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

  /**
   * The leading players, and the player at this screen if lower. Every other
   * player's row is a button that opens their menu; allies and traitors are
   * marked. Rows are reused, so a row with focus keeps it.
   */
  private renderLeaders(update: GameUpdate): void {
    const { players, you, diplomacy } = update;
    const ranked = players
      .filter((player) => player.alive)
      .sort((a, b) => b.tiles - a.tiles || a.id - b.id);
    const shown = ranked.slice(0, LEADERBOARD_SIZE);
    const humanRank = ranked.findIndex((player) => player.id === you);
    if (humanRank >= LEADERBOARD_SIZE) shown.push(ranked[humanRank] as PlayerView);
    const allies = new Set(diplomacy.allies.map((ally) => ally.id));
    const traitors = new Set(diplomacy.traitors.map((traitor) => traitor.id));
    const rows = shown.map((player) => {
      let row = this.leaderRows.get(player.id);
      if (!row) {
        row = leaderRow(player, player.id === you, this.onPlayer);
        this.leaderRows.set(player.id, row);
      }
      row.item.value = ranked.indexOf(player) + 1;
      row.name.textContent = player.name;
      row.land.textContent = this.share(player.tiles);
      row.ally.hidden = !allies.has(player.id);
      row.traitor.hidden = !traitors.has(player.id);
      return row.item;
    });
    for (const [id, row] of this.leaderRows) {
      if (!shown.some((player) => player.id === id)) {
        row.item.remove();
        this.leaderRows.delete(id);
      }
    }
    const order = [...this.leaders.children];
    if (rows.length !== order.length || rows.some((row, i) => row !== order[i])) {
      // Moving a row drops its focus: give it back.
      const focused = document.activeElement;
      this.leaders.replaceChildren(...rows);
      if (focused instanceof HTMLElement && this.leaders.contains(focused)) focused.focus();
    }
  }
}

interface LeaderRow {
  item: HTMLLIElement;
  name: HTMLElement;
  land: HTMLElement;
  ally: HTMLElement;
  traitor: HTMLElement;
}

function leaderRow(player: PlayerView, you: boolean, onPick: (player: number) => void): LeaderRow {
  const name = h("span", { class: "leader-name" });
  const land = h("span", { class: "leader-land" });
  const ally = h("span", {
    class: "badge badge-ally",
    "data-i18n": "diplo.allyBadge",
    hidden: true,
  });
  const traitor = h("span", {
    class: "badge badge-traitor",
    "data-i18n": "diplo.traitorBadge",
    hidden: true,
  });
  ally.textContent = t("diplo.allyBadge");
  traitor.textContent = t("diplo.traitorBadge");
  const content = [swatch(playerColor(player.id - 1).hex), name, ally, traitor, land];
  if (you) {
    return { item: h("li", { class: "leader you" }, ...content), name, land, ally, traitor };
  }
  const button = h(
    "button",
    {
      type: "button",
      class: "leader-button",
      "data-player": player.id,
      "aria-label": t("diplo.playerMenu", { name: player.name }),
    },
    ...content,
  );
  button.addEventListener("click", () => {
    onPick(player.id);
  });
  return { item: h("li", { class: "leader" }, button), name, land, ally, traitor };
}
