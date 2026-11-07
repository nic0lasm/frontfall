import type { GameRules } from "../../game/messages.ts";
import type { GameSession, SessionCapabilities } from "../../game/session.ts";
import type { GameUpdate, SoloOptions } from "../../game/game-runner.ts";
import { REPLAY_SPEEDS } from "../../game/replay-file.ts";
import { Effects, sameEntries, select, shallowEqual, signal } from "../../signals.ts";
import { DiplomacyPanel } from "../diplomacy.ts";
import { DoctrinePicker, doctrineView } from "../doctrine-picker.ts";
import { GoldFloats, tradeGains } from "../gold-floats.ts";
import { withHidden } from "../hidden-players.ts";
import { Hud, type HudActions } from "../hud.ts";
import { PlayerLabels, relationMarks } from "../labels.ts";
// Only replays show the bar: it loads with the replay, out of the first download.
import type { ReplayBar } from "../replay-bar.ts";
import { SpeedControl } from "../speed-control.ts";
import type { Orders } from "./orders.ts";

/** What the panels ask of the screen. */
export type PanelActions = Pick<
  HudActions,
  "onPause" | "onHelp" | "onMenu" | "onCentre" | "onCounter" | "onMode"
> & {
  /** The player menu's boat button, at the tile it was opened on. */
  onLand(tile: number): void;
};

export interface PanelHostOptions {
  readonly can: SessionCapabilities;
  readonly session: Pick<GameSession, "setSpeed" | "reportPlayer">;
  readonly orders: Orders;
  readonly options: Pick<SoloOptions, "speed" | "players">;
  /** A finger rather than a mouse. */
  readonly touch: () => boolean;
  readonly actions: PanelActions;
  /** The code of the replay bar, for a replay. */
  readonly replayBar?: typeof ReplayBar | undefined;
}

/** The labels' marks before the first update. */
const NO_MARKS: ReadonlyMap<number, string> = new Map();

/**
 * The panels over the map: the HUD, the player menu and its requests, the
 * doctrine cards, the pace, the names on the land and the gold of the trade
 * ships. Each follows its own part of the update as this screen shows it,
 * through a signal (signals.ts).
 */
export class PanelHost {
  readonly hud: Hud;
  readonly diplomacy: DiplomacyPanel;
  /** The choice of a doctrine in the spawn phase (R-DOCTRINE-01). */
  readonly doctrines: DoctrinePicker;
  /** Solo only (R-MODE-07): online, the host picked the pace in the lobby. */
  readonly speed: SpeedControl | undefined;
  /** Set while watching a recorded game: a bar to set the pace. */
  readonly replayBar: ReplayBar | undefined;
  readonly labels = new PlayerLabels();
  readonly goldFloats = new GoldFloats();
  /** The game as this screen shows it, hidden players renamed: the panels follow it. */
  private readonly shown = signal<GameUpdate | undefined>(undefined);
  /** The panels' watchers, stopped with the screen. */
  private readonly effects = new Effects();
  private latest: GameUpdate | undefined;
  /** Players hidden on this screen (R-DIPLO-08), for this game only. */
  private readonly hidden = new Set<number>();
  /** Players this page reported (R-MODE-06); the last one leaves if the server turns it down. */
  private readonly reports = new Set<number>();
  private lastReport: number | undefined;
  private ticksPerSecond = 10;
  /** Lowest id of the nations, who take colours of their own. */
  private firstNation = Infinity;

  constructor(o: PanelHostOptions) {
    const { can, orders, actions, session } = o;
    this.hud = new Hud(
      {
        ...actions,
        onRetreat: (attack) => {
          orders.retreat(attack);
        },
        onPlayer: (player) => {
          if (can.canOrder) this.diplomacy.pick(player);
        },
        onWork: (share) => {
          orders.work(share);
        },
      },
      { pausable: can.canPause, touch: o.touch },
    );
    this.diplomacy = new DiplomacyPanel({
      onAlly: (player) => orders.diplomatic("ally", player),
      onEmbargo: (player, on) => {
        orders.diplomatic("embargo", player, on);
      },
      onTribute: (player) => {
        orders.diplomatic("tribute", player);
      },
      onBetray: (player) => {
        orders.diplomatic("betray", player);
      },
      onGift: (player, what) => {
        orders.gift(player, what);
      },
      onLand: (tile) => {
        actions.onLand(tile);
      },
      share: () => this.hud.ratio,
      onQuick: (player, phrase) => {
        orders.quick(player, phrase);
      },
      // Only other people can be hidden: online, and never a nation.
      hidden: (player) =>
        !can.canHide || player >= this.firstNation ? undefined : this.hidden.has(player),
      onHide: (player, hide) => {
        if (hide) this.hidden.add(player);
        else this.hidden.delete(player);
        // Names and messages again; no events, as what the update brought was shown once already.
        if (this.latest) this.shown.value = { ...withHidden(this.latest, this.hidden), events: [] };
      },
      // Only people can be reported, through a server that takes reports.
      reported: (player) =>
        can.canReport && o.options.players?.some((p) => p.id === player)
          ? this.reports.has(player)
          : undefined,
      onReport: (player, reason) => {
        session.reportPlayer(player, reason);
        this.reports.add(player);
        this.lastReport = player;
      },
    });
    if (can.canSetSpeed && can.canOrder) {
      this.speed = new SpeedControl(o.options.speed ?? 1, (speed) => {
        session.setSpeed(speed);
      });
      // Help, pause, speed, menu (docs/hud-layout.md).
      this.hud.element.querySelector("#pause")?.after(this.speed.element);
      this.hud.element.classList.add("speedable");
    }
    this.hud.leaderboard.append(this.diplomacy.menu);
    this.hud.element.append(this.diplomacy.requests);
    this.doctrines = new DoctrinePicker((pick) => {
      orders.doctrine(pick);
    });
    this.hud.element.append(this.doctrines.element);
    if (o.replayBar) {
      this.replayBar = new o.replayBar(REPLAY_SPEEDS, (speed) => {
        session.setSpeed(speed);
      });
    }
    this.watch();
  }

  /**
   * Each panel follows its own part of the game as this screen shows it, and
   * runs only when that part changes: the marks of the labels with the
   * relations, the doctrine cards with their seconds. The HUD and the player
   * menu show figures that move with every update, and take each one.
   */
  private watch(): void {
    const { effects, shown } = this;
    effects.watch(
      select(shown, (update) => update?.players),
      (players) => {
        if (players) this.labels.update(players, shown.peek()?.labels);
      },
    );
    effects.watch(
      select(shown, (update) => (update ? relationMarks(update) : NO_MARKS), sameEntries),
      (marks) => {
        this.labels.setMarks(marks);
      },
    );
    // A trade ship docked: the gold it brought this player rises over the port.
    effects.watch(select(shown, tradeGains), (gains) => {
      for (const { tile, gold } of gains) this.goldFloats.add(tile, gold, performance.now());
    });
    effects.watch(shown, (update) => {
      if (update) this.hud.update(update, performance.now());
    });
    effects.watch(
      select(shown, (update) => doctrineView(update, this.ticksPerSecond), shallowEqual),
      (view) => {
        this.doctrines.show(view);
      },
    );
    effects.watch(shown, (update) => {
      if (update) this.diplomacy.update(update);
    });
    const bar = this.replayBar;
    if (bar) {
      effects.watch(shown, (update) => {
        if (update?.replay) bar.update(update.tick, update.replay, this.ticksPerSecond);
      });
    }
  }

  /** Takes an update in; the panels watching it run now. Returns it as this screen shows it. */
  show(update: GameUpdate): GameUpdate {
    this.latest = update;
    // What this screen shows from here on: hidden players go by their number.
    const shown = withHidden(update, this.hidden);
    this.shown.value = shown;
    return shown;
  }

  /** The HUD at once, as the game is decided, whatever its pace of redrawing. */
  drawNow(update: GameUpdate): void {
    this.hud.update(update, performance.now(), true);
  }

  setRules(rules: GameRules): void {
    this.ticksPerSecond = rules.ticksPerSecond;
    this.firstNation = rules.firstNation;
    this.hud.setRules(rules);
    this.diplomacy.setRules(rules);
  }

  /** The line of figures the player menu starts with, once the feed's code is here. */
  setFacts(line: Parameters<DiplomacyPanel["setFacts"]>[0]): void {
    this.diplomacy.setFacts(line);
  }

  /** Every text again, in the language just picked. */
  translate(): void {
    this.hud.refresh();
    this.doctrines.translate();
    this.speed?.show();
    this.diplomacy.refresh();
  }

  /** Online: the server turned down a report, as too many came from this address lately. */
  reportRefused(): void {
    if (this.lastReport !== undefined) this.reports.delete(this.lastReport);
    this.diplomacy.reportRefused();
  }

  dispose(): void {
    this.effects.dispose();
  }
}
