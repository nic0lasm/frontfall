import type { GameRecord } from "@frontfall/engine";
import type { Teams } from "@frontfall/protocol";
import { AchievementStore } from "../achievements/store.ts";
import { DEFAULT_DIFFICULTY, defaultRules } from "../game/defaults.ts";
import { readReplayFile, replayFile, replayFileName } from "../game/replay-file.ts";
import { HUMAN_ID } from "../game/simulation.ts";
import {
  forgetSnapshot,
  forgetSoloGame,
  storeSoloGame,
  storedSnapshot,
  storedSoloGame,
  type SoloSave,
} from "../game/snapshot-store.ts";
import { applyTranslations, loadLanguage, onLanguageChange, t } from "../i18n/index.ts";
import { fetchMaps, QUICK_MAP, type MapInfo } from "../maps.ts";
import { watchPublicGames } from "../net/public-games.ts";
import { awaySeat, forgetSeat, saveSeat, seatHeldFor, seatIn } from "../net/seat.ts";
import { preferColor } from "../palette.ts";
import type { ViewKind } from "../render/renderer.ts";
import { safeStorage } from "../storage.ts";
import type { GameScreen, GameScreenActions } from "../ui/game-screen.ts";
import { JoinScreen } from "../ui/join.ts";
import { Menu } from "../ui/menu.ts";
import type { LocalProfile } from "../ui/profile.ts";
import type { SceneView } from "../ui/screen/map-scene.ts";
import { forgetSetup, initialSetup, saveSetup, type GameSetup } from "../ui/setup.ts";
import { usage } from "../usage.ts";
import { hasWebGL2 } from "../webgl-support.ts";
import {
  addressOf,
  bootIntent,
  parseView,
  testingOptions,
  withView,
  type TestingOptions,
  type ViewChoice,
} from "./address.ts";
import { loadGameWithStyles, warmGameMap, type GameModule } from "./game-code.ts";
import { download, Notices } from "./notices.ts";
import { OnlineFlow, type OnlineApp } from "./online.ts";
import { ScreenHost } from "./screen-host.ts";
import { next, showsGame, usageScreen, type AppEvent, type AppState } from "./state.ts";

/** The map of the tutorial, small and with a coast, a neck to defend and room for a port. */
const TUTORIAL_MAP = "strait";

/**
 * What the practice game plays with beyond its setup: a few city-states with
 * no nation to bring them (R-BOT-29), a long spawn phase to read the choices
 * in, and double speed so that the first buildings come within minutes.
 */
const TUTORIAL_GAME = { cityStates: 4, spawnSeconds: 60, speed: 2 } as const;

/** Runs `run` once the browser has nothing else to do, or after `fallbackMs` where it cannot tell. */
function whenIdle(run: () => void, timeoutMs: number, fallbackMs: number): void {
  if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: timeoutMs });
  else setTimeout(run, fallbackMs);
}

/** Replaces the address with a query string, keeping the page's path (ADR 0004). */
function replaceAddress(search: string): void {
  // A query alone keeps the path; an empty one needs the path to drop the old query.
  history.replaceState(null, "", search || location.pathname);
}

/**
 * The page (ADR 0013): its state, the one screen that shows it, and the
 * address bar kept in step with it. Every way into a game, every way out
 * of one, and the online games' connection go through here.
 */
export class App implements OnlineApp {
  readonly screens = new ScreenHost(document.body);
  readonly notices = new Notices();
  /** localStorage, where touching it does not throw. */
  private readonly storage = safeStorage();
  private state: AppState = { screen: "boot" };
  private readonly online: OnlineFlow;
  private mapList: readonly MapInfo[] = [];
  private chosen!: GameSetup;
  /** The game on screen, while it is the screen shown. */
  private shownGame: GameScreen | undefined;
  /** The view of the games, while the globe is on (`?view=`), read once as the page opens. */
  private view: ViewChoice | undefined;
  private readonly testing: TestingOptions;
  /** The profile, loaded with its code when first needed: not part of the first download. */
  private loadedProfile: Promise<LocalProfile> | undefined;
  /** Writes to the solo game kept, one after the other so that a forget is never overtaken. */
  private soloWrites: Promise<void> = Promise.resolve();

  constructor() {
    this.online = new OnlineFlow(this);
    const { search } = location;
    // Read before the address bar is rewritten.
    this.testing = testingOptions(search);
    this.view = parseView(search);
  }

  get game(): GameScreen | undefined {
    return this.shownGame && this.screens.current === this.shownGame ? this.shownGame : undefined;
  }

  maps(): readonly MapInfo[] {
    return this.mapList;
  }

  setup(): GameSetup {
    return this.chosen;
  }

  /**
   * Moves to the state `event` leads to, and writes its address; false when
   * the state does not answer `event`. The first screen keeps the address
   * the page was opened with: the sign-in reads it.
   */
  go(event: AppEvent): boolean {
    const to = next(this.state, event);
    if (!to) return false;
    const from = this.state;
    this.state = to;
    // A game left for the menu or a lobby is not kept in memory by the app.
    if (!showsGame(to)) this.shownGame = undefined;
    document.body.dataset.screen = to.screen;
    usage().screen = usageScreen(to);
    if (from.screen === "boot") return true;
    const address = addressOf(to, this.view);
    if (address !== undefined) replaceAddress(address);
    return true;
  }

  /** Opens the page: its language and maps first, then the screen its address asks for. */
  boot(): void {
    this.listen();
    const { search } = location;
    const ready = Promise.all([
      // The page's own language: until it is there, the page shows its English markup.
      loadLanguage(),
      fetchMaps(location.href).then((list) => {
        this.mapList = list;
        this.chosen = initialSetup(search, this.storage, list);
      }),
    ]);
    void ready.then(() => {
      applyTranslations(document);
      const intent = bootIntent(search);
      // An invitation link joins its game; ?online, the next public one.
      if (intent.kind === "invite") {
        const { game } = intent;
        const token = seatIn(game);
        // A seat taken back after a reload, or a name in the link, needs no question.
        if (token) {
          // From where this tab left the game, when it kept a snapshot of it (#39).
          void storedSnapshot(game).then((snapshot) => {
            this.online.enter({ type: "resume", game, token }, this.chosen, snapshot);
          });
        } else if (intent.named) this.online.enter({ type: "join", game });
        else this.askName(game);
      } else if (intent.kind === "online") {
        this.online.enter({ type: "play", name: this.defaultGameName() });
      } else this.showMenuOrResume();
      // Creating a WebGL context takes a while on some devices: the check waits for the menu to be
      // up and the browser idle. Play and the online entries make their own check before starting.
      whenIdle(
        () => {
          this.notices.warnIfUnsupported();
        },
        2000,
        1000,
      );
    });
  }

  /** The page's events the app follows for as long as the page lives. */
  private listen(): void {
    // The games the player finished stay in the profile, on this device only.
    usage().onGameEnd((ended) => {
      void this.profile().then((profile) => {
        profile.record(ended);
      });
    });
    // Errors the game did not catch, counted to find the ones players run into (docs/privacy.md).
    window.addEventListener("error", (event) => {
      // A script of another site says neither its file nor its message.
      const source = event.filename
        ? `${event.filename}:${String(event.lineno)}:${String(event.colno)}`
        : "";
      usage().error("exception", event.message, source);
    });
    window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
      const reason: unknown = event.reason;
      if (reason instanceof Error) usage().error("rejection", reason.message, reason.stack ?? "");
      else usage().error("rejection");
    });
    // iOS Safari zooms the page on a pinch even over a canvas with touch-action: none.
    document.addEventListener("gesturestart", (event) => {
      event.preventDefault();
    });
    onLanguageChange(() => {
      applyTranslations(document);
      this.online.refresh();
    });
  }

  private profile(): Promise<LocalProfile> {
    this.loadedProfile ??= import("../ui/profile.ts").then(
      ({ LocalProfile }) => new LocalProfile(this.storage),
    );
    return this.loadedProfile;
  }

  /** The name of a public game opened by "Play now" for want of one waiting. */
  private defaultGameName(): string {
    return t("online.defaultName", { name: this.chosen.playerName || t("menu.namePlaceholder") });
  }

  /** Whether a game can be drawn: when WebGL 2 is missing, says so and counts it. */
  canDraw(): boolean {
    if (hasWebGL2()) return true;
    usage().error("webgl");
    this.notices.show("webgl.missing");
    return false;
  }

  /** Back to the menu from wherever the page is, the online game left. */
  toMenu(): void {
    // Ready before Play, so the game opens already built and styled.
    this.prefetchGame();
    this.online.leave();
    this.go({ type: "menu", setup: this.chosen });
    const { storage } = this;
    const menu = this.screens.show(
      () =>
        new Menu(
          this.chosen,
          this.mapList,
          (chosen) => {
            this.play(chosen);
          },
          () => {
            this.tutorial();
          },
          (entry, chosen) => {
            this.chosen = chosen;
            saveSetup(chosen, storage);
            this.online.enter(entry, chosen);
          },
          (file) => {
            void this.watch(file);
          },
          () =>
            this.profile().then((profile) => ({
              read: () => profile.read(),
              setColor: (color) => {
                profile.setColor(color);
              },
              forget: () => {
                profile.forget();
                this.chosen = { ...this.chosen, playerName: "" };
                forgetSetup(storage);
                new AchievementStore(storage).clear();
                // A game in progress cannot be resumed either.
                forgetSeat();
                void forgetSnapshot();
                this.keepSolo(undefined);
              },
            })),
          (onGames) => watchPublicGames({ onGames }),
        ),
    );
    // Ready for Enter, without scrolling a phone's menu down to the button.
    menu.element.querySelector<HTMLButtonElement>("#play")?.focus({ preventScroll: true });
  }

  /**
   * Fetches the game's code once the menu is up and the browser has nothing else to do, so
   * that Play finds it in the cache; the menu itself never waits for it.
   */
  private prefetchGame(): void {
    whenIdle(
      () => {
        loadGameWithStyles().catch(() => undefined);
        const chosen = this.mapList.find((info) => info.id === this.chosen.map);
        if (chosen) warmGameMap(chosen);
        // "Play now" opens a game on the quick map, wherever the menu's own choice stands.
        const quick = this.mapList.find((info) => info.id === QUICK_MAP);
        if (quick && quick !== chosen) warmGameMap(quick);
      },
      3000,
      1000,
    );
  }

  /**
   * The menu, and a game left behind to take back: a reload goes straight
   * back to a solo game, a page opened again asks first.
   */
  private showMenuOrResume(): void {
    this.toMenu();
    if (this.offerAwaySeat()) return;
    const menu = this.screens.current;
    void storedSoloGame().then((saved) => {
      // The player went on in the meantime.
      if (!saved || this.screens.current !== menu) return;
      const navigation = performance.getEntriesByType("navigation")[0] as
        PerformanceNavigationTiming | undefined;
      if (navigation?.type === "reload") {
        this.resumeSolo(saved);
        return;
      }
      this.notices.offerResume(
        "solo",
        () => {
          this.resumeSolo(saved);
        },
        () => {
          this.keepSolo(undefined);
        },
      );
    });
  }

  /**
   * Offers the online game a closed tab left, if the server keeps its seat. A
   * seat another tab seems to hold is offered again once that doubt is over.
   */
  private offerAwaySeat(): boolean {
    const seat = awaySeat();
    if (!seat) {
      const held = seatHeldFor();
      if (held !== undefined) {
        const shown = this.screens.current;
        setTimeout(() => {
          if (this.screens.current === shown && !this.notices.showing) this.offerAwaySeat();
        }, held + 250);
      }
      return false;
    }
    this.notices.offerResume(
      "online",
      () => {
        void storedSnapshot(seat.game).then((snapshot) => {
          saveSeat(seat.game, seat.token);
          this.online.enter(
            { type: "resume", game: seat.game, token: seat.token },
            this.chosen,
            snapshot,
          );
        });
      },
      () => {
        forgetSeat();
        void forgetSnapshot();
      },
    );
    return true;
  }

  /** The view a new game starts with, and whether G may switch it. */
  sceneView(): SceneView {
    return { globe: this.view !== undefined, kind: this.view?.kind ?? "flat" };
  }

  /** What every game screen does the same in any mode. */
  gameActions(): Required<Pick<GameScreenActions, "onRecord" | "onView">> {
    return {
      onRecord: (record) => {
        this.saveReplay(record);
      },
      onView: (kind) => {
        this.switched(kind);
      },
    };
  }

  /** G switched the view of the game: the address follows. */
  private switched(kind: ViewKind): void {
    this.view = { kind };
    replaceAddress(addressOf(this.state, this.view) ?? withView(location.search, this.view));
  }

  /**
   * Puts a game on screen in place of whatever screen showed, and starts it;
   * none when it failed as it was made, and the menu shows instead, or when
   * the page went elsewhere while the game's code loaded.
   */
  mountGame(make: () => GameScreen, event: AppEvent): GameScreen | undefined {
    if (!this.go(event)) return undefined;
    this.notices.clear();
    let game: GameScreen;
    try {
      game = this.screens.show(make, true);
    } catch (error) {
      // The screen before is gone already: the menu takes its place.
      console.error(error);
      this.toMenu();
      this.notices.show("game.failed");
      return undefined;
    }
    if (this.screens.current !== game) return undefined;
    this.shownGame = game;
    game.start();
    return game;
  }

  /** Fetches what a game needs, the player's colour first, then makes it; says so if it fails. */
  private withGameCode(run: (code: GameModule) => void): void {
    void Promise.all([this.profile(), loadGameWithStyles()]).then(
      ([profile, code]) => {
        preferColor(HUMAN_ID, profile.read().color);
        run(code);
      },
      (error: unknown) => {
        console.error(error);
        this.notices.show("game.failed");
      },
    );
  }

  private play(chosen: GameSetup): void {
    this.chosen = chosen;
    saveSetup(chosen, this.storage);
    if (!this.canDraw()) return;
    const map = this.mapList.find((candidate) => candidate.id === chosen.map);
    if (!map) return;
    warmGameMap(map);
    // Your colour is yours alone: online, every page shows the colours the game gives.
    this.withGameCode((code) => {
      this.begin(map, code, chosen);
    });
  }

  /**
   * A short guided game on a small map, for learning the basics. It is a game
   * of its own: the setup in the menu, and the one saved, stay as they were.
   */
  private tutorial(): void {
    // The Strait: two lands joined by a narrow neck, with coasts for ports. A failed catalogue leaves the generated map.
    const practice: GameSetup = {
      map: this.mapList.some((candidate) => candidate.id === TUTORIAL_MAP)
        ? TUTORIAL_MAP
        : "skirmish",
      bots: 2,
      difficulty: DEFAULT_DIFFICULTY,
      nations: false,
      rules: defaultRules(),
      playerName: this.chosen.playerName,
      tutorial: true,
    };
    const map = this.mapList.find((candidate) => candidate.id === practice.map);
    if (!map) return;
    if (!this.canDraw()) return;
    this.withGameCode((code) => {
      this.begin(map, code, practice);
    });
  }

  /** Takes back the solo game this browser kept, where it was left. */
  private resumeSolo(saved: SoloSave): void {
    const map = this.mapList.find((candidate) => candidate.id === saved.options.map);
    if (!map) {
      this.keepSolo(undefined);
      this.toMenu();
      return;
    }
    if (!this.canDraw()) {
      this.toMenu();
      return;
    }
    this.withGameCode((code) => {
      this.begin(map, code, this.chosen, saved);
    });
  }

  /** A solo game, new or taken back; the tutorial is one too. */
  private begin(map: MapInfo, code: GameModule, chosen: GameSetup, saved?: SoloSave): void {
    const setup = this.chosen;
    const options = saved?.options ?? {
      ...chosen,
      playerName: chosen.playerName || t("menu.namePlaceholder"),
      seed: Math.floor(Math.random() * 0x7fffffff),
      ...this.testing,
      ...(chosen.tutorial
        ? { ...TUTORIAL_GAME, speed: this.testing.speed ?? TUTORIAL_GAME.speed }
        : {}),
    };
    const facts = saved?.facts ?? {
      mode: "solo" as const,
      // A generated map has no published id to count it by.
      map: map.manifest ? map.id : "generated",
      teams: (setup.teams ?? 0) as Teams,
      nations: setup.nations ?? true,
      bots: setup.bots,
      humans: 1,
      difficulty: setup.difficulty,
      disabled: setup.disabled ?? 0,
      rules: { ...defaultRules(), ...setup.rules },
    };
    /** Back to the menu or to another game: the game is not kept any more. */
    const done = (then: () => void) => (): void => {
      this.keepSolo(undefined);
      then();
    };
    const actions: GameScreenActions = {
      ...this.gameActions(),
      onNewGame: done(() => {
        if (options.tutorial) this.tutorial();
        else this.play(this.chosen);
      }),
      onMenu: done(() => {
        this.toMenu();
      }),
      onRealGame: done(() => {
        this.play(this.chosen);
      }),
      onFailure: (key) => {
        this.keepSolo(undefined);
        this.toMenu();
        this.notices.show(key);
      },
      onSnapshot: (snapshot) => {
        this.keepSolo({ ...snapshot, options, facts, savedAt: Date.now() });
      },
      onDecided: () => {
        this.keepSolo(undefined);
        this.go({ type: "decided" });
      },
    };
    this.mountGame(
      () => {
        // A game taken back stays kept until its next snapshot replaces it.
        if (!saved) this.keepSolo(undefined);
        return new code.GameScreen(
          saved
            ? {
                ...options,
                snapshot: { tick: saved.tick, bytes: saved.bytes, history: saved.history },
              }
            : options,
          map,
          actions,
          undefined,
          this.sceneView(),
          facts,
        );
      },
      options.tutorial ? { type: "tutorial" } : { type: "solo", setup: options },
    );
  }

  /** Keeps the solo game in progress for a reload, or forgets it. */
  private keepSolo(save: SoloSave | undefined): void {
    this.soloWrites = this.soloWrites
      .then(() => (save ? storeSoloGame(save) : forgetSoloGame()))
      .catch(() => undefined);
  }

  /** Offers a finished game as a file to save, to watch again later. */
  private saveReplay(record: GameRecord): void {
    replayFile(record)
      .then((file) => {
        // Long enough for the browser to have read the file.
        download(file, replayFileName(record), 30_000);
      })
      .catch((error: unknown) => {
        console.error(error);
        this.notices.show("replay.unsupported");
      });
  }

  /** Plays a saved game again, from its file, at the pace the viewer sets. */
  private async watch(file: File): Promise<void> {
    const record = await readReplayFile(file);
    if (typeof record === "string") {
      this.notices.show(`replay.${record}`);
      return;
    }
    const map = this.mapList.find((candidate) => candidate.id === record.map.id);
    if (!map) {
      this.notices.show("replay.unknownMap");
      return;
    }
    if (!this.canDraw()) return;
    let code: GameModule;
    try {
      code = await loadGameWithStyles();
      await code.loadReplayBar();
    } catch (error) {
      console.error(error);
      this.notices.show("game.failed");
      return;
    }
    preferColor(HUMAN_ID, undefined);
    const toMenu = (): void => {
      this.toMenu();
    };
    this.mountGame(
      () =>
        new code.GameScreen(
          { ...this.chosen, map: map.id, seed: record.seed, record },
          map,
          {
            onView: this.gameActions().onView,
            onNewGame: toMenu,
            onMenu: toMenu,
            onFailure: (key) => {
              this.toMenu();
              this.notices.show(key);
            },
          },
          undefined,
          this.sceneView(),
        ),
      { type: "watch" },
    );
  }

  /** An invitation link: the player picks their name, kept for next time, then joins. */
  private askName(invited: string): void {
    this.go({ type: "invited", game: invited });
    const screen = this.screens.show(
      () =>
        new JoinScreen(this.chosen.playerName, {
          onJoin: (name) => {
            this.chosen = { ...this.chosen, playerName: name };
            saveSetup(this.chosen, this.storage);
            this.online.enter({ type: "join", game: invited });
          },
          onMenu: () => {
            this.toMenu();
          },
        }),
    );
    screen.focus();
  }
}
