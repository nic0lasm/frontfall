import { accessibilityPanel } from "./accessibility.ts";
import { CATALOGUE } from "../achievements/catalog.ts";
import { REPLAY_EXTENSION } from "../game/replay-file.ts";
import { MAP_GROUPS, generateMap, suggestedBots, type MapInfo } from "../game/maps.ts";
import { MAX_BOTS, type Difficulty } from "../game/solo-game.ts";
import {
  LANGUAGES,
  applyTranslations,
  getLanguage,
  onLanguageChange,
  setLanguage,
  t,
  plural,
  type Language,
  type MessageKey,
} from "../i18n/index.ts";
import { MAX_GAME_NAME_LENGTH, PublicGame, normalizeGameName } from "@frontfall/protocol";
import type { OnlineEntry } from "../net/online.ts";
import { MAP_COLORS, hexToRgb } from "../palette.ts";
import { betaBadge } from "./beta.ts";
import { achievementsPanel, earnedCount } from "./achievements.ts";
import { feedbackLinks } from "./feedback.ts";
import { h, present } from "./dom.ts";
import type { ProfileControl } from "./profile-panel.ts";
import { defaultRules, rulesFieldset } from "./rules-fieldset.ts";
import { MAX_NAME_LENGTH, TEAM_CHOICES, cleanName, type GameSetup } from "./setup.ts";

/** Sent on the document once the profile is erased, so that what shows it can change. */
const PROFILE_FORGOTTEN = "frontfall:profile-forgotten";
const DIFFICULTIES: readonly Difficulty[] = ["easy", "normal", "hard"];
/** How often the list of public games is fetched again while the menu shows. */
const GAMES_REFRESH_MS = 3_000;

/**
 * The main menu: name, map, bots, difficulty and nations, and one button to play.
 * Everything is prefilled, so a new player starts a game in two clicks.
 */
export class Menu {
  readonly element: HTMLElement;
  private setup: GameSetup;
  private readonly cleanups: (() => void)[] = [];
  private disposed = false;

  constructor(
    initial: GameSetup,
    mapList: readonly MapInfo[],
    onPlay: (setup: GameSetup) => void,
    onOnline: (entry: OnlineEntry, setup: GameSetup) => void,
    /** A replay file the player picked, to watch. */
    onReplay: (file: File) => void,
    /** The profile kept on this device, loaded when the panel is opened. */
    profile: () => Promise<ProfileControl>,
  ) {
    this.setup = { ...initial };

    const name = h("input", {
      id: "player-name",
      type: "text",
      maxlength: MAX_NAME_LENGTH,
      autocomplete: "nickname",
      spellcheck: false,
      "data-i18n-attr": "placeholder:menu.namePlaceholder",
    });
    name.value = this.setup.playerName;
    name.addEventListener("input", () => {
      this.setup.playerName = cleanName(name.value);
    });
    // Sign-in comes after the menu shows: its code is no part of the first visit.
    const account = h("div", { class: "account", hidden: true });
    void import("./account.ts").then(({ AccountBox }) => {
      if (this.disposed) return;
      const box = new AccountBox(name, (chosen) => {
        this.setup.playerName = cleanName(chosen);
      });
      this.cleanups.push(box.dispose);
      account.replaceWith(box.element);
      // A sign-in that failed says so in the profile card: open it.
      const watch = new MutationObserver(() => {
        if (box.element.querySelector(".account-error")) {
          for (const panel of this.element.querySelectorAll<HTMLDetailsElement>(".menu-panel")) {
            panel.open = panel.id === "menu-profile";
          }
        }
      });
      watch.observe(box.element, { childList: true });
      this.cleanups.push(() => {
        watch.disconnect();
      });
    });

    const maps = h("div", {
      class: "map-groups",
      role: "radiogroup",
      "aria-labelledby": "map-label",
    });
    const lists = new Map(
      MAP_GROUPS.map((group) => [group, h("div", { class: "map-list" })] as const),
    );
    for (const group of MAP_GROUPS) {
      const list = lists.get(group);
      if (!list || !mapList.some((info) => info.group === group)) continue;
      const label = h("span", { class: "map-group-label", "data-i18n": `menu.maps.${group}` });
      maps.append(label, list);
    }
    for (const info of mapList) {
      const input = h("input", { type: "radio", name: "map", value: info.id });
      input.checked = info.id === this.setup.map;
      input.addEventListener("change", () => {
        this.setup.map = info.id;
        suggestBots();
        refreshSummary();
      });
      lists.get(info.group)?.append(
        h(
          "label",
          { class: "map-card" },
          input,
          thumbnail(info),
          this.mapName(info),
          h("span", {
            class: "map-size",
            "data-i18n": "map.size",
            "data-i18n-params": JSON.stringify({ width: info.width, height: info.height }),
          }),
        ),
      );
    }

    let refreshSummary = (): void => {};
    let botsTouched = false;
    const bots = h("input", {
      id: "bot-count",
      type: "range",
      min: 0,
      max: MAX_BOTS,
      step: 1,
    });
    bots.value = String(this.setup.bots);
    const botsValue = h("output", { for: "bot-count", class: "range-value" }, bots.value);
    bots.addEventListener("input", () => {
      botsTouched = true;
      this.setup.bots = Number(bots.value);
      botsValue.textContent = bots.value;
      refreshSummary();
    });

    const difficulty = h("div", {
      class: "segmented",
      role: "radiogroup",
      "aria-labelledby": "difficulty-label",
    });
    for (const level of DIFFICULTIES) {
      const input = h("input", { type: "radio", name: "difficulty", value: level });
      input.checked = level === this.setup.difficulty;
      input.addEventListener("change", () => {
        this.setup.difficulty = level;
        refreshSummary();
      });
      const label = h("span", { "data-i18n": `difficulty.${level}` });
      difficulty.append(h("label", {}, input, label));
    }

    const nations = h("input", { id: "nations", type: "checkbox" });
    nations.checked = this.setup.nations ?? true;
    nations.addEventListener("change", () => {
      this.setup.nations = nations.checked;
      suggestBots();
    });
    // Until the player sets the bots, they follow the map and the nations.
    const suggestBots = (): void => {
      const info = mapList.find((candidate) => candidate.id === this.setup.map);
      if (botsTouched || !info) return;
      this.setup.bots = suggestedBots(info, this.setup.nations ?? true);
      bots.value = String(this.setup.bots);
      botsValue.textContent = bots.value;
      refreshSummary();
    };

    const mode = h("div", {
      class: "segmented",
      role: "radiogroup",
      "aria-labelledby": "mode-label",
    });
    for (const teams of TEAM_CHOICES) {
      const input = h("input", { type: "radio", name: "teams", value: teams });
      input.checked = teams === (this.setup.teams ?? 0);
      input.addEventListener("change", () => {
        this.setup.teams = teams;
        refreshSummary();
      });
      mode.append(h("label", {}, input, h("span", { "data-i18n": `mode.${String(teams)}` })));
    }

    // Special rules (R-MODE-08), apart from the other options and remembered with them.
    const rules = rulesFieldset("menu", { ...defaultRules(), ...this.setup.rules }, (chosen) => {
      this.setup.rules = chosen;
    });

    const language = h("select", { id: "language", "data-i18n-attr": "aria-label:menu.language" });
    for (const { id, label } of LANGUAGES) {
      const option = h("option", { value: id, lang: id }, label);
      option.selected = id === getLanguage();
      language.append(option);
    }
    language.addEventListener("change", () => {
      setLanguage(language.value as Language);
    });

    // What the folded game options come to, one chip each, redrawn on every change.
    const optionsChips = h("span", { class: "options-chips" });
    const mapNameOf = (id: string): string => {
      const info = mapList.find((candidate) => candidate.id === id);
      return info?.name?.[getLanguage()] ?? t(`map.${id}` as MessageKey);
    };
    refreshSummary = (): void => {
      const chips = [
        mapNameOf(this.setup.map),
        plural("menu.summaryBots", this.setup.bots),
        t(`difficulty.${this.setup.difficulty}` as MessageKey),
      ];
      if (this.setup.teams) chips.push(t(`mode.${String(this.setup.teams)}` as MessageKey));
      optionsChips.replaceChildren(...chips.map((chip) => h("span", { class: "chip" }, chip)));
    };
    refreshSummary();
    this.cleanups.push(onLanguageChange(refreshSummary));

    const form = h(
      "form",
      { class: "menu-form" },
      h(
        "div",
        { class: "field" },
        h("label", { for: "player-name", "data-i18n": "menu.name" }),
        name,
      ),
      h(
        "details",
        { class: "menu-options", id: "menu-options" },
        h("summary", { class: "options-summary" }, optionsChips),
        h(
          "div",
          { class: "options-body" },
          h(
            "div",
            { class: "field" },
            h("span", { id: "map-label", class: "field-label", "data-i18n": "menu.map" }),
            maps,
          ),
          h(
            "div",
            { class: "field-row" },
            h(
              "div",
              { class: "field" },
              h("label", { for: "bot-count", "data-i18n": "menu.bots" }),
              h("div", { class: "range" }, bots, botsValue),
            ),
            h(
              "div",
              { class: "field" },
              h("span", {
                id: "difficulty-label",
                class: "field-label",
                "data-i18n": "menu.difficulty",
              }),
              difficulty,
            ),
            h(
              "div",
              { class: "field" },
              h("span", { class: "field-label", "data-i18n": "menu.nations" }),
              h(
                "label",
                { class: "toggle", for: "nations" },
                nations,
                h("span", { "data-i18n": "menu.nationsHint" }),
              ),
            ),
          ),
          h(
            "div",
            { class: "field" },
            h("span", { id: "mode-label", class: "field-label", "data-i18n": "menu.mode" }),
            mode,
          ),
          rules.element,
        ),
      ),
      h("button", { type: "submit", class: "primary", id: "play", "data-i18n": "menu.play" }),
    );
    const profileSection = h(
      "details",
      { class: "menu-panel menu-profile", id: "menu-profile" },
      h("summary", { "data-i18n": "profile.heading" }),
      account,
    );
    // Its code comes with the first opening, not with the first visit.
    profileSection.addEventListener("toggle", () => {
      if (!profileSection.open || profileSection.querySelector(".profile-body")) return;
      void Promise.all([import("./profile-panel.ts"), profile()]).then(
        ([{ profileBody }, control]) => {
          if (!profileSection.isConnected) return;
          profileSection.append(
            profileBody(
              control,
              (id) => mapList.find((candidate) => candidate.id === id)?.name?.[getLanguage()] ?? id,
              () => {
                this.setup.playerName = "";
                name.value = "";
                document.dispatchEvent(new Event(PROFILE_FORGOTTEN));
              },
              this.cleanups,
            ),
          );
        },
      );
    });
    const online = this.onlineSection(
      mapList,
      (entry) => {
        onOnline(entry, { ...this.setup });
      },
      replayPicker(onReplay),
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      onPlay({ ...this.setup });
    });

    // The accessibility settings and the profile open as cards under the bar.
    const settings = accessibilityPanel();
    settings.classList.add("menu-panel");
    const panels = [profileSection, settings];
    const togglePanel = (target: HTMLDetailsElement | undefined): void => {
      for (const panel of panels) panel.open = panel === target && !panel.open;
    };
    const barButton = (id: string, key: MessageKey, icon: string, panel: HTMLDetailsElement) => {
      const button = h("button", {
        type: "button",
        class: "bar-button",
        id,
        "aria-expanded": "false",
        "data-i18n-attr": `aria-label:${key};title:${key}`,
      });
      button.append(barIcon(icon));
      button.addEventListener("click", () => {
        togglePanel(panel);
      });
      panel.addEventListener("toggle", () => {
        button.setAttribute("aria-expanded", String(panel.open));
      });
      return button;
    };
    const bar = h(
      "div",
      { class: "menu-bar" },
      barButton("open-profile", "profile.heading", ICON_PROFILE, profileSection),
      achievementsButton(this.cleanups),
      barButton("open-accessibility", "a11y.title", ICON_SETTINGS, settings),
      language,
    );
    this.element = h(
      "main",
      { class: "menu", id: "menu" },
      bar,
      h("div", { class: "menu-panels" }, ...panels),
      h(
        "header",
        { class: "menu-header" },
        h("img", { class: "logo", src: "./logo-horizontal-on-dark.svg", alt: "Frontfall" }),
        ...present(betaBadge("beta-menu")),
        h("p", { class: "tagline", "data-i18n": "menu.tagline" }),
      ),
      form,
      online,
      feedbackLinks(),
    );
    this.element.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && panels.some((panel) => panel.open)) togglePanel(undefined);
    });
    applyTranslations(this.element);
  }

  dispose(): void {
    this.disposed = true;
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.element.remove();
  }

  /**
   * Online play: play now, create a public game under a name or a private
   * one, or join a public game from the list, which is fetched again every
   * few seconds.
   */
  private onlineSection(
    mapList: readonly MapInfo[],
    enter: (entry: OnlineEntry) => void,
    replay: HTMLElement,
  ): HTMLElement {
    const gameName = h("input", {
      id: "online-game-name",
      type: "text",
      maxlength: MAX_GAME_NAME_LENGTH,
      autocomplete: "off",
      spellcheck: false,
    });
    const nameError = h("p", {
      class: "hint error",
      id: "online-game-name-error",
      hidden: true,
      "data-i18n": "online.error.invalid_game_name",
    });
    /** The name typed, or the player's default one. */
    const defaultName = (): string =>
      t("online.defaultName", { name: this.setup.playerName || t("menu.namePlaceholder") });
    const showDefault = (): void => {
      gameName.placeholder = defaultName();
    };
    gameName.addEventListener("focus", showDefault);
    gameName.addEventListener("input", () => {
      nameError.hidden = true;
    });
    this.cleanups.push(onLanguageChange(showDefault));
    showDefault();

    const button = (
      id: string,
      key: MessageKey,
      entry: () => OnlineEntry | undefined,
      kind = "secondary",
    ): HTMLElement => {
      const element = h("button", { type: "button", class: kind, id, "data-i18n": key });
      element.addEventListener("click", () => {
        const chosen = entry();
        if (chosen) enter(chosen);
      });
      return element;
    };
    const createPublic = (): OnlineEntry | undefined => {
      const checked = normalizeGameName(gameName.value.trim() || defaultName());
      nameError.hidden = checked.ok;
      return checked.ok ? { type: "create", visibility: "public", name: checked.name } : undefined;
    };

    const list = h("ul", { class: "public-games", id: "public-games" });
    const empty = h("p", { class: "hint", "data-i18n": "online.noGames" });
    const games = h(
      "div",
      { class: "field", hidden: true },
      h("span", { class: "field-label", "data-i18n": "online.games" }),
      list,
      empty,
    );
    const mapLabel = (id: string): string => {
      const info = mapList.find((candidate) => candidate.id === id);
      return info?.name?.[getLanguage()] ?? id;
    };
    const more = h("details", { class: "online-more", id: "online-more" });
    // Until the player opens or closes it themselves, it opens by itself when there are games to show.
    let moreTouched = false;
    let shown: readonly PublicGame[] = [];
    const show = (found: readonly PublicGame[]): void => {
      shown = found;
      games.hidden = false;
      empty.hidden = found.length > 0;
      list.replaceChildren(...found.map((game) => this.gameRow(game, mapLabel, enter)));
      // The games of others are what a visitor looks for: show them, unless the player closed the list.
      if (!moreTouched && found.length > 0) more.open = true;
    };
    this.cleanups.push(
      onLanguageChange(() => {
        show(shown);
      }),
    );
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let etag: string | undefined;
    const refresh = async (): Promise<void> => {
      try {
        const response = await fetch(new URL("api/games", location.href), {
          headers: etag ? { "if-none-match": etag } : {},
        });
        // Unchanged since the last answer: nothing to redraw.
        if (response.status !== 304) {
          const body: unknown = response.ok ? await response.json() : undefined;
          etag = response.headers.get("etag") ?? undefined;
          // The menu may have closed while the request ran.
          if (!stopped) show(publicGames(body));
        }
      } catch {
        // No server next to the page, as in a static preview: the buttons stay.
      }
      if (!stopped) {
        timer = setTimeout(() => {
          void refresh();
        }, GAMES_REFRESH_MS);
      }
    };
    void refresh();
    this.cleanups.push(() => {
      stopped = true;
      clearTimeout(timer);
    });
    const quick = button("online-play", "online.quick", () => ({
      type: "play",
      name: defaultName(),
    }));
    quick.setAttribute("aria-describedby", "online-quick-hint");
    quick.setAttribute("data-i18n-attr", "title:online.quickHint");
    more.append(
      h("summary", { "data-i18n": "online.games" }),
      h(
        "div",
        { class: "field" },
        h("label", { for: "online-game-name", "data-i18n": "online.gameName" }),
        h(
          "div",
          { class: "online-actions" },
          gameName,
          button("online-create-public", "online.createPublic", createPublic),
        ),
        nameError,
      ),
      games,
    );
    more.querySelector("summary")?.addEventListener("click", () => {
      moreTouched = true;
    });
    return h(
      "section",
      { class: "menu-online", "aria-labelledby": "online-heading" },
      h("h2", { id: "online-heading", class: "visually-hidden", "data-i18n": "online.heading" }),
      h("p", {
        class: "visually-hidden",
        id: "online-quick-hint",
        "data-i18n": "online.quickHint",
      }),
      h(
        "div",
        { class: "online-actions" },
        quick,
        button("online-create", "online.create", () => ({ type: "create", visibility: "private" })),
        replay,
      ),
      more,
    );
  }

  /** One public game of the list: name, map, mode, host, seats, and whether it can be joined. */
  private gameRow(
    game: PublicGame,
    mapLabel: (id: string) => string,
    enter: (entry: OnlineEntry) => void,
  ): HTMLElement {
    const full = game.players >= game.capacity;
    const open = game.state === "waiting" && !full;
    const join = h("button", { type: "button", class: "secondary" }, t("online.join"));
    join.toggleAttribute("disabled", !open);
    join.addEventListener("click", () => {
      enter({ type: "join", game: game.id });
    });
    const state =
      game.state === "running"
        ? t("online.state.running")
        : full
          ? t("online.full")
          : t("online.state.waiting");
    return h(
      "li",
      { class: `public-game ${game.state}`, "data-game": game.id },
      h(
        "div",
        { class: "public-game-text" },
        // Text nodes only: names come from other players.
        h("span", { class: "public-game-name" }, game.name),
        h(
          "span",
          { class: "public-game-details" },
          t("online.gameDetails", {
            map: mapLabel(game.map),
            mode: t(`mode.${String(game.teams)}` as MessageKey),
            host: game.host,
          }),
        ),
      ),
      h(
        "span",
        { class: "public-game-count" },
        t("online.gamePlayers", { players: game.players, capacity: game.capacity }),
      ),
      h("span", { class: `public-game-state ${game.state}` }, state),
      join,
    );
  }

  /** Published maps bring their names in every language; generated ones use the catalogues. */
  private mapName(info: MapInfo): HTMLElement {
    const { name } = info;
    if (!name) return h("span", { class: "map-name", "data-i18n": `map.${info.id}` });
    const element = h("span", { class: "map-name" }, name[getLanguage()]);
    this.cleanups.push(
      onLanguageChange((language) => {
        element.textContent = name[language];
      }),
    );
    return element;
  }
}

/** The games of a `/api/games` answer, leaving out anything malformed. */
export function publicGames(body: unknown): PublicGame[] {
  const games = (body as { games?: unknown } | undefined)?.games;
  if (!Array.isArray(games)) return [];
  return games.flatMap((game) => {
    const parsed = PublicGame.safeParse(game);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Small picture of a map: the published thumbnail, or drawn from a generated terrain. */
function thumbnail(info: MapInfo): HTMLElement {
  if (info.thumbnail) {
    return h("img", { class: "map-thumb", src: info.thumbnail, alt: "", loading: "lazy" });
  }
  const map = generateMap(info.id);
  const scale = Math.max(1, Math.ceil(map.width / 160));
  const width = Math.floor(map.width / scale);
  const height = Math.floor(map.height / scale);
  const canvas = h("canvas", { class: "map-thumb", width, height, "aria-hidden": "true" });
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  const image = context.createImageData(width, height);
  const land = hexToRgb(MAP_COLORS.landHigh);
  const ocean = hexToRgb(MAP_COLORS.ocean);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const kind = map.kinds[y * scale * map.width + x * scale];
      image.data.set([...(kind === 0 ? ocean : land), 255], (y * width + x) * 4);
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

/** A button that opens the file picker for a replay saved from the end of a game. */
function replayPicker(onReplay: (file: File) => void): HTMLElement {
  const input = h("input", {
    type: "file",
    id: "replay-file",
    hidden: true,
    accept: `${REPLAY_EXTENSION},application/gzip`,
  });
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    input.value = "";
    if (file) onReplay(file);
  });
  const button = h("button", {
    type: "button",
    class: "secondary replay-open",
    id: "replay-open",
    "data-i18n": "replay.open",
  });
  button.addEventListener("click", () => {
    input.click();
  });
  return h("div", { class: "replay-picker" }, button, input);
}

/** Opens the page of achievements over the menu. */
function achievementsButton(cleanups: (() => void)[]): HTMLElement {
  const button = h("button", {
    type: "button",
    class: "bar-button achievements-open",
    id: "achievements-open",
  });
  const count = h("span", { class: "bar-count" });
  button.append(barIcon(ICON_STAR), count);
  const label = (): void => {
    const text = t("achievements.open", { earned: earnedCount(), total: CATALOGUE.length });
    button.setAttribute("aria-label", text);
    button.title = text;
    // Numbers only, as in the label above.
    count.replaceChildren(String(earnedCount()), new Text("/"), String(CATALOGUE.length));
  };
  label();
  cleanups.push(onLanguageChange(label));
  document.addEventListener(PROFILE_FORGOTTEN, label);
  cleanups.push(() => {
    document.removeEventListener(PROFILE_FORGOTTEN, label);
  });
  button.addEventListener("click", () => {
    const close = (): void => {
      panel.remove();
      label();
      button.focus();
    };
    const panel = achievementsPanel(close);
    document.body.append(panel);
    panel.querySelector<HTMLButtonElement>("button")?.focus();
  });
  return button;
}

const ICON_PROFILE = "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20c0-4 4-6 8-6s8 2 8 6";
const ICON_SETTINGS =
  "M4 7h8M18 7h2M4 17h2M12 17h8M15 7m-3 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0M9 17m-3 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0";
const ICON_STAR = "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z";

/** A line icon of the menu bar: one path on a 24 unit square, drawn in the text colour. */
function barIcon(path: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "bar-icon");
  const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
  line.setAttribute("d", path);
  svg.append(line);
  return svg;
}
