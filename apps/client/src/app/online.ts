import type { Turn } from "@frontfall/engine";
import { BUILD } from "../build.ts";
import { HUMAN_ID } from "../game/simulation.ts";
import { forgetSnapshot, storeSnapshot, type StoredSnapshot } from "../game/snapshot-store.ts";
import { t } from "../i18n/index.ts";
import type { MapInfo } from "../maps.ts";
import {
  OnlineClient,
  socketUrl,
  type GameStart,
  type OnlineEntry,
  type OnlineEvents,
} from "../net/online.ts";
import { forgetSeat, saveSeat, touchSeat } from "../net/seat.ts";
import { preferColor } from "../palette.ts";
import type { GameScreen, GameScreenActions } from "../ui/game-screen.ts";
import { LobbyScreen, onlineMaps } from "../ui/lobby.ts";
import type { SceneView } from "../ui/screen/map-scene.ts";
import type { GameSetup } from "../ui/setup.ts";
import { loadGame, loadedGame, warmGameMap, type GameModule } from "./game-code.ts";
import type { Notices } from "./notices.ts";
import { initialOptions, inviteLink, rematchSetup } from "./online-options.ts";
import type { ScreenHost } from "./screen-host.ts";
import type { AppEvent } from "./state.ts";

/** What an online game needs of the app around it. */
export interface OnlineApp {
  readonly screens: ScreenHost;
  readonly notices: Notices;
  /** The game on screen, if any. */
  readonly game: GameScreen | undefined;
  maps(): readonly MapInfo[];
  setup(): GameSetup;
  go(event: AppEvent): void;
  /** Back to the menu, the connection closed. */
  toMenu(): void;
  /** Whether a game can be drawn; says why not when it cannot. */
  canDraw(): boolean;
  /** Puts a game on screen in place of the lobby, and starts it. */
  mountGame(make: () => GameScreen, event: AppEvent): GameScreen | undefined;
  /** What every game screen does the same in any mode: the replay file, the switch of view. */
  gameActions(): Required<Pick<GameScreenActions, "onRecord" | "onView">>;
  sceneView(): SceneView;
}

/**
 * An online game, from the lobby to the end: the connection reports the
 * lobby until the start, then the game screen plays the turns it relays.
 * The map, bots and difficulty are the host's, or the server's for a public game.
 */
export class OnlineFlow {
  private client: OnlineClient | undefined;
  private lobby: LobbyScreen | undefined;
  /** The online game being played, and when its seat was last said to be in use. */
  private playing: string | undefined;
  private seatTouchedAt = 0;
  /** Whether snapshots of the online game are kept for a reload: not once it no longer matches the others'. */
  private keepSnapshots = true;
  /** Turns that came before the game screen did, which has still to be fetched. */
  private heldTurns: Turn[][] | undefined;
  /** Stops watching the connection of the online game. */
  private unwatchConnection: (() => void) | undefined;

  constructor(private readonly app: OnlineApp) {}

  /** The lobby's texts again, in the language just chosen. */
  refresh(): void {
    this.lobby?.refresh();
  }

  /** Leaves the online game, if any, and closes the connection. */
  leave(): void {
    this.app.notices.maintenance(null);
    this.unwatchConnection?.();
    // Leaving on purpose gives up the seat; closing the tab keeps it for a reload.
    if (this.client) {
      forgetSeat();
      void forgetSnapshot();
    }
    this.client?.leave();
    this.client?.close();
    this.client = undefined;
    this.playing = undefined;
    if (this.lobby) this.app.screens.clear(this.lobby);
    this.lobby = undefined;
  }

  enter(entry: OnlineEntry, chosen: GameSetup = this.app.setup(), snapshot?: StoredSnapshot): void {
    const { app } = this;
    if (!app.canDraw()) return;
    // The lobby lasts longer than the fetch of the screen it leads to.
    loadGame().catch(() => undefined);
    this.leave();
    app.notices.clear();
    const playable = onlineMaps(app.maps());
    /** Public unless a lobby said otherwise: a seat taken back after a reload sees no lobby. */
    let visibility: "public" | "private" = entry.type === "create" ? "private" : "public";
    // A game of one's own starts with the map, bots and difficulty of the menu, when it can.
    let fromMenu = entry.type === "create";
    app.go({ type: "online" });
    const room = app.screens.show(
      () =>
        new LobbyScreen(
          {
            onStart: () => {
              this.client?.start();
            },
            onConfigure: (options, name, operatorBonuses) => {
              this.client?.configure(options, name, operatorBonuses);
            },
            onHold: () => {
              this.client?.hold();
            },
            onKick: (player) => {
              this.client?.kick(player);
            },
            onActive: () => {
              this.client?.active();
            },
            onLeave: () => {
              app.toMenu();
            },
          },
          playable,
        ),
    );
    this.lobby = room;
    const events: OnlineEvents = {
      status: (state, retryInMs) => {
        const { game } = app;
        if (state === "connecting") room.connecting();
        if (state === "offline") room.connecting(retryInMs ?? 0);
        if (state === "full") room.full(retryInMs ?? 0);
        // In a game, the lobby is gone: the notice says the turns stopped, and why.
        if (game) app.notices.connection(state, retryInMs);
        if (state === "outdated") {
          room.outdated();
          game?.disconnected();
          if (game) app.notices.show("status.outdated");
        }
        if (state === "rejected" || state === "banned") {
          const key = state === "banned" ? "online.banned" : "online.rejected";
          room.rejected(key);
          game?.disconnected();
          if (game) app.notices.show(key);
        }
      },
      lobby: (state, behind) => {
        visibility = state.visibility;
        // The map downloads while the players gather, so the start finds it ready.
        const chosenMap = app.maps().find((candidate) => candidate.id === state.map);
        if (chosenMap) warmGameMap(chosenMap);
        // Any game is joined again from its link, after a reload too.
        app.go({ type: "lobby", game: state.game });
        if (fromMenu && state.host === state.you) {
          fromMenu = false;
          const options = initialOptions(chosen, playable, state.players.length, state.visibility);
          if (options) {
            client.configure(options);
            behind = true;
          }
        }
        room.lobby(state, inviteLink(location.href, state.game), behind);
      },
      started: (start) => {
        this.start(start, client, visibility, snapshot?.game === start.game ? snapshot : undefined);
      },
      turns: (turns) => {
        const { game } = app;
        if (game) game.pushTurns(turns);
        else this.heldTurns?.push(turns);
        // Another tab opened meanwhile must not offer this game back while it is played here.
        const now = Date.now();
        if (this.seatTouchedAt + 5_000 <= now && this.playing) {
          this.seatTouchedAt = now;
          touchSeat(this.playing);
        }
      },
      maintenance: (inMs) => {
        app.notices.maintenance(inMs);
      },
      desync: (tick, _hash, expected) => {
        // A reload must play the game again from the start, not from a snapshot of this one.
        this.keepSnapshots = false;
        void forgetSnapshot();
        const { game } = app;
        if (!game) {
          app.notices.show("online.desync");
          return;
        }
        game.desync(tick, expected);
        app.notices.desync(tick, () => game.desyncReport());
      },
      ended: (reason) => {
        forgetSeat();
        void forgetSnapshot();
        const { game } = app;
        if (game) {
          if (reason !== "left") {
            game.disconnected();
            app.notices.show(`online.ended.${reason}`);
          }
          app.go({ type: "decided" });
          return;
        }
        room.ended(reason);
      },
      error: (code, message) => {
        // A seat taken back after a reload, from a game that went on or ended.
        if (code === "token_invalid") {
          forgetSeat();
          void forgetSnapshot();
        }
        if (code === "too_many_reports") {
          app.game?.reportRefused();
          return;
        }
        room.refused(code, message);
      },
    };
    const client = new OnlineClient({
      url: socketUrl(location.href),
      name: chosen.playerName || t("menu.namePlaceholder"),
      build: BUILD,
      events,
    });
    this.client = client;
    this.watchConnection(client);
    if (entry.type === "play") client.play(entry.name);
    else if (entry.type === "create") client.create(entry.visibility, entry.name);
    else if (entry.type === "resume") client.resume(entry.token, snapshot?.tick ?? 0);
    else client.join(entry.game);
  }

  /**
   * Keeps the connection of an online game alive across what the browser does
   * not report: a socket the server went silent on is dropped and opened again,
   * and the network coming back, or the page coming to the front, tries at once.
   */
  private watchConnection(client: OnlineClient): void {
    this.unwatchConnection?.();
    const check = setInterval(() => {
      client.check();
    }, 1_000);
    const now = (): void => {
      client.reconnectNow();
    };
    const shown = (): void => {
      if (document.visibilityState === "visible") client.reconnectNow();
    };
    window.addEventListener("online", now);
    document.addEventListener("visibilitychange", shown);
    this.unwatchConnection = () => {
      clearInterval(check);
      window.removeEventListener("online", now);
      document.removeEventListener("visibilitychange", shown);
      this.unwatchConnection = undefined;
    };
  }

  /** The game starts: the lobby gives way to the map, and the turns go to the worker. */
  private start(
    start: GameStart,
    client: OnlineClient,
    visibility: "public" | "private",
    snapshot: StoredSnapshot | undefined,
  ): void {
    const { app } = this;
    const code = loadedGame();
    if (!code) {
      // The code is still on its way, after a lobby shorter than the fetch: the turns that come
      // in meanwhile wait for the screen.
      this.heldTurns = [];
      loadGame().then(
        () => {
          // Unless the player left the lobby in the meantime.
          if (this.client === client) this.start(start, client, visibility, snapshot);
        },
        (error: unknown) => {
          console.error(error);
          this.heldTurns = undefined;
          client.leave();
          app.toMenu();
          app.notices.show("game.failed");
        },
      );
      return;
    }
    // The turns come in at once: the screen cannot wait for its styles, which the menu has begun to fetch.
    code.loadGameStyles().catch(() => undefined);
    const map = app.maps().find((candidate) => candidate.id === start.map);
    if (!map) {
      // A map this page does not list: leave the seat rather than hold it unplayed.
      client.leave();
      this.lobby?.unknownMap();
      return;
    }
    this.lobby = undefined;
    // A reload of this tab takes the seat back, public game or private.
    saveSeat(start.game, start.token);
    this.playing = start.game;
    this.keepSnapshots = true;
    preferColor(HUMAN_ID, undefined);
    const game = app.mountGame(() => this.screen(code, start, map, client, visibility, snapshot), {
      type: "started",
      game: start.game,
    });
    for (const turns of this.heldTurns ?? []) game?.pushTurns(turns);
    this.heldTurns = undefined;
  }

  private screen(
    code: GameModule,
    start: GameStart,
    map: MapInfo,
    client: OnlineClient,
    visibility: "public" | "private",
    snapshot: StoredSnapshot | undefined,
  ): GameScreen {
    const { app } = this;
    /** Back to the lobby: the next public game, or a new private one with this game's settings. */
    const rematch = (): void => {
      const setup = app.setup();
      if (visibility === "public") {
        this.enter({
          type: "play",
          name: t("online.defaultName", { name: setup.playerName || t("menu.namePlaceholder") }),
        });
        return;
      }
      this.enter({ type: "create", visibility: "private" }, rematchSetup(setup, start));
    };
    return new code.GameScreen(
      {
        map: start.map,
        seed: start.seed,
        bots: start.bots,
        // Chosen by the host; every client runs the same bots.
        difficulty: start.difficulty,
        nations: start.nations,
        teams: start.teams,
        disabled: start.disabled,
        rules: start.rules,
        // The operator's test bonuses (R-MODE-09): every client plays them for the same player.
        ...(start.operatorBonuses === null ? {} : { operator: start.operatorBonuses }),
        // Ticks per beat of the server, which the screen paces the turns by.
        speed: start.speed,
        playerName: "",
        players: start.players,
        you: start.you,
        snapshot,
      },
      map,
      {
        ...app.gameActions(),
        onNewGame: rematch,
        onMenu: () => {
          app.toMenu();
        },
        onFailure: (key) => {
          app.toMenu();
          app.notices.show(key);
        },
        onDecided: () => {
          app.go({ type: "decided" });
        },
      },
      {
        order: (order) => {
          client.order(order);
        },
        hash: (tick, hash) => {
          client.hash(tick, hash);
        },
        snapshot: (taken) => {
          if (this.keepSnapshots) void storeSnapshot({ game: start.game, ...taken });
        },
        replayFromStart: () => {
          void forgetSnapshot();
          client.replayFromStart();
        },
        report: (player, reason) => {
          client.report(player, reason);
        },
      },
      app.sceneView(),
      {
        mode: visibility,
        map: map.manifest ? map.id : "generated",
        teams: start.teams,
        nations: start.nations,
        bots: start.bots,
        humans: Math.max(1, start.players.length),
        difficulty: start.difficulty,
        disabled: start.disabled,
        rules: start.rules,
      },
    );
  }
}
