import { Disable, leftOut } from "@frontfall/engine";
import {
  GAME_SPEEDS,
  MAX_GAME_NAME_LENGTH,
  MAX_SEATS,
  MIN_SEATS,
  normalizeGameName,
  type Difficulty,
  type ErrorCode,
  type GameOptions,
  type GameSpeed,
  type Teams,
} from "@frontfall/protocol";
import { MAP_GROUPS, type MapInfo } from "../game/maps.ts";
import { MAX_BOTS } from "../game/solo-game.ts";
import { activeRuleNames, defaultRules, rulesFieldset } from "./rules-fieldset.ts";
import { LEFT_OUT, TEAM_CHOICES } from "./setup.ts";
import { applyTranslations, getLanguage, t, type MessageKey, type Params } from "../i18n/index.ts";
import type { LobbyState } from "../net/online.ts";
import { playerColor, teamColor } from "../palette.ts";
import { h, swatch } from "./dom.ts";

const DIFFICULTIES: readonly Difficulty[] = ["easy", "normal", "hard"];

/** Maps an online game can be played on: those the server knows, from the published catalogue. */
export function onlineMaps(maps: readonly MapInfo[]): MapInfo[] {
  return maps.filter((map) => map.maxPlayers !== undefined);
}

/**
 * Most bots the server accepts on `map` with `players` humans in the game:
 * the seats left empty shrink to make room for them.
 */
export function botLimit(map: MapInfo, players: number): number {
  return Math.max(0, Math.min(MAX_BOTS, (map.maxPlayers ?? 0) - Math.max(1, players)));
}

/** Seats a host can open on `map` with `bots`: between 2 and 16, as the map allows. */
export function seatLimit(map: MapInfo, bots: number): number {
  return Math.max(MIN_SEATS, Math.min(MAX_SEATS, (map.maxPlayers ?? 0) - bots));
}

/** How often, at most, the lobby tells the server the player is at the screen. */
const ACTIVE_EVERY_MS = 30_000;

export interface LobbyActions {
  /** Host: start with the players present. */
  onStart(): void;
  /** Host: new options and, for a public game, a new name. */
  onConfigure(options: GameOptions, name?: string): void;
  /** Host of a quick game: stop the countdown. */
  onHold(): void;
  /** Host: remove another player from the game (R-MODE-05). */
  onKick(player: number): void;
  /** The player touched the page: they are still at the screen. */
  onActive(): void;
  onLeave(): void;
}

/** Why a game ended before or instead of starting, as the server says it. */
export type EndReason =
  "abandoned" | "timeout" | "expired" | "left" | "restart" | "removed" | "seatLost";

/**
 * The room before an online game: its name, who is in and who hosts, the
 * options the host sets and the start button, the countdown of a quick
 * game, the invitation link, and what went wrong when something did. The
 * connection lives elsewhere; this only shows what it reports.
 */
export class LobbyScreen {
  readonly element: HTMLElement;
  private readonly title = h("h1", {
    class: "lobby-title",
    id: "lobby-title",
    "data-i18n": "online.title",
  });
  private readonly kind = h("p", { class: "lobby-kind", id: "lobby-kind" });
  private readonly status = h("p", { class: "lobby-status", id: "lobby-status", role: "status" });
  private readonly players = h("ul", { class: "lobby-players", id: "lobby-players" });
  private readonly invite = h("input", {
    id: "invite-link",
    type: "text",
    readonly: true,
    "data-i18n-attr": "aria-label:online.invite",
  });
  private readonly copy = h("button", {
    type: "button",
    class: "secondary",
    id: "copy-invite",
    "data-i18n": "online.copy",
  });
  private readonly invitation = h(
    "div",
    { class: "lobby-invite", hidden: true },
    h("label", { for: "invite-link", "data-i18n": "online.invite" }),
    h("div", { class: "lobby-invite-row" }, this.invite, this.copy),
  );
  private readonly start = h("button", {
    type: "button",
    class: "primary",
    id: "lobby-start",
    hidden: true,
    "data-i18n": "online.start",
  });
  private readonly hold = h("button", {
    type: "button",
    class: "secondary",
    id: "lobby-hold",
    hidden: true,
    "data-i18n": "online.hold",
  });
  private readonly reload = h("button", {
    type: "button",
    class: "primary",
    id: "lobby-reload",
    hidden: true,
    "data-i18n": "online.reload",
  });
  private readonly gameName = h("input", {
    id: "lobby-name",
    type: "text",
    maxlength: MAX_GAME_NAME_LENGTH,
    spellcheck: false,
    autocomplete: "off",
  });
  private readonly gameNameLabel = h("label", { for: "lobby-name", "data-i18n": "online.name" });
  private readonly seats = h("select", { id: "lobby-seats" });
  private readonly autoStart = h("input", { id: "lobby-auto", type: "checkbox" });
  private readonly mapSelect = h("select", { id: "lobby-map" });
  private readonly bots = h("input", {
    id: "lobby-bots",
    type: "range",
    min: "0",
    step: "1",
  });
  private readonly botsValue = h("output", { for: "lobby-bots", class: "range-value" });
  private readonly difficulty = h("select", { id: "lobby-difficulty" });
  private readonly nations = h("input", { id: "lobby-nations", type: "checkbox" });
  private readonly teams = h("select", { id: "lobby-teams" });
  /** Pace of a private game (R-MODE-07); a public one runs at 1. */
  private readonly speed = h("select", { id: "lobby-speed" });
  private readonly speedLabel = h("label", { for: "lobby-speed", "data-i18n": "online.speed" });
  /** One box per structure or unit the game can leave out (R-MODE-03), checked when it stays in. */
  private readonly allowed = LEFT_OUT.map(({ name, bit }) => ({
    bit,
    input: h("input", { id: `lobby-allow-${name}`, type: "checkbox", "data-bit": bit }),
    name,
  }));
  /** Special rules (R-MODE-08): the host's switches while the game is private, else a reading. */
  private readonly rules = rulesFieldset("lobby", defaultRules(), () => {
    this.onRulesChange();
  });
  private onRulesChange = (): void => undefined;
  private readonly settings = h(
    "div",
    { class: "lobby-settings", hidden: true },
    this.gameNameLabel,
    this.gameName,
    h("label", { for: "lobby-seats", "data-i18n": "online.seats" }),
    this.seats,
    h("span", { class: "lobby-auto-label", "data-i18n": "online.autoStartLabel" }),
    h(
      "label",
      { class: "toggle", for: "lobby-auto" },
      this.autoStart,
      h("span", { "data-i18n": "online.autoStart" }),
    ),
    h("label", { for: "lobby-map", "data-i18n": "menu.map" }),
    this.mapSelect,
    h("label", { for: "lobby-bots", "data-i18n": "menu.bots" }),
    h("div", { class: "range" }, this.bots, this.botsValue),
    h("label", { for: "lobby-difficulty", "data-i18n": "menu.difficulty" }),
    this.difficulty,
    h("label", { for: "lobby-nations", "data-i18n": "menu.nations" }),
    h(
      "label",
      { class: "toggle", for: "lobby-nations" },
      this.nations,
      h("span", { "data-i18n": "menu.nationsHint" }),
    ),
    h("label", { for: "lobby-teams", "data-i18n": "menu.mode" }),
    this.teams,
    this.speedLabel,
    this.speed,
    h("span", { class: "lobby-allowed-label", "data-i18n": "online.allowed" }),
    h(
      "div",
      { class: "lobby-allowed", role: "group", "data-i18n-attr": "aria-label:online.allowed" },
      ...this.allowed.map(({ input, name }) =>
        h("label", { class: "toggle" }, input, h("span", { "data-i18n": `hud.${name}` })),
      ),
    ),
    this.rules.element,
  );
  private readonly summary = h("p", { class: "lobby-summary", id: "lobby-summary" });
  /** The special rules of the game, for those who do not set them. */
  private readonly rulesLine = h("p", { class: "lobby-summary", id: "lobby-rules-line" });
  private shown: { key: MessageKey; params: Params } = { key: "status.connecting", params: {} };
  /** Countdown of a public game: when it starts, by this page's clock. */
  private startsAt: number | undefined;
  private lastLobby: LobbyState | undefined;
  private behind = false;
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly stopWatching: () => void;

  constructor(
    private readonly actions: LobbyActions,
    private readonly maps: readonly MapInfo[],
  ) {
    const leave = h("button", {
      type: "button",
      class: "secondary",
      id: "lobby-leave",
      "data-i18n": "online.leave",
    });
    leave.addEventListener("click", () => {
      actions.onLeave();
    });
    this.start.addEventListener("click", () => {
      actions.onStart();
    });
    this.hold.addEventListener("click", () => {
      actions.onHold();
    });
    this.reload.addEventListener("click", () => {
      location.reload();
    });
    const configure = (name?: string): void => {
      const map = this.maps.find((candidate) => candidate.id === this.mapSelect.value);
      if (!map || !this.lastLobby) return;
      const bots = Math.min(Number(this.bots.value), botLimit(map, this.lastLobby.players.length));
      const options: GameOptions = {
        map: map.id,
        bots,
        difficulty: this.difficulty.value as Difficulty,
        nations: this.nations.checked,
        teams: Number(this.teams.value) as Teams,
        disabled: this.allowed.reduce(
          (bits, { bit, input }) => bits | (input.checked ? 0 : bit),
          0,
        ),
        capacity: Math.min(Number(this.seats.value), seatLimit(map, bots)),
        autoStart: this.autoStart.checked,
        ...(this.speed.hidden ? {} : { speed: Number(this.speed.value) as GameSpeed }),
        // A public game always plays the default rules; the server refuses others.
        ...(this.lastLobby.visibility === "private" ? { rules: this.rules.read() } : {}),
      };
      actions.onConfigure(options, name);
    };
    // The name goes out once typed: on Enter or when the field loses focus.
    this.gameName.addEventListener("change", () => {
      const checked = normalizeGameName(this.gameName.value);
      if (!checked.ok) {
        this.show("online.error.invalid_game_name");
        if (this.lastLobby?.name) this.gameName.value = this.lastLobby.name;
        return;
      }
      configure(checked.name);
    });
    this.seats.addEventListener("change", () => {
      configure();
    });
    this.autoStart.addEventListener("change", () => {
      configure();
    });
    const reconfigure = (): void => {
      configure();
    };
    this.mapSelect.addEventListener("change", reconfigure);
    this.difficulty.addEventListener("change", reconfigure);
    this.nations.addEventListener("change", reconfigure);
    this.teams.addEventListener("change", reconfigure);
    this.speed.addEventListener("change", reconfigure);
    this.onRulesChange = reconfigure;
    for (const { input } of this.allowed) input.addEventListener("change", reconfigure);
    this.bots.addEventListener("input", () => {
      this.botsValue.textContent = this.bots.value;
    });
    // Sent on release, not on every step of a drag.
    this.bots.addEventListener("change", reconfigure);
    this.copy.addEventListener("click", () => {
      // Selected, the link can still be copied by hand where the clipboard is
      // out of reach, as on a page served over plain HTTP.
      this.invite.select();
      try {
        void navigator.clipboard.writeText(this.invite.value).then(
          () => {
            this.copy.textContent = t("online.copied");
          },
          () => undefined,
        );
      } catch {
        // No clipboard API at all.
      }
    });
    this.element = h(
      "main",
      { class: "menu lobby", id: "lobby" },
      h(
        "header",
        { class: "menu-header" },
        h("img", { class: "logo", src: "./logo-horizontal-on-dark.svg", alt: "Frontfall" }),
      ),
      h(
        "section",
        { class: "lobby-panel", "aria-labelledby": "lobby-title" },
        this.title,
        this.kind,
        this.status,
        this.summary,
        this.rulesLine,
        this.settings,
        this.players,
        this.invitation,
        h("div", { class: "lobby-actions" }, this.start, this.hold, this.reload, leave),
      ),
    );
    applyTranslations(this.element);
    this.show("status.connecting");
    this.timer = setInterval(() => {
      if (this.startsAt !== undefined && this.lastLobby) this.showLobbyStatus(this.lastLobby);
    }, 250);
    // A host who walks away hands the role on: touching the page says otherwise.
    let lastActive = -Infinity;
    const touched = (): void => {
      const now = performance.now();
      if (now - lastActive < ACTIVE_EVERY_MS) return;
      lastActive = now;
      actions.onActive();
    };
    const events = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;
    for (const type of events) document.addEventListener(type, touched, { passive: true });
    this.stopWatching = () => {
      for (const type of events) document.removeEventListener(type, touched);
    };
  }

  /** The connection is opening, or dropped and retries in `retryInMs`. */
  connecting(retryInMs?: number): void {
    if (retryInMs === undefined) this.show("status.connecting");
    else this.show("status.disconnected", { seconds: Math.ceil(retryInMs / 1000) });
  }

  /** The server runs a newer version: this page cannot play until it reloads. */
  outdated(): void {
    this.lastLobby = undefined;
    this.startsAt = undefined;
    this.show("status.outdated");
    this.start.hidden = true;
    this.hold.hidden = true;
    this.settings.hidden = true;
    this.reload.hidden = false;
  }

  /** The server refused this page's messages, or banned its network, and closed the connection. */
  rejected(key: "online.rejected" | "online.banned" = "online.rejected"): void {
    this.stopped(key);
  }

  /** The game started on a map this page does not have. */
  unknownMap(): void {
    this.stopped("online.unknownMap");
  }

  /** `behind`: the host changed settings since; the form keeps them, not these. */
  lobby(lobby: LobbyState, inviteLink: string, behind = false): void {
    this.lastLobby = lobby;
    this.behind = behind;
    this.startsAt = lobby.startsIn === null ? undefined : performance.now() + lobby.startsIn;
    const privateGame = lobby.visibility === "private";
    const host = lobby.host === lobby.you;
    this.kind.textContent = t(privateGame ? "online.private" : "online.public");
    // A public game goes by its name, as the list shows it.
    if (lobby.name === null) {
      this.title.dataset.i18n = "online.title";
      this.title.textContent = t("online.title");
    } else {
      delete this.title.dataset.i18n;
      this.title.textContent = lobby.name;
    }
    this.players.replaceChildren(
      ...lobby.players.map((player, i) =>
        h(
          "li",
          { class: player.id === lobby.you ? "lobby-player you" : "lobby-player" },
          // In a team game, the shade of the team the seat is dealt into (R-MODE-02).
          swatch(
            lobby.teams === 0
              ? playerColor(player.id - 1).hex
              : teamColor((i % lobby.teams) + 1, Math.floor(i / lobby.teams)),
          ),
          h("span", {}, player.name),
          ...(player.id === lobby.host
            ? [h("span", { class: "lobby-host", "data-i18n": "online.host" }, t("online.host"))]
            : []),
          ...(host && player.id !== lobby.you ? [this.removeButton(player)] : []),
        ),
      ),
    );
    this.invite.value = inviteLink;
    this.invitation.hidden = false;
    this.start.hidden = !host;
    const enough = lobby.players.length >= lobby.minPlayers;
    this.start.toggleAttribute("disabled", !enough);
    this.start.title = enough ? "" : t("online.needPlayers", { count: lobby.minPlayers });
    this.hold.hidden = !host || !lobby.holdable;
    this.showSettings(lobby);
    this.showLobbyStatus(lobby);
  }

  /** The host's button that removes a player from the lobby. */
  private removeButton(player: { id: number; name: string }): HTMLButtonElement {
    const button = h(
      "button",
      {
        type: "button",
        class: "lobby-remove",
        "data-player": player.id,
        "aria-label": t("online.removeLabel", { name: player.name }),
        title: t("online.removeLabel", { name: player.name }),
      },
      t("online.remove"),
    );
    button.addEventListener("click", () => {
      button.disabled = true;
      this.actions.onKick(player.id);
    });
    return button;
  }

  /** The game ended before it started, or the player left it. */
  ended(reason: EndReason): void {
    this.stopped(`online.ended.${reason}`);
  }

  /** A request was refused: no such game, full, already started... */
  refused(code: ErrorCode, message: string): void {
    const key = `online.error.${code}` as MessageKey;
    const known = t(key) !== key;
    this.show(known ? key : "status.refused", known ? {} : { message });
  }

  /** Language changed: everything again in the new one. */
  refresh(): void {
    applyTranslations(this.element);
    this.show(this.shown.key, this.shown.params);
    if (this.lastLobby) this.lobby(this.lastLobby, this.invite.value, this.behind);
  }

  dispose(): void {
    clearInterval(this.timer);
    this.stopWatching();
    this.element.remove();
  }

  /** Nothing more will happen here but leaving: says why. */
  private stopped(key: MessageKey): void {
    this.lastLobby = undefined;
    this.startsAt = undefined;
    this.start.hidden = true;
    this.hold.hidden = true;
    this.settings.hidden = true;
    this.show(key);
  }

  /** The host changes the settings; everyone else reads them. */
  private showSettings(lobby: LobbyState): void {
    const map = this.maps.find((candidate) => candidate.id === lobby.map);
    const mapName = map?.name?.[getLanguage()] ?? lobby.map;
    const base = t(lobby.nations ? "online.summaryNations" : "online.summary", {
      map: mapName,
      bots: lobby.bots,
      difficulty: t(`difficulty.${lobby.difficulty}`),
    });
    const summary = lobby.autoStart ? t("online.summaryAuto", { summary: base }) : base;
    const withMode =
      lobby.teams === 0
        ? summary
        : t("online.summaryTeams", {
            summary,
            mode: t(`mode.${String(lobby.teams)}` as MessageKey),
          });
    // Warships go with ports, whatever the host ticked (R-MODE-03).
    const disabled = leftOut(lobby.disabled);
    const off = LEFT_OUT.filter(({ bit }) => (disabled & bit) !== 0);
    const withSpeed =
      lobby.speed === 1
        ? withMode
        : t("online.summarySpeed", { summary: withMode, speed: String(lobby.speed) });
    this.summary.textContent =
      off.length === 0
        ? withSpeed
        : t("online.summaryOff", {
            summary: withSpeed,
            off: off.map(({ name }) => t(`hud.${name}`)).join(", "),
          });
    const editable = lobby.host === lobby.you && map;
    this.settings.hidden = !editable;
    this.summary.hidden = Boolean(editable);
    const played = activeRuleNames(lobby.rules);
    this.rulesLine.textContent = t("setup.rules.played", { rules: played.join(", ") });
    this.rulesLine.hidden = Boolean(editable) || played.length === 0;
    // An answer to an earlier change would undo the later ones, and the next change would send it back.
    if (!editable || this.behind) return;
    // Only maps that seat every player already in.
    const fitting = this.maps.filter(
      (candidate) =>
        (candidate.maxPlayers ?? 0) >= lobby.players.length || candidate.id === lobby.map,
    );
    this.mapSelect.replaceChildren(
      ...MAP_GROUPS.filter((group) => fitting.some((candidate) => candidate.group === group)).map(
        (group) =>
          h(
            "optgroup",
            { label: t(`menu.maps.${group}`) },
            ...fitting
              .filter((candidate) => candidate.group === group)
              .map((candidate) =>
                h(
                  "option",
                  { value: candidate.id },
                  candidate.name?.[getLanguage()] ?? candidate.id,
                ),
              ),
          ),
      ),
    );
    this.mapSelect.value = lobby.map;
    const listed = lobby.name !== null;
    this.gameNameLabel.hidden = !listed;
    this.gameName.hidden = !listed;
    // Not while the host is typing a new one.
    if (listed && document.activeElement !== this.gameName) this.gameName.value = lobby.name ?? "";
    const most = seatLimit(map, lobby.bots);
    const least = Math.min(most, Math.max(MIN_SEATS, lobby.players.length));
    this.seats.replaceChildren(
      ...Array.from({ length: most - least + 1 }, (_, i) =>
        h("option", { value: least + i }, String(least + i)),
      ),
    );
    this.seats.value = String(Math.min(Math.max(lobby.capacity, least), most));
    this.autoStart.checked = lobby.autoStart;
    this.difficulty.replaceChildren(
      ...DIFFICULTIES.map((level) => h("option", { value: level }, t(`difficulty.${level}`))),
    );
    this.difficulty.value = lobby.difficulty;
    this.nations.checked = lobby.nations;
    // A public game plays the default rules, shown but not offered for change.
    this.rules.show(lobby.rules, lobby.visibility === "private");
    this.teams.replaceChildren(
      ...TEAM_CHOICES.map((teams) =>
        h("option", { value: teams }, t(`mode.${String(teams)}` as MessageKey)),
      ),
    );
    this.teams.value = String(lobby.teams);
    this.speedLabel.hidden = listed;
    this.speed.hidden = listed;
    this.speed.replaceChildren(
      ...GAME_SPEEDS.map((speed) =>
        h("option", { value: speed }, t("replay.speed", { speed: String(speed) })),
      ),
    );
    this.speed.value = String(lobby.speed);
    for (const { bit, input } of this.allowed) {
      input.checked = (disabled & bit) === 0;
      input.disabled = bit === Disable.Warships && (lobby.disabled & Disable.Port) !== 0;
    }
    this.bots.max = String(botLimit(map, lobby.players.length));
    this.bots.value = String(lobby.bots);
    this.botsValue.textContent = String(lobby.bots);
  }

  private showLobbyStatus(lobby: LobbyState): void {
    const count = { players: lobby.players.length, capacity: lobby.capacity };
    const hostName = lobby.players.find((player) => player.id === lobby.host)?.name ?? "";
    if (this.startsAt === undefined) {
      if (lobby.host !== lobby.you) this.show("online.waitingFor", { ...count, host: hostName });
      else if (lobby.players.length < lobby.minPlayers) this.show("online.waitingOpponent", count);
      else this.show("online.youHost", count);
    } else {
      const seconds = Math.max(0, Math.ceil((this.startsAt - performance.now()) / 1000));
      // Alone in a quick game: bots stand in for the opponents at the end.
      if (lobby.players.length < lobby.minPlayers) this.show("online.soloStarting", { seconds });
      else this.show("status.starting", { ...count, seconds });
    }
  }

  private show(key: MessageKey, params: Params = {}): void {
    this.shown = { key, params };
    this.status.textContent = t(key, params);
  }
}
