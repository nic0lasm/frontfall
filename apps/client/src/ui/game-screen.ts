import type { DesyncReport, GameRecord, Turn } from "@frontfall/engine";
import type { Sound } from "../audio/sound.ts";
import type { GameRules } from "../game/messages.ts";
import type { ServerLink } from "../game/online-session.ts";
import { REPLAY_MAP_CHANGED } from "../game/replay-file.ts";
import { youOf } from "../game/selectors.ts";
import type { GameSession, SessionCapabilities, SessionEvents } from "../game/session.ts";
import { openSession } from "../game/sessions.ts";
import type { GameSnapshot, GameUpdate, SoloOptions } from "../game/game-runner.ts";
import { SOLO_SNAPSHOT_REFUSED } from "../game/solo-session.ts";
import { applyTranslations, onLanguageChange, t, type MessageKey } from "../i18n/index.ts";
import type { MapInfo, MapLandmarkData } from "../maps.ts";
import { probe } from "../probe.ts";
import type { ViewKind } from "../render/renderer.ts";
import { safeStorage } from "../storage.ts";
import { usage, type GameFacts } from "../usage.ts";
import { accessibility, motionReduced, onMotionChange } from "./accessibility.ts";
import { AlertFrame } from "./alert-frame.ts";
import { ClickMarks } from "./click-marks.ts";
import type { FeedTarget } from "./events-feed.ts";
import type { LandLost } from "./feed-events.ts";
import { guideDone } from "./guide-state.ts";
import { haptic } from "./haptics.ts";
import type { ReplayBar } from "./replay-bar.ts";
import { DialogHost, type DialogActions } from "./screen/dialog-host.ts";
import type { FeedHost } from "./screen/feed-host.ts";
import { gameKey, typingIn } from "./screen/game-keys.ts";
import { GuideHost } from "./screen/guide-host.ts";
import { InputHost } from "./screen/input-host.ts";
import { FLAT_VIEW, MapScene, type SceneView } from "./screen/map-scene.ts";
import { Orders } from "./screen/orders.ts";
import { GameOutcome } from "./screen/outcome.ts";
import { Overlays } from "./screen/overlays.ts";
import { PanelHost } from "./screen/panel-host.ts";
import { PreviewHost } from "./screen/preview-host.ts";

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

export interface GameScreenActions extends DialogActions {
  /** The game could not start; the key names the message to show. */
  onFailure(key: MessageKey): void;
  /** Solo: the game as it stands, now and then, to keep for a reload. */
  onSnapshot?(snapshot: GameSnapshot): void;
  /** The game is decided: a reload no longer comes back to it. */
  onDecided?(): void;
  /** G switched the view between the flat map and the globe. */
  onView?(kind: ViewKind): void;
}

/**
 * One game on screen. It only wires the parts together: the session of the
 * game's mode, the map (MapScene), the pointer on it (InputHost), the panels
 * (PanelHost), the dialogs (DialogHost), the feed, the guide and the
 * previews of the other hosts. Owns everything it creates and releases it
 * in dispose().
 */
export class GameScreen {
  readonly element: HTMLElement;
  private readonly scene: MapScene;
  private readonly surface: HTMLElement;
  private readonly session: GameSession;
  /** What the game's mode lets the screen do. */
  private readonly can: SessionCapabilities;
  private readonly orders: Orders;
  private readonly overlays: Overlays;
  private readonly panels: PanelHost;
  private readonly input: InputHost;
  private readonly dialogs: DialogHost;
  /** What a build click would do, shown before it is made. */
  private readonly previews: PreviewHost;
  /** First steps of a first solo game, while they show. */
  private readonly guide: GuideHost;
  /** The feed and the player card, once their code is fetched; none before. */
  private feed: FeedHost | undefined;
  private readonly marks = new ClickMarks();
  /** A red rim while the player loses land or a ship sails for their coast. */
  private readonly alert = new AlertFrame();
  private readonly cleanups: (() => void)[] = [];
  private latest: GameUpdate | undefined;
  /** The rules of the game, once it started. */
  private rules: GameRules | undefined;
  /** The map's landmarks (R-LAND-01), none on most maps. */
  private landmarks: readonly MapLandmarkData[] = [];
  /** Where each player's name goes, as of the last update that said: a place to centre the map on. */
  private anchors: readonly { player: number; tile: number }[] = [];
  /** How the game goes for the player: the usage report, the achievements, the end. */
  private readonly outcome: GameOutcome;
  /** The map was centred on the player's start. */
  private focused = false;
  private disposed = false;
  /** The sound effects, once their code is fetched; none for a replay. */
  private sound: Sound | undefined;
  private frameHandle = 0;
  /** The HUD's panels may have changed since they were last measured (`clearPanels`). */
  private panelsMoved = true;
  /** A finger rather than a mouse: the help shows gestures instead of keys. */
  private readonly coarsePointer = window.matchMedia("(pointer: coarse)");

  constructor(
    readonly options: SoloOptions,
    map: MapInfo,
    private readonly actions: GameScreenActions,
    /** Online: the connection the game's orders go to; the game then never pauses. */
    link?: ServerLink,
    /** The view to start with, and whether G may switch to the globe (a prototype, ADR 0005). */
    view: SceneView = FLAT_VIEW,
    /** What the usage report says about the game; a game without it is not reported. */
    facts?: Omit<GameFacts, "view">,
  ) {
    // A replay needs the code of its bar, checked before the session starts a worker.
    if (options.record && !replayBarClass) {
      throw new Error("loadReplayBar() must complete before a replay starts");
    }
    // Its events come once the worker answers, when everything below is in place.
    this.session = openSession(
      options,
      map,
      this.sessionEvents(options),
      link,
      actions.onSnapshot
        ? (snapshot) => {
            if (!this.outcome.ended && !this.disposed) actions.onSnapshot?.(snapshot);
          }
        : undefined,
    );
    const can = this.session.capabilities;
    this.can = can;
    // Input listens on a layer of its own under the HUD, so clicks on panels never reach the map.
    const surface = document.createElement("div");
    this.surface = surface;
    this.scene = new MapScene(surface, map, view, (key) => {
      this.actions.onFailure(key);
    });
    // A game with the operator's bonuses is a test (R-MODE-09): it counts for nothing.
    const tracker =
      facts && can.canOrder && !options.operator
        ? usage().track({ ...facts, view: this.scene.kind }, Date.now())
        : undefined;
    this.outcome = new GameOutcome({
      can,
      map: options.map,
      seed: options.seed,
      published: map.manifest !== undefined,
      tracker,
      onDecided: actions.onDecided?.bind(actions),
    });
    surface.className = "map-surface";
    surface.tabIndex = 0;
    surface.id = "map";
    surface.setAttribute("role", "application");
    surface.dataset.i18nAttr = "aria-label:game.map";
    surface.setAttribute("aria-label", t("game.map"));
    surface.setAttribute("aria-busy", "true");
    this.scene.home = () => {
      this.goHome();
    };

    this.orders = new Orders(this.session, {
      act: () => ({ can, paused: this.overlays.paused, latest: this.latest }),
      ratio: () => this.panels.hud.ratio,
      tracker,
    });
    this.panels = new PanelHost({
      can,
      session: this.session,
      orders: this.orders,
      options,
      touch: () => this.coarsePointer.matches,
      replayBar: options.record ? replayBarClass : undefined,
      actions: {
        onPause: () => {
          this.dialogs.togglePause();
        },
        onHelp: () => {
          this.dialogs.showHelp();
        },
        onMenu: () => {
          this.dialogs.leave(this.outcome.playing);
        },
        onCentre: (target) => {
          this.centre(target);
        },
        onCounter: (attacker, troops) => {
          const anchor = this.anchors.find((a) => a.player === attacker);
          if (anchor) this.orders.retaliate(anchor.tile, troops);
        },
        onMode: (mode) => {
          this.input.setMode(mode);
        },
        onLand: (tile) => {
          this.input.land(tile);
        },
      },
    });
    const { hud } = this.panels;
    this.guide = new GuideHost(
      hud.element,
      this.coarsePointer,
      () => this.latest,
      () => {
        this.dialogs.showOutro();
      },
    );
    if (can.guided && (options.tutorial || !guideDone(safeStorage()))) {
      this.guide.start(options.tutorial === true ? "bases" : "first");
    }
    this.element = document.createElement("div");
    this.element.className = "game";
    this.element.append(
      surface,
      this.panels.labels.element,
      this.marks.element,
      this.panels.goldFloats.element,
      hud.element,
      this.alert.element,
      this.marks.note,
    );
    this.layOut();
    this.overlays = new Overlays(this.element, surface, (paused) => {
      this.session.setPaused(paused);
    });
    this.dialogs = new DialogHost({
      overlays: this.overlays,
      can,
      tutorial: options.tutorial === true,
      actions,
      guide: this.guide,
      paceChoices: () => this.panels.speed?.choices(),
      latest: () => this.latest,
      rules: () => this.rules,
      landmarks: () => this.landmarks,
      ownerAt: (tile) => this.scene.ownerAt(tile),
      touch: () => this.coarsePointer.matches,
      summary: (update) => this.outcome.summary(update),
      record: () => this.record(),
      tracker,
      disposed: () => this.disposed,
    });
    this.previews = new PreviewHost({
      mount: (layer) => {
        hud.element.after(layer);
      },
      session: this.session,
      scene: this.scene,
      latest: () => this.latest,
      mode: () => this.input.mode,
      say: (text) => {
        hud.explain(text);
      },
      storage: safeStorage(),
      commit: (tile, finger) => {
        this.input.commit(tile, finger);
      },
    });
    this.input = new InputHost({
      surface,
      scene: this.scene,
      can,
      orders: this.orders,
      previews: this.previews,
      marks: this.marks,
      hud,
      latest: () => this.latest,
      landmarks: () => this.landmarks,
      feed: () => this.feed,
      pick: (player, tile) => {
        this.panels.diplomacy.pick(player, tile);
      },
    });
    const bar = this.panels.replayBar;
    if (bar) {
      this.element.classList.add("watching");
      this.element.append(bar.element);
    }
    this.listen();
  }

  /** The page's events the game follows, each removed in dispose(). */
  private listen(): void {
    const on = <K extends keyof WindowEventMap>(
      type: K,
      run: (event: WindowEventMap[K]) => void,
    ): void => {
      window.addEventListener(type, run);
      this.cleanups.push(() => {
        window.removeEventListener(type, run);
      });
    };
    on("keydown", (event) => {
      this.key(event);
    });
    on("resize", () => {
      this.scene.resize();
      this.panelsMoved = true;
    });
    on("resize", this.layOut);
    // The tab closes or the page goes away in the middle of the game.
    on("pagehide", () => {
      this.outcome.left("closed");
    });
    // A phone may close a page in the background without a word: the game is kept first.
    const hidden = (): void => {
      if (document.visibilityState === "hidden") this.session.requestSnapshot();
    };
    document.addEventListener("visibilitychange", hidden);
    this.cleanups.push(
      () => {
        document.removeEventListener("visibilitychange", hidden);
        this.guide.dispose();
        this.alert.dispose();
      },
      onMotionChange(() => {
        this.scene.setMotion(!motionReduced());
      }),
      onMotionChange(this.layOut),
      onLanguageChange(() => {
        applyTranslations(this.surface);
        this.panels.translate();
        this.feed?.refresh();
        this.guide.refresh();
      }),
    );
  }

  /** What the screen does with what the session says: the start, each update, the answers to clicks. */
  private sessionEvents(options: SoloOptions): SessionEvents {
    return {
      onStart: (info) => {
        const { rules } = info;
        this.rules = rules;
        this.landmarks = info.map.landmarks;
        this.scene.show({
          map: info.map,
          you: info.you,
          maxPlayer: info.maxPlayer,
          firstNation: rules.firstNation,
          teams: rules.teams,
          ticksPerSecond: rules.ticksPerSecond,
        });
        const { hud } = this.panels;
        const minimap = this.scene.minimapElement;
        // First in the HUD, so that every other panel draws over it.
        if (minimap) hud.element.prepend(minimap);
        this.outcome.start(rules, options.difficulty);
        if (this.can.canOrder) {
          // Without it the game goes on in silence.
          import("../audio/sound.ts").then(
            (module) => {
              if (this.disposed) return;
              this.sound = new module.Sound(() => this.scene.camera, haptic);
            },
            () => undefined,
          );
          this.dialogs.preload();
        }
        this.panels.setRules(rules);
        // Fetched while the game starts, so H opens the help at once.
        void import("./help.ts");
        this.feed?.setRules(rules);
        // A solo game taken back after a reload waits for the player to look again.
        if (this.can.canPause && options.snapshot) {
          this.overlays.showPause(this.panels.speed?.choices());
        }
        // Fetched while the game starts; without it the game goes on without the feed.
        import("./screen/feed-host.ts").then(
          (module) => {
            if (this.disposed) return;
            this.panels.setFacts(module.facts);
            this.feed = new module.FeedHost(
              hud.element,
              this.element,
              this.surface,
              (tile) => this.scene.ownerAt(tile),
              this.can.canOrder,
              (target) => {
                this.centre(target);
              },
              info.map.landmarks,
            );
            this.feed.setRules(rules);
          },
          () => undefined,
        );
      },
      onUpdate: (update) => {
        probe.time("update (apply)", () => {
          this.apply(update);
        });
      },
      onClick: (tile, outcome, note) => {
        // A refused build names what was refused: the oldest click in flight is the one answered.
        const sent = this.input.answering;
        const action =
          sent !== undefined && sent !== "attack" && sent !== "boat"
            ? t(`hud.${sent}` as MessageKey)
            : undefined;
        this.marks.show(tile, outcome, performance.now(), this.can.relayed, action, note);
        this.input.answered(outcome);
      },
      onPeek: (preview) => {
        this.previews.answer(preview);
      },
      onError: (message) => {
        console.error(message);
        if (message !== REPLAY_MAP_CHANGED && message !== SOLO_SNAPSHOT_REFUSED) {
          usage().error("worker", message);
        }
        this.actions.onFailure(
          message === REPLAY_MAP_CHANGED
            ? "replay.unknownMap"
            : message === SOLO_SNAPSHOT_REFUSED
              ? "resume.failed"
              : "game.failed",
        );
      },
      onArrived: (orders) => {
        this.marks.arrived(orders, performance.now());
      },
    };
  }

  /** Call once the element is in the page, so sizes are known. */
  start(): void {
    this.scene.resize();
    // The practice game waits behind its introduction, unless it comes back from a reload.
    if (this.options.tutorial && !this.options.snapshot) this.dialogs.showIntro();
    // `?perf` shows the frame time of the map and a report to copy, for measuring a phone.
    if (new URLSearchParams(location.search).has("perf")) {
      probe.on = true;
      void import("./perf-report.ts").then(({ mountPerfReport }) => {
        if (!this.disposed) this.cleanups.push(mountPerfReport(this.element, this.scene));
      });
    }
    let last = performance.now();
    const frame = (now: number): void => {
      if (this.panelsMoved) this.clearPanels();
      if (probe.on) probe.add("raf gap", now - last);
      const begun = probe.on ? performance.now() : 0;
      let phase = probe.mark();
      this.input.update(now - last);
      probe.since("input", phase);
      last = now;
      phase = probe.mark();
      this.scene.draw(now);
      probe.since("draw (all)", phase);
      const camera = this.scene.camera;
      phase = probe.mark();
      this.panels.labels.place(camera, camera.scale);
      probe.since("labels", phase);
      phase = probe.mark();
      this.feed?.expire(now);
      this.marks.place(camera, now);
      this.panels.goldFloats.place(camera, now);
      this.previews.place();
      probe.since("feed+marks+floats+previews", phase);
      if (probe.on) probe.add("frame js", performance.now() - begun);
      this.frameHandle = requestAnimationFrame(frame);
    };
    this.frameHandle = requestAnimationFrame(frame);
  }

  /**
   * Where the HUD's panels sit, for the feed to go under the guide and the
   * labels to keep clear of them all. Read at the start of a frame, before
   * the frame writes anything, so the browser lays the page out once for both:
   * read right after an update wrote to the HUD, they forced a layout of their
   * own, a millisecond or more ten times a second.
   */
  private clearPanels(): void {
    this.panelsMoved = false;
    const panels = [...this.panels.hud.element.children];
    const guide = panels.find((panel) => panel.classList.contains("guide"));
    this.feed?.clearOf(guide?.getBoundingClientRect());
    this.panels.labels.avoid(
      panels.map((panel) => panel.getBoundingClientRect()).filter((rect) => rect.width > 0),
    );
  }

  /** The wide layout (docs/hud-layout.md) needs its 1240 px at the interface size chosen in the menu. */
  private readonly layOut = (): void => {
    const wide =
      window.innerWidth >= (1240 * accessibility().scale) / 100 && window.innerHeight >= 560;
    this.element.toggleAttribute("data-wide", wide);
    this.panelsMoved = true;
  };

  dispose(): void {
    this.panels.dispose();
    // Leaving for the menu or a new game without an ending of its own.
    this.outcome.left("left");
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

  /** Back to the player's own land, wherever the map was moved to. */
  private goHome(): void {
    const you = this.latest?.you;
    if (you !== undefined) this.centre({ player: you });
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
    const { can } = this;
    // Read before the map takes the update in: it tells what the update took from the player.
    const lost: LandLost | undefined = can.canOrder ? this.feed?.lost(update) : undefined;
    if (update.labels) this.anchors = update.labels;
    this.scene.update(update);
    this.previews.update(performance.now());
    const human = youOf(update);
    this.sound?.observe(update);
    if (can.canOrder) this.alert.observe(update);
    if (human) this.guide.follow(update, human.tiles);
    if (can.guided) this.guide.hint(update);
    if (!this.focused && human && human.tiles > 0) {
      // Once, when the player's start appears.
      this.focused = true;
      this.scene.focusOn(update.you);
    }
    this.latest = update;
    // The panels watching it run now; from here on hidden players go by their number.
    const shown = this.panels.show(update);
    const decided = this.outcome.observe(update, shown, this.scene.report().frameMs);
    this.feed?.observe(shown, lost ?? new Map(), performance.now());
    // The panels grow and shrink with their content: measured on the next frame.
    this.panelsMoved = true;
    if (decided) {
      this.panels.drawNow(shown);
      // The guide and the attacks in progress mean nothing once the game is decided.
      this.element.classList.add("decided");
      this.dialogs.showEnd(shown);
    }
  }

  private key(event: KeyboardEvent): void {
    if (typingIn(event.target)) return;
    const { panels, input } = this;
    const action = gameKey(event, {
      overlay: this.overlays.open,
      menu: panels.diplomacy.open,
      mode: input.mode,
      watching: !this.can.canOrder,
      disabled: this.rules?.disabled ?? 0,
      globeAllowed: this.scene.globeAllowed,
      plainTarget: !(
        event.target instanceof HTMLElement &&
        event.target.closest("button, a, [role=button], summary")
      ),
    });
    if (!action) return;
    if (action.type === "closeOverlay") this.overlays.close();
    else if (action.type === "closeMenu") panels.diplomacy.close();
    else if (action.type === "mode") input.setMode(action.mode);
    else if (action.type === "ratio") panels.hud.setRatio(action.percent);
    else if (action.type === "pause") this.dialogs.togglePause();
    else if (action.type === "speed") panels.speed?.next();
    else if (action.type === "switchView") {
      if (input.switchView()) this.actions.onView?.(this.scene.kind);
    } else if (action.type === "home") this.goHome();
    else this.dialogs.showHelp();
    event.preventDefault();
  }

  /** Online: the server turned down a report, as too many came from this address lately. */
  reportRefused(): void {
    this.panels.reportRefused();
  }

  /** Online: the game was lost to the connection, or stopped by the server. */
  disconnected(): void {
    this.outcome.left("disconnected");
  }

  /** Online: the server flagged this client's state hash after `tick`. */
  desync(tick: number, expected: number | null): void {
    usage().error("desync");
    this.session.desync(tick, expected);
  }

  /** Online: the game so far as a desync report, or none on a generated map. */
  desyncReport(): Promise<DesyncReport | undefined> {
    return this.session.desyncReport();
  }

  /** The game so far, to watch again; none on a generated map or in a replay. */
  record(): Promise<GameRecord | undefined> {
    return this.session.record();
  }

  /** Online: turns relayed by the server, in order. */
  pushTurns(turns: Turn[]): void {
    this.session.pushTurns(turns);
  }
}
