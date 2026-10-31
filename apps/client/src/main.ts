// First: before the schemas are built, so that none is compiled (the page forbids it).
import "@frontfall/protocol/jitless";
import type { GameRecord } from "@frontfall/engine";
import {
  DEFAULT_RULES,
  GAME_SPEEDS,
  type GameOptions,
  type GameSpeed,
  type Teams,
  type Visibility,
} from "@frontfall/protocol";
import {
  applyTranslations,
  loadLanguage,
  onLanguageChange,
  plural,
  t,
  type MessageKey,
} from "./i18n/index.ts";
import { fetchMaps, QUICK_MAP, warmMap, type MapInfo } from "./game/maps.ts";
import { prebakeGround } from "./render/prebaked-ground.ts";
import { readReplayFile, replayFile, replayFileName } from "./game/replay-file.ts";
import { BUILD } from "./net/build.ts";
import { awaySeat, forgetSeat, saveSeat, seatHeldFor, seatIn, touchSeat } from "./net/seat.ts";
import {
  forgetSnapshot,
  forgetSoloGame,
  storeSnapshot,
  storeSoloGame,
  storedSnapshot,
  storedSoloGame,
  type SoloSave,
  type StoredSnapshot,
} from "./net/snapshot-store.ts";
import {
  OnlineClient,
  socketUrl,
  type ConnectionStatus,
  type GameStart,
  type OnlineEntry,
} from "./net/online.ts";
import type { ViewKind } from "./render/renderer.ts";
import { FEATURE_LABELS, missingFeatures } from "./compat.ts";
import { hasWebGL2 } from "./render/webgl-support.ts";
import { loadAccessibility } from "./ui/accessibility.ts";
import type { GameScreen } from "./ui/game-screen.ts";
import { LobbyScreen, botLimit, onlineMaps, seatLimit } from "./ui/lobby.ts";
import { h } from "./ui/dom.ts";
import { JoinScreen } from "./ui/join.ts";
import { AchievementStore } from "./achievements/store.ts";
import { Menu } from "./ui/menu.ts";
import type { LocalProfile } from "./ui/profile.ts";
import { HUMAN_ID } from "./game/simulation.ts";
import { preferColor } from "./palette.ts";
import {
  forgetSetup,
  initialSetup,
  safeStorage,
  saveSetup,
  setupQuery,
  type GameSetup,
} from "./ui/setup.ts";
import { usage } from "./usage.ts";

loadAccessibility();
const storage = safeStorage();
let maps: readonly MapInfo[] = [];
let menu: Menu | undefined;
let game: GameScreen | undefined;

type GameModule = typeof import("./ui/game-screen.ts");
let gameModule: Promise<GameModule> | undefined;
/** The game screen's code, once loadGame has fetched it. */
let gameCode: GameModule | undefined;

/**
 * Fetches the game screen, with the renderer and the interface it draws: the menu does
 * not need them, so a first visit leaves them to a game that is about to start.
 */
function loadGame(): Promise<GameModule> {
  gameModule ??= Promise.all([
    import("./ui/game-screen.ts"),
    // The territory layer, the pieces and the globe: without them no game can be drawn.
    import("./render/renderer.ts").then(({ loadGlobe }) => loadGlobe()),
  ]).then(
    ([loaded]) => {
      gameCode = loaded;
      return loaded;
    },
    (error: unknown) => {
      gameModule = undefined;
      throw error;
    },
  );
  return gameModule;
}

/** The game screen and its styles, for a game about to start. */
async function loadGameWithStyles(): Promise<GameModule> {
  const loaded = await loadGame();
  await loaded.loadGameStyles();
  return loaded;
}

/**
 * Gets a map ready for a game that is about to start: its files, which the simulation worker
 * would otherwise wait for, and its ground, baked in a worker.
 */
function warmGame(info: MapInfo): void {
  void warmMap(info);
  void prebakeGround(info);
}

/**
 * Fetches the game's code once the menu is up and the browser has nothing else to do, so
 * that Play finds it in the cache; the menu itself never waits for it.
 */
function prefetchGame(): void {
  const fetch = (): void => {
    loadGameWithStyles().catch(() => undefined);
    const chosen = maps.find((info) => info.id === setup.map);
    if (chosen) warmGame(chosen);
    // "Play now" opens a game on the quick map, wherever the menu's own choice stands.
    const quick = maps.find((info) => info.id === QUICK_MAP);
    if (quick && quick !== chosen) warmGame(quick);
  };
  if ("requestIdleCallback" in window) window.requestIdleCallback(fetch, { timeout: 3000 });
  else setTimeout(fetch, 1000);
}
let setup: GameSetup;

/** The profile, loaded with its code when first needed: not part of the first download. */
let loadedProfile: Promise<LocalProfile> | undefined;
function localProfile(): Promise<LocalProfile> {
  loadedProfile ??= import("./ui/profile.ts").then(({ LocalProfile }) => new LocalProfile(storage));
  return loadedProfile;
}
let lobby: LobbyScreen | undefined;
let online: OnlineClient | undefined;

// The games the player finished stay in the profile, on this device only.
usage().onGameEnd((ended) => {
  void localProfile().then((profile) => {
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

function showMenu(): void {
  // Ready before Play, so the game opens already built and styled.
  prefetchGame();
  goOffline();
  game?.dispose();
  game = undefined;
  usage().screen = "menu";
  menu?.dispose();
  document.body.classList.remove("playing");
  menu = new Menu(
    setup,
    maps,
    play,
    tutorial,
    (entry, chosen) => {
      setup = chosen;
      saveSetup(setup, storage);
      goOnline(entry, chosen);
    },
    (file) => {
      void watch(file);
    },
    () =>
      localProfile().then((profile) => ({
        read: () => profile.read(),
        setColor: (color) => {
          profile.setColor(color);
        },
        forget: () => {
          profile.forget();
          setup = { ...setup, playerName: "" };
          forgetSetup(storage);
          new AchievementStore(storage).clear();
          // A game in progress cannot be resumed either.
          forgetSeat();
          void forgetSnapshot();
          keepSolo(undefined);
        },
      })),
  );
  document.body.prepend(menu.element);
  // Ready for Enter, without scrolling a phone's menu down to the button.
  menu.element.querySelector<HTMLButtonElement>("#play")?.focus({ preventScroll: true });
}

/**
 * `?speed=` and `?minutes=` let end-to-end tests play a whole game in
 * seconds, `?gold=` (B-GOLD-RATE) pay for a structure without a long
 * wait, and `?cityland=` (B-CITY-LAND) put back the land limit on cities,
 * small enough for a palace on a small map; nothing in the interface sets them.
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
    cityLand: number("cityland", 10_000),
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
    usage().error("webgl");
    showNotice("webgl.missing");
    return;
  }
  const map = maps.find((candidate) => candidate.id === setup.map);
  if (!map) return;
  warmGame(map);
  // Your colour is yours alone: online, every page shows the colours the game gives.
  void Promise.all([localProfile(), loadGameWithStyles()]).then(([profile, code]) => {
    preferColor(HUMAN_ID, profile.read().color);
    begin(map, code);
  }, failedToLoad);
}

/** The map of the tutorial, small and with a coast, a neck to defend and room for a port. */
const TUTORIAL_MAP = "strait";

/**
 * What the practice game plays with beyond its setup: a few city-states with
 * no nation to bring them (R-BOT-29), a long spawn phase to read the choices
 * in, and double speed so that the first buildings come within minutes.
 */
const TUTORIAL_GAME = { cityStates: 4, spawnSeconds: 60, speed: 2 } as const;

/**
 * A short guided game on a small map, for learning the basics. It is a game
 * of its own: the setup in the menu, and the one saved, stay as they were.
 */
function tutorial(): void {
  // The Strait: two lands joined by a narrow neck, with coasts for ports. A failed catalogue leaves the generated map.
  const practice: GameSetup = {
    map: maps.some((candidate) => candidate.id === TUTORIAL_MAP) ? TUTORIAL_MAP : "skirmish",
    bots: 2,
    difficulty: "easy",
    nations: false,
    rules: { ...DEFAULT_RULES },
    playerName: setup.playerName,
    tutorial: true,
  };
  const map = maps.find((candidate) => candidate.id === practice.map);
  if (!map) return;
  if (!hasWebGL2()) {
    usage().error("webgl");
    showNotice("webgl.missing");
    return;
  }
  void Promise.all([localProfile(), loadGameWithStyles()]).then(([profile, code]) => {
    preferColor(HUMAN_ID, profile.read().color);
    begin(map, code, practice);
  }, failedToLoad);
}

function failedToLoad(error: unknown): void {
  console.error(error);
  showNotice("game.failed");
}

function begin(map: MapInfo, code: GameModule, chosen: GameSetup = setup, saved?: SoloSave): void {
  game?.dispose();
  // A game taken back stays kept until its next snapshot replaces it.
  if (!saved) keepSolo(undefined);
  const seed = Math.floor(Math.random() * 0x7fffffff);
  const options = saved?.options ?? {
    ...chosen,
    playerName: chosen.playerName || t("menu.namePlaceholder"),
    seed,
    ...testing,
    ...(chosen.tutorial ? { ...TUTORIAL_GAME, speed: testing.speed ?? TUTORIAL_GAME.speed } : {}),
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
    rules: { ...DEFAULT_RULES, ...setup.rules },
  };
  /** Back to the menu or to another game: the game is not kept any more. */
  const done = (then: () => void) => (): void => {
    keepSolo(undefined);
    then();
  };
  game = new code.GameScreen(
    saved
      ? { ...options, snapshot: { tick: saved.tick, bytes: saved.bytes, history: saved.history } }
      : options,
    map,
    {
      onNewGame: done(() => {
        if (options.tutorial) tutorial();
        else play(setup);
      }),
      onMenu: done(showMenu),
      onRealGame: done(() => {
        play(setup);
      }),
      onFailure: (key) => {
        keepSolo(undefined);
        showMenu();
        showNotice(key);
      },
      onRecord: saveReplay,
      onSnapshot: (snapshot) => {
        keepSolo({ ...snapshot, options, facts, savedAt: Date.now() });
      },
      onDecided: () => {
        keepSolo(undefined);
      },
    },
    undefined,
    startView,
    facts,
  );
  menu?.dispose();
  menu = undefined;
  usage().screen = "solo";
  document.querySelector(".notice")?.remove();
  document.body.classList.add("playing");
  document.body.prepend(game.element);
  game.start();
}

/** Writes to the solo game kept, one after the other so that a forget is never overtaken. */
let soloWrites: Promise<void> = Promise.resolve();

/** Keeps the solo game in progress for a reload, or forgets it. */
function keepSolo(save: SoloSave | undefined): void {
  soloWrites = soloWrites
    .then(() => (save ? storeSoloGame(save) : forgetSoloGame()))
    .catch(() => undefined);
}

/** Takes back the solo game this browser kept, where it was left. */
function resumeSolo(saved: SoloSave): void {
  const map = maps.find((candidate) => candidate.id === saved.options.map);
  if (!map) {
    keepSolo(undefined);
    showMenu();
    return;
  }
  if (!hasWebGL2()) {
    usage().error("webgl");
    showMenu();
    showNotice("webgl.missing");
    return;
  }
  void Promise.all([localProfile(), loadGameWithStyles()]).then(([profile, code]) => {
    preferColor(HUMAN_ID, profile.read().color);
    begin(map, code, setup, saved);
  }, failedToLoad);
}

/**
 * Over the menu: a game this browser left behind, online while the server
 * keeps the seat, or solo, to take back or to drop.
 */
function offerResume(kind: "online" | "solo", onResume: () => void, onDrop: () => void): void {
  document.querySelector(".notice")?.remove();
  const notice = h("div", { class: "notice", id: "resume", role: "status" });
  const text = h("p", { "data-i18n": `resume.${kind}` });
  text.textContent = t(`resume.${kind}`);
  const back = h("button", { type: "button", class: "primary", "data-i18n": "resume.back" });
  back.textContent = t("resume.back");
  const drop = h("button", { type: "button", class: "secondary", "data-i18n": "resume.drop" });
  drop.textContent = t("resume.drop");
  back.addEventListener("click", () => {
    notice.remove();
    onResume();
  });
  drop.addEventListener("click", () => {
    notice.remove();
    onDrop();
  });
  const actions = h("p", { class: "resume-actions" });
  actions.append(back, drop);
  notice.append(text, actions);
  document.body.append(notice);
  back.focus({ preventScroll: true });
}

/**
 * Offers the online game a closed tab left, if the server keeps its seat. A
 * seat another tab seems to hold is offered again once that doubt is over.
 */
function offerAwaySeat(): boolean {
  const seat = awaySeat();
  if (!seat) {
    const held = seatHeldFor();
    if (held !== undefined) {
      const shown = menu;
      setTimeout(() => {
        if (menu === shown && !document.querySelector(".notice")) offerAwaySeat();
      }, held + 250);
    }
    return false;
  }
  offerResume(
    "online",
    () => {
      void storedSnapshot(seat.game).then((snapshot) => {
        saveSeat(seat.game, seat.token);
        goOnline({ type: "resume", game: seat.game, token: seat.token }, setup, snapshot);
      });
    },
    () => {
      forgetSeat();
      void forgetSnapshot();
    },
  );
  return true;
}

/**
 * The menu, and a game left behind to take back: a reload goes straight
 * back to a solo game, a page opened again asks first.
 */
function showMenuOrResume(): void {
  showMenu();
  if (offerAwaySeat()) return;
  void storedSoloGame().then((saved) => {
    // The player went on in the meantime.
    if (!saved || !menu) return;
    const reloaded =
      (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)
        ?.type === "reload";
    if (reloaded) {
      resumeSolo(saved);
      return;
    }
    offerResume(
      "solo",
      () => {
        resumeSolo(saved);
      },
      () => {
        keepSolo(undefined);
      },
    );
  });
}

/** Offers a finished game as a file to save, to watch again later. */
function saveReplay(record: GameRecord): void {
  replayFile(record)
    .then((file) => {
      const link = h("a", {
        href: URL.createObjectURL(file),
        download: replayFileName(record),
        hidden: true,
      });
      document.body.append(link);
      link.click();
      link.remove();
      // Long enough for the browser to have read the file.
      setTimeout(() => {
        URL.revokeObjectURL(link.href);
      }, 30_000);
    })
    .catch((error: unknown) => {
      console.error(error);
      showNotice("replay.unsupported");
    });
}

/** Plays a saved game again, from its file, at the pace the viewer sets. */
async function watch(file: File): Promise<void> {
  const record = await readReplayFile(file);
  if (typeof record === "string") {
    showNotice(`replay.${record}`);
    return;
  }
  const map = maps.find((candidate) => candidate.id === record.map.id);
  if (!map) {
    showNotice("replay.unknownMap");
    return;
  }
  if (!hasWebGL2()) {
    usage().error("webgl");
    showNotice("webgl.missing");
    return;
  }
  let code: GameModule;
  try {
    code = await loadGameWithStyles();
    await code.loadReplayBar();
  } catch (error) {
    console.error(error);
    showNotice("game.failed");
    return;
  }
  game?.dispose();
  preferColor(HUMAN_ID, undefined);
  game = new code.GameScreen(
    { ...setup, map: map.id, seed: record.seed, record },
    map,
    {
      onNewGame: showMenu,
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
  usage().screen = "replay";
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
 * Says at once, in the player's language, what a browser lacks to run the game,
 * rather than leaving them to find out on a blank map. The menu stays: a replay
 * file or a setting can still be looked at.
 */
function warnIfUnsupported(): void {
  const missing = missingFeatures();
  if (missing.length === 0) return;
  usage().error("webgl");
  const show = (): void => {
    document.querySelector(".notice")?.remove();
    const notice = document.createElement("p");
    notice.className = "notice";
    notice.id = "compat-notice";
    notice.setAttribute("role", "alert");
    notice.textContent = t("compat.missing", {
      features: missing.map((feature) => t(FEATURE_LABELS[feature])).join(", "),
    });
    document.body.append(notice);
  };
  show();
  onLanguageChange(show);
}

/**
 * The connection of an online game dropped: its turns stop until it is back,
 * and the notice says so, with the time to the next attempt. Gone once online.
 */
function showConnection(state: ConnectionStatus, retryInMs?: number): void {
  const current = document.querySelector("#connection-status");
  if (state !== "offline" && state !== "full" && state !== "connecting") {
    current?.remove();
    return;
  }
  // A notice that matters more, such as the end of the game, stays.
  if (!current && document.querySelector(".notice")) return;
  const notice = current ?? h("p", { class: "notice", id: "connection-status", role: "status" });
  const seconds = Math.ceil((retryInMs ?? 0) / 1000);
  notice.textContent =
    state === "offline"
      ? t("status.disconnected", { seconds })
      : state === "full"
        ? t("status.full", { seconds })
        : t("status.connecting");
  if (!current) document.body.append(notice);
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

/** When the announced restart of the server is due, by the page's clock. */
let maintenanceTimer: ReturnType<typeof setInterval> | undefined;

/**
 * A band at the top of the page, over the lobby and the game alike, that
 * counts the minutes to an announced restart; `null` takes it away.
 */
function showMaintenance(inMs: number | null): void {
  clearInterval(maintenanceTimer);
  document.querySelector(".maintenance")?.remove();
  if (inMs === null) return;
  const due = Date.now() + inMs;
  const band = h("p", { class: "maintenance", role: "status" });
  const update = (): void => {
    band.textContent = plural(
      "online.maintenance",
      Math.max(1, Math.ceil((due - Date.now()) / 60_000)),
    );
  };
  update();
  maintenanceTimer = setInterval(update, 15_000);
  document.body.append(band);
}

/** An invitation link: the player picks their name, kept for next time, then joins. */
function askName(invited: string): void {
  const screen = new JoinScreen(setup.playerName, {
    onJoin: (name) => {
      screen.dispose();
      setup = { ...setup, playerName: name };
      saveSetup(setup, storage);
      goOnline({ type: "join", game: invited });
    },
    onMenu: () => {
      screen.dispose();
      history.replaceState(null, "", setupQuery(setup));
      showMenu();
    },
  });
  document.body.prepend(screen.element);
  screen.focus();
}

/** The online game being played, and when its seat was last said to be in use. */
let playing: string | undefined;
let seatTouchedAt = 0;

/** Whether snapshots of the online game are kept for a reload: not once it no longer matches the others'. */
let keepSnapshots = true;

/** Turns that came before the game screen did, which has still to be fetched. */
let heldTurns: Parameters<GameScreen["pushTurns"]>[0][] | undefined;

/** Stops watching the connection of the online game. */
let unwatchConnection: (() => void) | undefined;

/**
 * Keeps the connection of an online game alive across what the browser does
 * not report: a socket the server went silent on is dropped and opened again,
 * and the network coming back, or the page coming to the front, tries at once.
 */
function watchConnection(client: OnlineClient): void {
  unwatchConnection?.();
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
  unwatchConnection = () => {
    clearInterval(check);
    window.removeEventListener("online", now);
    document.removeEventListener("visibilitychange", shown);
    unwatchConnection = undefined;
  };
}

/** Leaves the online game, if any, and closes the connection. */
function goOffline(): void {
  showMaintenance(null);
  unwatchConnection?.();
  // Leaving on purpose gives up the seat; closing the tab keeps it for a reload.
  if (online) {
    forgetSeat();
    void forgetSnapshot();
  }
  online?.leave();
  online?.close();
  online = undefined;
  playing = undefined;
  lobby?.dispose();
  lobby = undefined;
}

/**
 * An online game, from the lobby to the end: the connection reports the
 * lobby until the start, then the game screen plays the turns it relays.
 * The map, bots and difficulty are the host's, or the server's for a public game.
 */
function goOnline(entry: OnlineEntry, chosen: GameSetup = setup, snapshot?: StoredSnapshot): void {
  if (!hasWebGL2()) {
    usage().error("webgl");
    showNotice("webgl.missing");
    return;
  }
  // The lobby lasts longer than the fetch of the screen it leads to.
  loadGame().catch(() => undefined);
  menu?.dispose();
  menu = undefined;
  game?.dispose();
  game = undefined;
  goOffline();
  document.querySelector(".notice")?.remove();
  const playable = onlineMaps(maps);
  /** Public unless a lobby said otherwise: a seat taken back after a reload sees no lobby. */
  let visibility: "public" | "private" = entry.type === "create" ? "private" : "public";
  // A game of one's own starts with the map, bots and difficulty of the menu, when it can.
  let fromMenu = entry.type === "create";
  const room = new LobbyScreen(
    {
      onStart: () => {
        online?.start();
      },
      onConfigure: (options, name, operatorBonuses) => {
        online?.configure(options, name, operatorBonuses);
      },
      onHold: () => {
        online?.hold();
      },
      onKick: (player) => {
        online?.kick(player);
      },
      onActive: () => {
        online?.active();
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
  usage().screen = "lobby";
  document.body.prepend(room.element);
  const client = new OnlineClient({
    url: socketUrl(location.href),
    name: chosen.playerName || t("menu.namePlaceholder"),
    build: BUILD,
    events: {
      status(state, retryInMs) {
        if (state === "connecting") room.connecting();
        if (state === "offline") room.connecting(retryInMs ?? 0);
        if (state === "full") room.full(retryInMs ?? 0);
        // In a game, the lobby is gone: the notice says the turns stopped, and why.
        if (game) showConnection(state, retryInMs);
        if (state === "outdated") {
          room.outdated();
          game?.disconnected();
          if (game) showNotice("status.outdated");
        }
        if (state === "rejected" || state === "banned") {
          const key = state === "banned" ? "online.banned" : "online.rejected";
          room.rejected(key);
          game?.disconnected();
          if (game) showNotice(key);
        }
      },
      lobby(state, behind) {
        visibility = state.visibility;
        // The map downloads while the players gather, so the start finds it ready.
        const chosenMap = maps.find((candidate) => candidate.id === state.map);
        if (chosenMap) warmGame(chosenMap);
        // Any game is joined again from its link, after a reload too.
        history.replaceState(null, "", `?${new URLSearchParams({ game: state.game }).toString()}`);
        if (fromMenu && state.host === state.you) {
          fromMenu = false;
          const options = initialOptions(chosen, playable, state.players.length, state.visibility);
          if (options) {
            client.configure(options);
            behind = true;
          }
        }
        room.lobby(state, inviteLink(state.game), behind);
      },
      started(start) {
        startOnline(
          start,
          client,
          visibility,
          snapshot?.game === start.game ? snapshot : undefined,
        );
      },
      turns(turns) {
        if (game) game.pushTurns(turns);
        else heldTurns?.push(turns);
        // Another tab opened meanwhile must not offer this game back while it is played here.
        const now = Date.now();
        if (seatTouchedAt + 5_000 <= now && playing) {
          seatTouchedAt = now;
          touchSeat(playing);
        }
      },
      maintenance(inMs) {
        showMaintenance(inMs);
      },
      desync(tick, _hash, expected) {
        // A reload must play the game again from the start, not from a snapshot of this one.
        keepSnapshots = false;
        void forgetSnapshot();
        game?.desync(tick, expected);
        showDesync(tick);
      },
      ended(reason) {
        forgetSeat();
        void forgetSnapshot();
        if (game) {
          if (reason !== "left") game.disconnected();
          if (reason !== "left") showNotice(`online.ended.${reason}`);
          return;
        }
        room.ended(reason);
      },
      error(code, message) {
        // A seat taken back after a reload, from a game that went on or ended.
        if (code === "token_invalid") {
          forgetSeat();
          void forgetSnapshot();
        }
        if (code === "too_many_reports") {
          game?.reportRefused();
          return;
        }
        room.refused(code, message);
      },
    },
  });
  online = client;
  watchConnection(client);
  if (entry.type === "play") client.play(entry.name);
  else if (entry.type === "create") client.create(entry.visibility, entry.name);
  else if (entry.type === "resume") client.resume(entry.token, snapshot?.tick ?? 0);
  else client.join(entry.game);
}

/** The pace of the game before, unless it is the normal one or a test's own (R-MODE-07). */
function rematchSpeed(speed: number | undefined): { speed?: GameSpeed } {
  const pace = GAME_SPEEDS.find((candidate) => candidate === speed);
  return pace === undefined || pace === 1 ? {} : { speed: pace };
}

/** The menu's choices as settings of a new game, kept within what the server accepts. */
function initialOptions(
  chosen: GameSetup,
  playable: readonly MapInfo[],
  players: number,
  visibility: Visibility,
): GameOptions | undefined {
  const map = playable.find((candidate) => candidate.id === chosen.map);
  if (!map || (map.maxPlayers ?? 0) < players) return undefined;
  const bots = Math.min(chosen.bots, botLimit(map, players));
  return {
    map: map.id,
    bots,
    difficulty: chosen.difficulty,
    nations: chosen.nations ?? true,
    teams: (chosen.teams ?? 0) as Teams,
    disabled: chosen.disabled ?? 0,
    capacity: seatLimit(map, bots),
    autoStart: true,
    // A rematch keeps the pace of the game before (R-MODE-07).
    ...rematchSpeed(chosen.speed),
    // The special rules chosen in the menu, which only a private game may change (R-MODE-08).
    ...(visibility === "private" && chosen.rules
      ? { rules: { ...DEFAULT_RULES, ...chosen.rules } }
      : {}),
  };
}

/** The game starts: the lobby gives way to the map, and the turns go to the worker. */
function startOnline(
  start: GameStart,
  client: OnlineClient,
  visibility: "public" | "private",
  snapshot: StoredSnapshot | undefined,
): void {
  const code = gameCode;
  if (!code) {
    // The code is still on its way, after a lobby shorter than the fetch: the turns that come
    // in meanwhile wait for the screen.
    heldTurns = [];
    loadGame().then(
      () => {
        startOnline(start, client, visibility, snapshot);
      },
      (error: unknown) => {
        console.error(error);
        heldTurns = undefined;
        client.leave();
        showMenu();
        showNotice("game.failed");
      },
    );
    return;
  }
  // The turns come in at once: the screen cannot wait for its styles, which the menu has begun to fetch.
  code.loadGameStyles().catch(() => undefined);
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
  playing = start.game;
  keepSnapshots = true;
  history.replaceState(null, "", `?${new URLSearchParams({ game: start.game }).toString()}`);
  const leave = (): void => {
    goOffline();
    history.replaceState(null, "", setupQuery(setup));
    showMenu();
  };
  /** Back to the lobby: the next public game, or a new private one with this game's settings. */
  const rematch = (): void => {
    if (visibility === "public") {
      goOnline({
        type: "play",
        name: t("online.defaultName", { name: setup.playerName || t("menu.namePlaceholder") }),
      });
      return;
    }
    goOnline(
      { type: "create", visibility: "private" },
      {
        ...setup,
        map: start.map,
        bots: start.bots,
        difficulty: start.difficulty,
        nations: start.nations,
        teams: start.teams,
        disabled: start.disabled,
        speed: start.speed,
        rules: start.rules,
      },
    );
  };
  preferColor(HUMAN_ID, undefined);
  game = new code.GameScreen(
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
      onNewGame: rematch,
      onMenu: leave,
      onFailure: (key) => {
        leave();
        showNotice(key);
      },
      onRecord: saveReplay,
    },
    {
      order: (order) => {
        client.order(order);
      },
      hash: (tick, hash) => {
        client.hash(tick, hash);
      },
      snapshot: (taken) => {
        if (keepSnapshots) void storeSnapshot({ game: start.game, ...taken });
      },
      replayFromStart: () => {
        void forgetSnapshot();
        client.replayFromStart();
      },
      report: (player, reason) => {
        client.report(player, reason);
      },
    },
    startView,
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
  usage().screen = "online";
  document.body.classList.add("playing");
  document.body.prepend(game.element);
  game.start();
  for (const turns of heldTurns ?? []) game.pushTurns(turns);
  heldTurns = undefined;
}

const query = new URLSearchParams(location.search);
const invited = query.get("game");
const ready = Promise.all([
  // The page's own language: until it is there, the page shows its English markup.
  loadLanguage(),
  fetchMaps(location.href).then((list) => {
    maps = list;
    setup = initialSetup(location.search, storage, maps);
  }),
]);
void ready.then(() => {
  applyTranslations(document);
  // An invitation link joins its game; ?online, the next public one.
  if (invited) {
    const token = seatIn(invited);
    // A seat taken back after a reload, or a name in the link, needs no question.
    if (token) {
      // From where this tab left the game, when it kept a snapshot of it (#39).
      void storedSnapshot(invited).then((snapshot) => {
        goOnline({ type: "resume", game: invited, token }, setup, snapshot);
      });
    } else if (query.has("name")) goOnline({ type: "join", game: invited });
    else askName(invited);
  } else if (query.has("online")) {
    goOnline({
      type: "play",
      name: t("online.defaultName", { name: setup.playerName || t("menu.namePlaceholder") }),
    });
  } else showMenuOrResume();
  // Creating a WebGL context takes a while on some devices: the check waits for the menu to be
  // up and the browser idle. Play and the online entries make their own check before starting.
  if ("requestIdleCallback" in window)
    window.requestIdleCallback(warnIfUnsupported, { timeout: 2000 });
  else setTimeout(warnIfUnsupported, 1000);
});
