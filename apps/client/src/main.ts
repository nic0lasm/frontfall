import type { GameOptions } from "@frontfall/protocol";
import { applyTranslations, onLanguageChange, t, type MessageKey } from "./i18n/index.ts";
import { fetchMaps, type MapInfo } from "./game/maps.ts";
import { BUILD } from "./net/build.ts";
import { forgetSeat, saveSeat, seatIn } from "./net/seat.ts";
import { OnlineClient, socketUrl, type GameStart, type OnlineEntry } from "./net/online.ts";
import { loadGlobe, type ViewKind } from "./render/renderer.ts";
import { hasWebGL2 } from "./render/webgl-support.ts";
import { GameScreen } from "./ui/game-screen.ts";
import { LobbyScreen, botLimit, onlineMaps } from "./ui/lobby.ts";
import { h } from "./ui/dom.ts";
import { Menu } from "./ui/menu.ts";
import { initialSetup, safeStorage, saveSetup, setupQuery, type GameSetup } from "./ui/setup.ts";

const storage = safeStorage();
let maps: readonly MapInfo[] = [];
let menu: Menu | undefined;
let game: GameScreen | undefined;
let setup: GameSetup;
let lobby: LobbyScreen | undefined;
let online: OnlineClient | undefined;

function showMenu(): void {
  goOffline();
  game?.dispose();
  game = undefined;
  menu?.dispose();
  document.body.classList.remove("playing");
  menu = new Menu(setup, maps, play, (entry, chosen) => {
    setup = chosen;
    saveSetup(setup, storage);
    goOnline(entry, chosen);
  });
  document.body.prepend(menu.element);
  // Ready for Enter, without scrolling a phone's menu down to the button.
  menu.element.querySelector<HTMLButtonElement>("#play")?.focus({ preventScroll: true });
}

/**
 * `?speed=` and `?minutes=` let end-to-end tests play a whole game in
 * seconds, and `?gold=` (B-GOLD-RATE) pay for a structure without a long
 * wait; nothing in the interface sets them.
 */
const testing = (() => {
  const params = new URLSearchParams(location.search);
  const number = (name: string, max: number): number | undefined => {
    const value = Number(params.get(name));
    return params.has(name) && value > 0 && value <= max ? value : undefined;
  };
  return {
    speed: number("speed", 100),
    maxMinutes: number("minutes", 60),
    goldRate: number("gold", 10_000),
  };
})();

/**
 * `?view=globe` shows a map of the whole planet on a globe, and G switches
 * between globe and flat map: a prototype (ADR 0005). Read once, before the
 * address bar is rewritten.
 */
const startView: ViewKind =
  new URLSearchParams(location.search).get("view") === "globe" ? "globe" : "flat";

function play(chosen: GameSetup): void {
  setup = chosen;
  saveSetup(setup, storage);
  // Share the setup through the address bar, relative so it works under any prefix.
  history.replaceState(null, "", setupQuery(setup));
  if (!hasWebGL2()) {
    showNotice("webgl.missing");
    return;
  }
  const map = maps.find((candidate) => candidate.id === setup.map);
  if (!map) return;
  game?.dispose();
  const seed = Math.floor(Math.random() * 0x7fffffff);
  game = new GameScreen(
    { ...setup, playerName: setup.playerName || t("menu.namePlaceholder"), seed, ...testing },
    map,
    {
      onNewGame: () => {
        play(setup);
      },
      onMenu: showMenu,
      onFailure: (key) => {
        showMenu();
        showNotice(key);
      },
    },
    undefined,
    startView,
  );
  menu?.dispose();
  menu = undefined;
  document.querySelector(".notice")?.remove();
  document.body.classList.add("playing");
  document.body.prepend(game.element);
  game.start();
}

/** A message over the menu, translated again if the language changes. */
function showNotice(key: MessageKey): void {
  document.querySelector(".notice")?.remove();
  const notice = document.createElement("p");
  notice.className = "notice";
  notice.setAttribute("role", "alert");
  notice.dataset.i18n = key;
  notice.textContent = t(key);
  document.body.append(notice);
}

/**
 * The game no longer matches the other players': say so, and offer the
 * report that lets a developer replay it (`pnpm sim -- --replay`).
 */
function showDesync(tick: number): void {
  showNotice("online.desync");
  const screen = game;
  const notice = document.querySelector(".notice");
  if (!screen || !notice) return;
  const button = h("button", {
    type: "button",
    class: "secondary",
    id: "desync-report",
    "data-i18n": "online.desyncReport",
  });
  button.textContent = t("online.desyncReport");
  button.addEventListener("click", () => {
    void screen.desyncReport().then((report) => {
      if (!report) return;
      const blob = new Blob([JSON.stringify(report)], { type: "application/json" });
      const link = h("a", {
        href: URL.createObjectURL(blob),
        download: `frontfall-desync-${String(tick)}.json`,
      });
      link.click();
      setTimeout(() => {
        URL.revokeObjectURL(link.href);
      }, 0);
    });
  });
  notice.append(" ", button);
}

// iOS Safari zooms the page on a pinch even over a canvas with touch-action: none.
document.addEventListener("gesturestart", (event) => {
  event.preventDefault();
});

applyTranslations(document);

onLanguageChange(() => {
  applyTranslations(document);
  lobby?.refresh();
});

/** The address of a private game, to share: this page with `?game=<id>`. */
function inviteLink(game: string): string {
  const url = new URL(location.href);
  url.search = new URLSearchParams({ game }).toString();
  url.hash = "";
  return url.href;
}

/** Leaves the online game, if any, and closes the connection. */
function goOffline(): void {
  // Leaving on purpose gives up the seat; closing the tab keeps it for a reload.
  if (online) forgetSeat();
  online?.leave();
  online?.close();
  online = undefined;
  lobby?.dispose();
  lobby = undefined;
}

/**
 * An online game, from the lobby to the end: the connection reports the
 * lobby until the start, then the game screen plays the turns it relays.
 * The map, bots and difficulty are the host's, or the server's for a public game.
 */
function goOnline(entry: OnlineEntry, chosen: GameSetup = setup): void {
  if (!hasWebGL2()) {
    showNotice("webgl.missing");
    return;
  }
  menu?.dispose();
  menu = undefined;
  game?.dispose();
  game = undefined;
  goOffline();
  document.querySelector(".notice")?.remove();
  const playable = onlineMaps(maps);
  // A new private game starts with the map, bots and difficulty of the menu, when it can.
  let fromMenu = entry.type === "create";
  const room = new LobbyScreen(
    {
      onStart: () => {
        online?.start();
      },
      onConfigure: (options) => {
        online?.configure(options);
      },
      onLeave: () => {
        goOffline();
        history.replaceState(null, "", setupQuery(setup));
        showMenu();
      },
    },
    playable,
  );
  lobby = room;
  document.body.prepend(room.element);
  const client = new OnlineClient({
    url: socketUrl(location.href),
    name: chosen.playerName || t("menu.namePlaceholder"),
    build: BUILD,
    events: {
      status(state, retryInMs) {
        if (state === "connecting") room.connecting();
        if (state === "offline") room.connecting(retryInMs ?? 0);
        if (state === "outdated") {
          room.outdated();
          if (game) showNotice("status.outdated");
        }
        if (state === "rejected") {
          room.rejected();
          if (game) showNotice("online.rejected");
        }
      },
      lobby(state) {
        // A private game is joined again from its link, after a reload too.
        if (state.visibility === "private") {
          history.replaceState(
            null,
            "",
            `?${new URLSearchParams({ game: state.game }).toString()}`,
          );
        }
        if (fromMenu && state.host === state.you) {
          fromMenu = false;
          const options = initialOptions(chosen, playable, state.players.length);
          if (options) client.configure(options);
        }
        room.lobby(state, inviteLink(state.game));
      },
      started(start) {
        startOnline(start, client);
      },
      turns(turns) {
        game?.pushTurns(turns);
      },
      desync(tick, _hash, expected) {
        game?.desync(tick, expected);
        showDesync(tick);
      },
      ended(reason) {
        forgetSeat();
        if (game) {
          if (reason !== "left") showNotice(`online.ended.${reason}`);
          return;
        }
        room.ended(reason);
      },
      error(code, message) {
        // A seat taken back after a reload, from a game that went on or ended.
        if (code === "token_invalid") forgetSeat();
        room.refused(code, message);
      },
    },
  });
  online = client;
  if (entry.type === "play") client.play();
  else if (entry.type === "create") client.create();
  else if (entry.type === "resume") client.resume(entry.token);
  else client.join(entry.game);
}

/** The menu's choices as settings of a private game, kept within what the server accepts. */
function initialOptions(
  chosen: GameSetup,
  playable: readonly MapInfo[],
  players: number,
): GameOptions | undefined {
  const map = playable.find((candidate) => candidate.id === chosen.map);
  if (!map || (map.maxPlayers ?? 0) < players) return undefined;
  return {
    map: map.id,
    bots: Math.min(chosen.bots, botLimit(map, players)),
    difficulty: chosen.difficulty,
  };
}

/** The game starts: the lobby gives way to the map, and the turns go to the worker. */
function startOnline(start: GameStart, client: OnlineClient): void {
  const map = maps.find((candidate) => candidate.id === start.map);
  if (!map) {
    // A map this page does not list: leave the seat rather than hold it unplayed.
    client.leave();
    lobby?.unknownMap();
    return;
  }
  lobby?.dispose();
  lobby = undefined;
  // A reload of this tab takes the seat back, public game or private.
  saveSeat(start.game, start.token);
  history.replaceState(null, "", `?${new URLSearchParams({ game: start.game }).toString()}`);
  const leave = (): void => {
    goOffline();
    history.replaceState(null, "", setupQuery(setup));
    showMenu();
  };
  game = new GameScreen(
    {
      map: start.map,
      seed: start.seed,
      bots: start.bots,
      // Chosen by the host; every client runs the same bots.
      difficulty: start.difficulty,
      playerName: "",
      players: start.players,
      you: start.you,
    },
    map,
    {
      onNewGame: leave,
      onMenu: leave,
      onFailure: (key) => {
        leave();
        showNotice(key);
      },
    },
    {
      order: (order) => {
        client.order(order);
      },
      hash: (tick, hash) => {
        client.hash(tick, hash);
      },
    },
    startView,
  );
  document.body.classList.add("playing");
  document.body.prepend(game.element);
  game.start();
}

const query = new URLSearchParams(location.search);
const invited = query.get("game");
const ready = Promise.all([
  fetchMaps(location.href).then((list) => {
    maps = list;
    setup = initialSetup(location.search, storage, maps);
  }),
  // Without the globe's code, the game shows the flat map.
  startView === "globe"
    ? loadGlobe().catch((error: unknown) => {
        console.error(error);
      })
    : undefined,
]);
void ready.then(() => {
  // An invitation link joins its game; ?online, the next public one.
  if (invited) {
    const token = seatIn(invited);
    goOnline(token ? { type: "resume", game: invited, token } : { type: "join", game: invited });
  } else if (query.has("online")) goOnline({ type: "play" });
  else showMenu();
});
