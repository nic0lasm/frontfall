import { describe, expect, it } from "vitest";
import { addressOf, bootIntent, parseView, testingOptions, withView } from "../src/app/address.ts";
import {
  initialOptions,
  inviteLink,
  rematchSetup,
  rematchSpeed,
} from "../src/app/online-options.ts";
import { ScreenHost, type Screen } from "../src/app/screen-host.ts";
import {
  TRANSITIONS,
  next,
  showsGame,
  usageScreen,
  type AppEvent,
  type AppState,
  type Screen as AppScreen,
} from "../src/app/state.ts";
import { defaultRules } from "../src/game/defaults.ts";
import type { MapInfo } from "../src/maps.ts";
import type { GameStart } from "../src/net/online.ts";
import type { GameSetup } from "../src/ui/setup.ts";

const setup: GameSetup = {
  map: "world",
  bots: 8,
  difficulty: "normal",
  nations: true,
  rules: defaultRules(),
  playerName: "Ada",
};

const menu: AppState = { screen: "menu", setup };
const solo: AppState = { screen: "playing", mode: "solo", setup };
const online: AppState = { screen: "playing", mode: "online", game: "abc123" };
const tutorial: AppState = { screen: "playing", mode: "tutorial" };

/** One event of each type, to run every state against the whole table. */
const EVENTS: readonly AppEvent[] = [
  { type: "menu", setup },
  { type: "invited", game: "abc123" },
  { type: "online" },
  { type: "lobby", game: "abc123" },
  { type: "started", game: "abc123" },
  { type: "solo", setup },
  { type: "tutorial" },
  { type: "watch" },
  { type: "decided" },
];

const STATES: readonly AppState[] = [
  { screen: "boot" },
  menu,
  { screen: "join", game: "abc123" },
  { screen: "lobby" },
  { screen: "lobby", game: "abc123" },
  solo,
  tutorial,
  online,
  { ...solo, screen: "ended" },
  { screen: "watching" },
];

describe("app state", () => {
  it("answers exactly the events of its row in the table", () => {
    for (const state of STATES) {
      for (const event of EVENTS) {
        const answered = next(state, event) !== undefined;
        expect(answered, `${state.screen} on ${event.type}`).toBe(
          TRANSITIONS[state.screen].includes(event.type),
        );
      }
    }
  });

  it("goes back to the menu from every state", () => {
    for (const state of STATES) {
      expect(next(state, { type: "menu", setup })).toEqual(menu);
    }
  });

  it("opens with the menu, an invitation or the next public game", () => {
    const boot: AppState = { screen: "boot" };
    expect(next(boot, { type: "menu", setup })).toEqual(menu);
    expect(next(boot, { type: "invited", game: "abc123" })).toEqual({
      screen: "join",
      game: "abc123",
    });
    expect(next(boot, { type: "online" })).toEqual({ screen: "lobby" });
    expect(next(boot, { type: "solo", setup })).toBeUndefined();
  });

  it("follows an online game from the lobby to its end and a rematch", () => {
    let state: AppState | undefined = menu;
    state = next(state, { type: "online" });
    expect(state).toEqual({ screen: "lobby" });
    state = next(state as AppState, { type: "lobby", game: "abc123" });
    expect(state).toEqual({ screen: "lobby", game: "abc123" });
    state = next(state as AppState, { type: "started", game: "abc123" });
    expect(state).toEqual(online);
    state = next(state as AppState, { type: "decided" });
    expect(state).toEqual({ ...online, screen: "ended" });
    // Decided once only.
    expect(next(state as AppState, { type: "decided" })).toBeUndefined();
    expect(next(state as AppState, { type: "online" })).toEqual({ screen: "lobby" });
  });

  it("plays solo, the tutorial and replays from the menu", () => {
    expect(next(menu, { type: "solo", setup })).toEqual(solo);
    expect(next(menu, { type: "tutorial" })).toEqual(tutorial);
    expect(next(menu, { type: "watch" })).toEqual({ screen: "watching" });
    // A new game from the end screen, or the real game after the tutorial.
    expect(next({ ...tutorial, screen: "ended" }, { type: "solo", setup })).toEqual(solo);
    expect(next(solo, { type: "tutorial" })).toEqual(tutorial);
    // A replay is not decided for anyone, and starts no game but from the menu.
    expect(next({ screen: "watching" }, { type: "decided" })).toBeUndefined();
    expect(next({ screen: "watching" }, { type: "solo", setup })).toBeUndefined();
  });

  it("names the screen of the error reports and says which states show a game", () => {
    const names = STATES.map((state) => usageScreen(state));
    expect(names).toEqual([
      "menu",
      "menu",
      "menu",
      "lobby",
      "lobby",
      "solo",
      "solo",
      "online",
      "solo",
      "replay",
    ]);
    expect(STATES.filter(showsGame).map((state) => state.screen)).toEqual([
      "playing",
      "playing",
      "playing",
      "ended",
      "watching",
    ]);
  });

  it("lists every screen in the table", () => {
    const screens: AppScreen[] = ["boot", "menu", "join", "lobby", "playing", "ended", "watching"];
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...screens].sort());
  });
});

describe("app address", () => {
  it("reads the view of the globe prototype, and nothing else turns it on", () => {
    expect(parseView("?map=world&view=globe")).toEqual({ kind: "globe" });
    expect(parseView("?view=map")).toEqual({ kind: "flat" });
    expect(parseView("?view=flat")).toBeUndefined();
    expect(parseView("?map=world")).toBeUndefined();
    expect(parseView("")).toBeUndefined();
  });

  it("writes the view into an address, or takes it out", () => {
    expect(withView("?map=world", { kind: "globe" })).toBe("?map=world&view=globe");
    expect(withView("?map=world&view=globe", { kind: "flat" })).toBe("?map=world&view=map");
    expect(withView("?map=world&view=globe", undefined)).toBe("?map=world");
    expect(withView("?view=globe", undefined)).toBe("");
    expect(withView("", { kind: "globe" })).toBe("?view=globe");
  });

  it("gives each state its address, relative to the page", () => {
    const solo = "?map=world&bots=8&difficulty=normal&nations=1";
    expect(addressOf(menu, undefined)).toBe(solo);
    expect(addressOf({ screen: "playing", mode: "solo", setup }, undefined)).toBe(solo);
    expect(addressOf({ screen: "ended", mode: "solo", setup }, { kind: "globe" })).toBe(
      `${solo}&view=globe`,
    );
    expect(addressOf(online, undefined)).toBe("?game=abc123");
    expect(addressOf({ screen: "lobby", game: "abc123" }, { kind: "flat" })).toBe(
      "?game=abc123&view=map",
    );
    for (const address of [addressOf(menu, { kind: "globe" }), addressOf(online, undefined)]) {
      expect(address?.startsWith("?")).toBe(true);
    }
  });

  it("leaves the address as it is where a state has none of its own", () => {
    const kept: AppState[] = [
      { screen: "boot" },
      { screen: "join", game: "abc123" },
      { screen: "lobby" },
      tutorial,
      { ...tutorial, screen: "ended" },
      { screen: "watching" },
    ];
    for (const state of kept) expect(addressOf(state, { kind: "globe" })).toBeUndefined();
  });

  it("reads what the address asks for as the page opens", () => {
    expect(bootIntent("")).toEqual({ kind: "menu" });
    expect(bootIntent("?map=world&view=globe")).toEqual({ kind: "menu" });
    expect(bootIntent("?online")).toEqual({ kind: "online" });
    expect(bootIntent("?game=abc123")).toEqual({ kind: "invite", game: "abc123", named: false });
    expect(bootIntent("?game=abc123&name=Ada&online")).toEqual({
      kind: "invite",
      game: "abc123",
      named: true,
    });
    expect(bootIntent("?game=")).toEqual({ kind: "menu" });
  });

  it("keeps the testing options that are in range", () => {
    expect(testingOptions("?speed=50&minutes=2&gold=500&cityland=40")).toEqual({
      speed: 50,
      maxMinutes: 2,
      goldRate: 500,
      cityLand: 40,
    });
    expect(testingOptions("?speed=0&minutes=61&gold=x")).toEqual({
      speed: undefined,
      maxMinutes: undefined,
      goldRate: undefined,
      cityLand: undefined,
    });
  });
});

describe("online options", () => {
  const map = (id: string, maxPlayers: number): MapInfo =>
    ({ id, maxPlayers, width: 100, height: 50, group: "quick" }) as unknown as MapInfo;

  it("keeps a rematch at the pace of the game before, unless normal", () => {
    expect(rematchSpeed(undefined)).toEqual({});
    expect(rematchSpeed(1)).toEqual({});
    expect(rematchSpeed(2)).toEqual({ speed: 2 });
    expect(rematchSpeed(7)).toEqual({});
  });

  it("turns the menu's choices into a new game's settings, within the map", () => {
    const options = initialOptions({ ...setup, bots: 40 }, [map("world", 10)], 3, "public");
    expect(options).toMatchObject({ map: "world", nations: true, teams: 0, autoStart: true });
    expect(options?.bots).toBeLessThan(40);
    expect(options?.rules).toBeUndefined();
    const own = initialOptions({ ...setup, speed: 2 }, [map("world", 10)], 1, "private");
    expect(own?.rules).toEqual(defaultRules());
    expect(own?.speed).toBe(2);
  });

  it("gives up on a map that is not playable online or too small for the players", () => {
    expect(initialOptions(setup, [map("lyon", 10)], 1, "public")).toBeUndefined();
    expect(initialOptions(setup, [map("world", 2)], 3, "public")).toBeUndefined();
  });

  it("starts a private rematch with the settings of the game that ended", () => {
    const start = {
      map: "lyon",
      bots: 3,
      difficulty: "hard",
      nations: false,
      teams: 2,
      disabled: 4,
      speed: 2,
      rules: defaultRules(),
    } as unknown as GameStart;
    expect(rematchSetup(setup, start)).toEqual({
      ...setup,
      map: "lyon",
      bots: 3,
      difficulty: "hard",
      nations: false,
      teams: 2,
      disabled: 4,
      speed: 2,
      rules: defaultRules(),
    });
  });

  it("links to a game from this page, whatever its query and hash", () => {
    expect(inviteLink("https://example.org/frontfall/?map=world#x", "abc123")).toBe(
      "https://example.org/frontfall/?game=abc123",
    );
  });
});

describe("screen host", () => {
  const page = () => {
    const prepended: unknown[] = [];
    const classes = new Set<string>();
    return {
      prepended,
      classes,
      root: {
        prepend: (element: HTMLElement) => prepended.push(element),
        classList: {
          toggle: (name: string, on?: boolean) => {
            if (on) classes.add(name);
            else classes.delete(name);
            return on === true;
          },
        },
      },
    };
  };
  const screen = (log: string[], name: string): Screen => ({
    element: name as unknown as HTMLElement,
    dispose: () => log.push(`dispose ${name}`),
  });

  it("disposes the screen shown before it makes the next", () => {
    const { root, prepended, classes } = page();
    const host = new ScreenHost(root);
    const log: string[] = [];
    const menu = host.show(() => {
      log.push("make menu");
      return screen(log, "menu");
    });
    expect(classes.has("playing")).toBe(false);
    host.show(() => {
      log.push("make game");
      return screen(log, "game");
    }, true);
    expect(log).toEqual(["make menu", "dispose menu", "make game"]);
    expect(prepended).toEqual(["menu", "game"]);
    expect(classes.has("playing")).toBe(true);
    // A screen no longer shown is not disposed twice.
    host.clear(menu);
    expect(log).toHaveLength(3);
    host.clear();
    expect(log).toEqual(["make menu", "dispose menu", "make game", "dispose game"]);
    expect(host.current).toBeUndefined();
  });

  it("keeps the screen shown while the next one was made, and drops the one made", () => {
    const { root, prepended } = page();
    const host = new ScreenHost(root);
    const log: string[] = [];
    const game = host.show(() => {
      // The game failed as it was made, and the menu showed in its place.
      host.show(() => screen(log, "menu"));
      return screen(log, "game");
    }, true);
    expect(host.current).not.toBe(game);
    expect(prepended).toEqual(["menu"]);
    expect(log).toEqual(["dispose game"]);
  });
});
