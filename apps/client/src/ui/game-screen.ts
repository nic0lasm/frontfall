import type { DesyncReport, GameRecord, Turn } from "@frontfall/engine";
import { accessibility, motionReduced, onMotionChange } from "./accessibility.ts";
import { TICK_RATE } from "@frontfall/protocol";
import { LocalSession, type ServerLink } from "../game/local-session.ts";
import { TurnPacer } from "../game/turn-pacer.ts";
import type { MapInfo } from "../game/maps.ts";
import type { ClickOutcome } from "../game/messages.ts";
import type { ClickMode, GameUpdate, SoloOptions } from "../game/solo-game.ts";
import { InputController } from "../input/controller.ts";
import { aimReach } from "../input/aim.ts";
import { applyTranslations, onLanguageChange, t, type MessageKey } from "../i18n/index.ts";
import type { ViewKind } from "../render/renderer.ts";
import { guideDone, setGuideDone } from "./guide-state.ts";
import { safeStorage } from "./setup.ts";
// The end screen loads while the game starts, out of the first download.
import type { endScreen } from "./end-screen.ts";
// Only replays show the bar: it loads with the replay, out of the first download.
import type { Sound } from "../audio/sound.ts";
import type { ReplayBar } from "./replay-bar.ts";
import { REPLAY_MAP_CHANGED, REPLAY_SPEEDS } from "../game/replay-file.ts";
import { ClickMarks } from "./click-marks.ts";
import { DiplomacyPanel } from "./diplomacy.ts";
import type { FeedTarget } from "./events-feed.ts";
import type { LandLost } from "./feed-events.ts";
import type { FeedHost } from "./screen/feed-host.ts";
import { Hud } from "./hud.ts";
import { withHidden } from "./hidden-players.ts";
import { PlayerLabels } from "./labels.ts";
import { SpeedControl } from "./speed-control.ts";
import { colorOf } from "../palette.ts";
import { StatsRecorder } from "./screen/stats-history.ts";
import { GameAchievements } from "./screen/game-achievements.ts";
import { gameKey, typingIn } from "./screen/game-keys.ts";
import { GuideHost } from "./screen/guide-host.ts";
import { MapScene } from "./screen/map-scene.ts";
import { Orders } from "./screen/orders.ts";
import { Overlays } from "./screen/overlays.ts";
import { PreviewHost } from "./screen/preview-host.ts";
import { usage, type GameFacts, type GameTracker } from "../usage.ts";

/** How often the turns of an online game are checked for being due. */
const PACER_MS = 10;

/** The replay bar's code, once loadReplayBar has fetched it. */
let replayBarClass: typeof ReplayBar | undefined;

/** Fetches the styles of the game's interface; call it before making any game screen. */
export function loadGameStyles(): Promise<unknown> {
  return import("./game-styles.ts");
}

/** Fetches the replay bar; call it before making the screen of a replay. */
export async function loadReplayBar(): Promise<void> {
  replayBarClass ??= (await import("./replay-bar.ts")).ReplayBar;
}

export interface GameScreenActions {
  onNewGame(): void;
  onMenu(): void;
  /** The game could not start; the key names the message to show. */
  onFailure(key: MessageKey): void;
  /** The player asked for a record of the game, to save. */
  onRecord?(record: GameRecord): void;
}

/**
 * One game on screen: the map, the input that drives the camera and sends
 * orders, the HUD, and the dialogs on top. Owns everything it creates and
 * releases it in dispose().
 */
export class GameScreen {
  readonly element: HTMLElement;
  private readonly scene: MapScene;
  private readonly surface: HTMLElement;
  private input: InputController;
  private readonly hud: Hud;
  /** Solo only (R-MODE-07): online, the host picked the pace in the lobby. */
  private readonly speed: SpeedControl | undefined;
  private readonly session: LocalSession;
  private readonly orders: Orders;
  private readonly overlays: Overlays;
  private readonly cleanups: (() => void)[] = [];
  private latest: GameUpdate | undefined;
  private ended = false;
  /** Set while watching a recorded game: no orders, and a bar to set the pace. */
  private readonly replayBar: ReplayBar | undefined;
  /** Whether the map is a published one, which a record of the game can name. */
  private readonly published: boolean;
  private focused = false;
  private disposed = false;
  private ticksPerSecond = 10;
  /** Lowest id of the nations, who take colours of their own. */
  private firstNation = Infinity;
  /** Team of each player by id, in a team game. */
  private teams: readonly number[] = [];
  /** What the game leaves out (R-MODE-03): its build keys do nothing. */
  private disabled = 0;
  /** Capital mode (R-CAP), for the help. */
  private capitals = false;
  private ownableTiles = 1;
  /** Special rules of the game (R-MODE-08), for the end screen. */
  private special: Readonly<Record<string, boolean>> = {};
  private peakTiles = 0;
  private winShare = 100;
  private stats = new StatsRecorder(10);
  private readonly achievements: GameAchievements;
  /** The sound effects, once their code is fetched; none for a replay. */
  private sound: Sound | undefined;
  private frameHandle = 0;
  private readonly marks = new ClickMarks();
  private readonly labels = new PlayerLabels();
  /** Players hidden on this screen (R-DIPLO-08), for this game only. */
  private readonly hidden = new Set<number>();
  /** Players this page reported (R-MODE-06); the last one leaves if the server turns it down. */
  private readonly reports = new Set<number>();
  private lastReport: number | undefined;
  /** Online: evens out the arrival of the server's turns before the worker plays them. */
  private readonly pacer: TurnPacer;
  /** What a click on the map does, picked in the HUD. */
  private mode: ClickMode = "attack";
  /** Mode of each click the worker has not answered yet, oldest first: it answers each one, in order. */
  private readonly clicksInFlight: ClickMode[] = [];
  private readonly diplomacy: DiplomacyPanel;
  /** What happens in the game, bottom right; a click centres the map on it. */
  /** The feed and the player card, once their code is fetched; none before. */
  private feed: FeedHost | undefined;
  /** Where each player's name goes, as of the last update that said: a place to centre the map on. */
  private anchors: readonly { player: number; tile: number }[] = [];
  /** What a build click would do, shown before it is made. */
  private readonly previews: PreviewHost;
  /** First steps of a first solo game, while they show. */
  private readonly guide: GuideHost;
  /** A finger rather than a mouse: the help shows gestures instead of keys. */
  private readonly coarsePointer = window.matchMedia("(pointer: coarse)");
  /** The end screen's code, once fetched. */
  private endScreen: typeof endScreen | undefined;
  /** The game ended and its end screen is on its way: the pause holds until it shows. */
  private ending = false;
  /** Reports the game once it ends for the player; none for a replay (docs/privacy.md). */
  private readonly tracker: GameTracker | undefined;

  constructor(
    readonly options: SoloOptions,
    map: MapInfo,
    private readonly actions: GameScreenActions,
    /** Online: the connection the game's orders go to; the game then never pauses. */
    private readonly link?: ServerLink,
    /** The view to start with; "globe" also lets G switch views (a prototype, ADR 0005). */
    view: ViewKind = "flat",
    /** What the usage report says about the game; a game without it is not reported. */
    facts?: Omit<GameFacts, "view">,
  ) {
    this.achievements = new GameAchievements(
      `frontfall.credited.${options.map}.${String(options.seed)}`,
    );
    // Input listens on a layer of its own under the HUD, so clicks on panels never reach the map.
    this.surface = document.createElement("div");
    this.scene = new MapScene(this.surface, map, view, (key) => {
      this.actions.onFailure(key);
    });
    this.tracker =
      facts && !options.record
        ? usage().track({ ...facts, view: this.scene.kind }, Date.now())
        : undefined;
    this.published = map.manifest !== undefined;
    this.surface.className = "map-surface";
    this.surface.tabIndex = 0;
    this.surface.id = "map";
    this.surface.setAttribute("role", "application");
    this.surface.dataset.i18nAttr = "aria-label:game.map";
    this.surface.setAttribute("aria-label", t("game.map"));
    this.surface.setAttribute("aria-busy", "true");

    this.hud = new Hud(
      {
        onPause: () => {
          this.togglePause();
        },
        onHelp: () => {
          this.showHelp();
        },
        onMenu: () => {
          this.leave();
        },
        onRetreat: (attack) => {
          this.orders.retreat(attack);
        },
        onMode: (mode) => {
          this.setMode(mode);
        },
        onPlayer: (player) => {
          if (!options.record) this.diplomacy.pick(player);
        },
        onWork: (share) => {
          this.orders.work(share);
        },
      },
      { pausable: link === undefined, touch: () => this.coarsePointer.matches },
    );
    this.diplomacy = new DiplomacyPanel({
      onAlly: (player) => {
        return this.orders.diplomatic("ally", player);
      },
      onEmbargo: (player, on) => {
        this.orders.diplomatic("embargo", player, on);
      },
      onBetray: (player) => {
        this.orders.diplomatic("betray", player);
      },
      onGift: (player, what) => {
        this.orders.gift(player, what);
      },
      share: () => this.hud.ratio,
      onQuick: (player, phrase) => {
        this.orders.quick(player, phrase);
      },
      // Only other people can be hidden: online, and never a nation.
      hidden: (player) =>
        this.link === undefined || player >= this.firstNation ? undefined : this.hidden.has(player),
      onHide: (player, hide) => {
        if (hide) this.hidden.add(player);
        else this.hidden.delete(player);
        this.showNames();
      },
      // Only people can be reported, through a server that takes reports.
      reported: (player) =>
        this.link?.report && this.options.players?.some((p) => p.id === player)
          ? this.reports.has(player)
          : undefined,
      onReport: (player, reason) => {
        this.link?.report?.(player, reason);
        this.reports.add(player);
        this.lastReport = player;
      },
    });
    if (!link && !options.record) {
      this.speed = new SpeedControl(options.speed ?? 1, (speed) => {
        this.session.setSpeed(speed);
      });
      // Help, pause, speed, menu (docs/hud-layout.md).
      this.hud.element.querySelector("#pause")?.after(this.speed.element);
      this.hud.element.classList.add("speedable");
    }
    this.hud.leaderboard.append(this.diplomacy.menu);
    this.hud.element.append(this.diplomacy.requests);
    this.guide = new GuideHost(
      this.hud.element,
      this.coarsePointer,
      () => this.latest,
      () => this.diplomacy.open,
    );
    if (this.guided && !guideDone(safeStorage())) this.guide.start();
    this.element = document.createElement("div");
    this.element.className = "game";
    this.element.append(
      this.surface,
      this.labels.element,
      this.marks.element,
      this.hud.element,
      this.marks.note,
    );
    this.layOut();
    this.overlays = new Overlays(this.element, this.surface, (paused) => {
      this.session.setPaused(paused);
    });

    this.input = this.createInput();
    if (options.record) {
      this.element.classList.add("watching");
      if (!replayBarClass) throw new Error("loadReplayBar() must complete before a replay starts");
      this.replayBar = new replayBarClass(REPLAY_SPEEDS, (speed) => {
        this.session.setSpeed(speed);
      });
      this.element.append(this.replayBar.element);
    }

    this.session = new LocalSession(
      options,
      map,
      {
        onStart: (info) => {
          this.firstNation = info.rules.firstNation;
          this.teams = info.rules.teams;
          this.disabled = info.rules.disabled;
          this.capitals = info.rules.special.capitals;
          this.scene.show({
            map: info.map,
            you: info.you,
            maxPlayer: info.maxPlayer,
            firstNation: info.rules.firstNation,
            teams: info.rules.teams,
            ticksPerSecond: info.rules.ticksPerSecond,
          });
          const minimap = this.scene.minimapElement;
          // First in the HUD, so that every other panel draws over it.
          if (minimap) this.hud.element.prepend(minimap);
          this.ticksPerSecond = info.rules.ticksPerSecond;
          this.winShare = info.rules.winSharePercent;
          this.stats = new StatsRecorder(info.rules.ticksPerSecond);
          this.ownableTiles = info.rules.ownableTiles;
          this.special = { ...info.rules.special };
          if (!options.record) {
            this.achievements.start(info.rules, link ? undefined : options.difficulty);
            // Without it the game goes on in silence.
            import("../audio/sound.ts").then(
              (module) => {
                this.sound = new module.Sound();
              },
              () => undefined,
            );
            // Failing here only leaves showEnd to try again.
            import("./end-screen.ts").then(
              (module) => {
                this.endScreen = module.endScreen;
              },
              () => undefined,
            );
          }
          this.hud.setRules(info.rules);
          // Fetched while the game starts, so H opens the help at once.
          void import("./help.ts");
          this.diplomacy.setRules(info.rules);
          this.feed?.setRules(info.rules);
          // Fetched while the game starts; without it the game goes on without the feed.
          import("./screen/feed-host.ts").then(
            (module) => {
              if (this.disposed) return;
              this.diplomacy.setFacts(module.facts);
              this.feed = new module.FeedHost(
                this.hud.element,
                this.element,
                this.surface,
                (tile) => this.scene.ownerAt(tile),
                !options.record,
                (target) => {
                  this.centre(target);
                },
              );
              this.feed.setRules(info.rules);
            },
            () => undefined,
          );
        },
        onUpdate: (update) => {
          this.apply(update);
        },
        onClick: (tile, outcome, note) => {
          // A refused build names what was refused: the oldest click in flight is the one answered.
          const sent = this.clicksInFlight[0];
          const action =
            sent !== undefined && sent !== "attack" ? t(`hud.${sent}` as MessageKey) : undefined;
          this.marks.show(tile, outcome, performance.now(), link !== undefined, action, note);
          this.afterClick(outcome);
        },
        onPeek: (preview) => {
          this.previews.answer(preview);
        },
        onError: (message) => {
          console.error(message);
          if (message !== REPLAY_MAP_CHANGED) usage().error("worker", message);
          this.actions.onFailure(
            message === REPLAY_MAP_CHANGED ? "replay.unknownMap" : "game.failed",
          );
        },
      },
      link,
    );
    this.previews = new PreviewHost({
      mount: (layer) => {
        this.hud.element.after(layer);
      },
      session: this.session,
      scene: this.scene,
      latest: () => this.latest,
      mode: () => this.mode,
      say: (text) => {
        this.hud.explain(text);
      },
      storage: safeStorage(),
      commit: (tile, finger) => {
        this.commit(tile, finger);
      },
    });
    this.orders = new Orders(this.session, {
      latest: () => this.latest,
      held: () => this.overlays.paused || this.replayBar !== undefined,
      ratio: () => this.hud.ratio,
      tracker: this.tracker,
    });

    const keydown = (event: KeyboardEvent): void => {
      this.key(event);
    };
    window.addEventListener("keydown", keydown);
    const resize = (): void => {
      this.scene.resize();
    };
    window.addEventListener("resize", resize);
    // The tab closes or the page goes away in the middle of the game.
    const hide = (): void => {
      this.tracker?.end("closed", Date.now());
    };
    window.addEventListener("pagehide", hide);
    const motion = (): void => {
      this.scene.setMotion(!motionReduced());
    };
    const stopMotion = onMotionChange(motion);
    const stopLayout = onMotionChange(() => {
      this.layOut();
    });
    window.addEventListener("resize", this.layOut);
    // Online, the host's pace: `speed` turns at each beat of the server (R-MODE-07).
    const speed = options.speed ?? 1;
    this.pacer = new TurnPacer(
      (turns) => {
        this.session.pushTurns(turns);
        const mine = turns.reduce(
          (count, turn) =>
            count + turn.orders.filter((entry) => entry.player === options.you).length,
          0,
        );
        if (mine > 0) this.marks.arrived(mine, performance.now());
      },
      1000 / TICK_RATE / speed,
      speed,
    );
    if (link) {
      // A timer rather than frames: a hidden tab draws nothing but must keep playing.
      const pacing = setInterval(() => {
        this.pacer.update(performance.now());
      }, PACER_MS);
      this.cleanups.push(() => {
        clearInterval(pacing);
      });
    }
    this.cleanups.push(
      () => {
        window.removeEventListener("keydown", keydown);
      },
      () => {
        window.removeEventListener("resize", resize);
      },
      () => {
        window.removeEventListener("pagehide", hide);
      },
      () => {
        stopMotion();
      },
      () => {
        stopLayout();
        window.removeEventListener("resize", this.layOut);
      },
      onLanguageChange(() => {
        applyTranslations(this.surface);
        this.hud.refresh();
        this.speed?.show();
        this.diplomacy.refresh();
        this.feed?.refresh();
        this.guide.refresh();
      }),
    );
  }

  /** Call once the element is in the page, so sizes are known. */
  start(): void {
    this.scene.resize();
    // `?perf` shows the frame time of the map and a report to copy, for measuring a phone.
    if (new URLSearchParams(location.search).has("perf")) {
      void import("./perf-report.ts").then(({ mountPerfReport }) => {
        if (!this.disposed) this.cleanups.push(mountPerfReport(this.element, this.scene));
      });
    }
    let last = performance.now();
    const frame = (now: number): void => {
      this.input.update(now - last);
      last = now;
      this.scene.draw(now);
      const camera = this.scene.camera;
      this.labels.place(camera, camera.scale);
      this.feed?.expire(now);
      this.marks.place(camera, now);
      this.previews.place();
      this.frameHandle = requestAnimationFrame(frame);
    };
    this.frameHandle = requestAnimationFrame(frame);
  }

  /** The wide layout (docs/hud-layout.md) needs its 1240 px at the interface size chosen in the menu. */
  private readonly layOut = (): void => {
    const wide =
      window.innerWidth >= (1240 * accessibility().scale) / 100 && window.innerHeight >= 560;
    this.element.toggleAttribute("data-wide", wide);
  };

  dispose(): void {
    // Leaving for the menu or a new game without an ending of its own.
    this.tracker?.end(this.out() ? "defeat" : "left", Date.now());
    cancelAnimationFrame(this.frameHandle);
    this.disposed = true;
    this.feed?.dispose();
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.session.dispose();
    this.sound?.dispose();
    this.input.dispose();
    this.scene.dispose();
    this.element.remove();
  }

  private createInput(): InputController {
    return new InputController(this.surface, this.scene.camera, {
      onTileClick: (tile, finger) => {
        this.click(tile, finger);
      },
      onTileHold: (tile) => {
        if (!this.replayBar) this.diplomacy.pick(this.scene.ownerAt(tile));
      },
      onHover: (tile) => {
        this.scene.hover(tile);
        // The attack preview is about land: the sea and impassable ground have none.
        const land = tile !== undefined && this.scene.isLand(tile);
        this.hud.hover(land ? this.scene.ownerAt(tile) : undefined);
        // The card is about land too, whoever holds it.
        this.feed?.over(land ? this.scene.ownerAt(tile) : 0);
        this.previews.hover(tile);
      },
    });
  }

  /** Flat map to globe and back in a running game, the input wired to the new camera. */
  private switchView(): void {
    if (!this.scene.switchKind()) return;
    this.input.dispose();
    this.input = this.createInput();
  }

  /** Names and messages again after a player was hidden or shown (R-DIPLO-08). */
  private showNames(): void {
    if (!this.latest) return;
    const update = { ...withHidden(this.latest, this.hidden), events: [] };
    this.labels.update(update.players, undefined);
    this.hud.update(update, performance.now());
    this.diplomacy.rename(update);
  }

  /** Centres the map on a tile, else on the land of a player. */
  private centre({ tile, player }: FeedTarget): void {
    if (tile !== undefined) this.scene.centerOn(tile);
    else if (player !== undefined) {
      const anchor = this.anchors.find((a) => a.player === player);
      if (anchor) this.scene.centerOn(anchor.tile);
      else this.scene.focusOn(player);
    }
  }

  private apply(update: GameUpdate): void {
    // Read before the map takes the update in: it tells what the update took from the player.
    const lost: LandLost | undefined =
      this.options.record === undefined ? this.feed?.lost(update) : undefined;
    if (update.labels) this.anchors = update.labels;
    this.scene.update(update);
    this.previews.update(performance.now());
    const human = update.players.find((player) => player.id === update.you);
    if (human) this.peakTiles = Math.max(this.peakTiles, human.tiles);
    this.achievements.observe(update);
    this.sound?.observe(update);
    if (human) this.guide.follow(update, human.tiles);
    if (!this.focused && human && human.tiles > 0) {
      // Once, when the player's start appears.
      this.focused = true;
      this.scene.focusOn(update.you);
    }
    this.latest = update;
    // What this screen shows from here on: hidden players go by their number.
    update = withHidden(update, this.hidden);
    if (!this.replayBar) this.stats.observe(update);
    this.labels.update(update.players, update.labels);
    this.hud.update(update, performance.now());
    this.diplomacy.update(update);
    this.feed?.observe(update, lost ?? new Map(), performance.now(), this.hud.element);
    // The panels grow and shrink with their content: measured once per update.
    this.labels.avoid(
      [...this.hud.element.children]
        .map((child) => child.getBoundingClientRect())
        .filter((rect) => rect.width > 0),
    );
    if (update.replay) this.replayBar?.update(update.tick, update.replay, this.ticksPerSecond);
    if (update.winner !== undefined && !this.ended && !this.replayBar) {
      this.ended = true;
      this.hud.update(update, performance.now(), true);
      const team = update.winningTeam;
      const won =
        team === undefined ? update.winner === update.you : this.teams[update.you] === team;
      this.tracker?.end(won ? "victory" : "defeat", Date.now());
      this.showEnd(update);
    }
  }

  private click(tile: number, finger = false): void {
    // A finger's first tap in a build mode shows where it would go; the second places it.
    if (this.previews.tap(tile, finger)) return;
    this.commit(tile, finger);
  }

  private commit(tile: number, finger: boolean): void {
    const reach = aimReach(this.scene.camera.scale, finger);
    if (!this.orders.click(tile, this.mode, reach)) return;
    // A build mode stays on until a structure goes up (afterClick): a click
    // made while the worker answers the one before is still a build click.
    this.clicksInFlight.push(this.mode);
  }

  /** One structure per pick of the button: once a build click goes through, clicks attack again. */
  private afterClick(outcome: ClickOutcome): void {
    const sent = this.clicksInFlight.shift();
    const built = outcome === "build" || outcome === "demolish" || outcome === "missile";
    if (built && sent !== undefined && sent === this.mode) this.setMode("attack");
  }

  /** Picking the current mode again goes back to attacking. */
  private setMode(mode: ClickMode): void {
    this.mode = mode === this.mode ? "attack" : mode;
    this.hud.setMode(this.mode);
    this.surface.dataset.mode = this.mode;
    this.previews.modeChanged(this.mode);
  }

  private key(event: KeyboardEvent): void {
    if (typingIn(event.target)) return;
    const action = gameKey(event, {
      overlay: this.overlays.open,
      menu: this.diplomacy.open,
      mode: this.mode,
      watching: this.replayBar !== undefined,
      disabled: this.disabled,
      globeAllowed: this.scene.globeAllowed,
    });
    if (!action) return;
    if (action.type === "closeOverlay") this.overlays.close();
    else if (action.type === "closeMenu") this.diplomacy.close();
    else if (action.type === "mode") this.setMode(action.mode);
    else if (action.type === "ratio") this.hud.setRatio(action.percent);
    else if (action.type === "pause") this.togglePause();
    else if (action.type === "speed") this.speed?.next();
    else if (action.type === "switchView") this.switchView();
    else this.showHelp();
    event.preventDefault();
  }

  /** Back to the menu; asks first while the player still has a game to lose. */
  private leave(): void {
    const latest = this.latest;
    const human = latest?.players.find((player) => player.id === latest.you);
    const playing = !this.replayBar && !this.ended && human?.alive === true && human.tiles > 0;
    if (playing && !window.confirm(t("hud.leaveConfirm"))) return;
    this.actions.onMenu();
  }

  /** Whether the player has been wiped out of the game. */
  private out(): boolean {
    const latest = this.latest;
    const human = latest?.players.find((player) => player.id === latest.you);
    return human !== undefined && (!human.alive || human.tiles === 0) && this.focused;
  }

  /** Online: the server turned down a report, as too many came from this address lately. */
  reportRefused(): void {
    if (this.lastReport !== undefined) this.reports.delete(this.lastReport);
    this.diplomacy.reportRefused();
  }

  /** Online: the game was lost to the connection, or stopped by the server. */
  disconnected(): void {
    this.tracker?.end(this.out() ? "defeat" : "disconnected", Date.now());
  }

  /** Online: the server flagged this client's state hash after `tick`. */
  desync(tick: number, expected: number | null): void {
    usage().error("desync");
    this.session.desync(tick, expected);
  }

  /** Online: the game so far as a desync report, or none on a generated map. */
  desyncReport(): Promise<DesyncReport | undefined> {
    return this.session.report();
  }

  /** The game so far, to watch again; none on a generated map or in a replay. */
  record(): Promise<GameRecord | undefined> {
    return this.session.record();
  }

  /** Online: turns relayed by the server, in order. */
  pushTurns(turns: Turn[]): void {
    this.pacer.push(turns, performance.now());
    this.pacer.update(performance.now());
  }

  private togglePause(): void {
    if (this.ending) return;
    if (this.link) {
      // An online game runs for everyone: Esc only closes what is open.
      if (this.overlays.open) this.overlays.close();
      return;
    }
    if (this.overlays.paused) {
      this.overlays.close();
      return;
    }
    this.overlays.showPause(this.speed?.choices());
  }

  /** The guide is for a solo game, not online and not in a replay. */
  private get guided(): boolean {
    return this.link === undefined && this.options.record === undefined;
  }

  private showHelp(): void {
    void import("./help.ts").then(({ helpPanel }) => {
      this.openHelp(helpPanel);
    });
  }

  private openHelp(helpPanel: typeof import("./help.ts").helpPanel): void {
    if (this.ending) return;
    if (!this.link) this.overlays.pause();
    this.overlays.show(
      helpPanel({
        build: this.latest?.build,
        disabled: this.disabled,
        capitals: this.capitals,
        touch: this.coarsePointer.matches,
        online: this.link !== undefined,
        onClose: () => {
          this.overlays.close();
        },
        onGuide: this.guided
          ? () => {
              setGuideDone(safeStorage(), false);
              this.overlays.close();
              this.guide.start();
            }
          : undefined,
      }),
    );
  }

  private showEnd(update: GameUpdate): void {
    // A solo game waits behind the end screen, so its record ends where the game did.
    if (!this.link) this.overlays.pause();
    // Fetched long before, unless the game ended within moments of its start.
    if (this.endScreen) this.openEnd(this.endScreen, update);
    else {
      this.ending = true;
      import("./end-screen.ts").then(
        ({ endScreen }) => {
          this.ending = false;
          this.openEnd(endScreen, update);
        },
        (error: unknown) => {
          // No end screen to show: the game goes on rather than stay frozen.
          console.error(error);
          this.ending = false;
          this.overlays.close();
        },
      );
    }
  }

  private openEnd(screen: typeof endScreen, update: GameUpdate): void {
    this.overlays.show(
      screen(
        {
          update,
          ticksPerSecond: this.ticksPerSecond,
          ownableTiles: this.ownableTiles,
          peakTiles: this.peakTiles,
          stats: this.stats.finish(update),
          winShare: this.winShare,
          color: (player) => colorOf(player, this.firstNation, this.teams),
          achievements: this.achievements.earned,
          // Only a published map can be pinned in a record.
          canRecord: this.published,
          teams: this.teams,
          special: this.special,
          details: `${this.options.map}, ${usage().device().device}`,
          kind: this.link ? "online" : this.options.record ? "replay" : "solo",
        },
        this.tracker,
        {
          onNewGame: () => {
            this.actions.onNewGame();
          },
          onMenu: () => {
            this.actions.onMenu();
          },
          onWatch: () => {
            this.overlays.close();
          },
          onDownload: () => {
            void this.record().then((record) => {
              if (record) this.actions.onRecord?.(record);
            });
          },
        },
      ),
    );
  }
}
