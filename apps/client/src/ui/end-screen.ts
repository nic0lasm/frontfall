import type { GameUpdate } from "../game/solo-game.ts";
import { applyTranslations, t, type MessageKey } from "../i18n/index.ts";
import type { GameTracker } from "../usage.ts";
import { CATALOGUE, badgeLevel } from "../achievements/catalog.ts";
import type { Gain } from "../achievements/store.ts";
import { badge } from "../achievements/badge.ts";
import "./end-screen.css";
import { h, present } from "./dom.ts";
import { feedbackBlock } from "./vote.ts";
import { formatDuration, formatPercent } from "./format.ts";
import type { StatsHistory } from "./screen/stats-history.ts";
import { activeRuleNames } from "./rules-fieldset.ts";
import { statsChart } from "./stats-chart.ts";

export interface EndScreenActions {
  onNewGame(): void;
  onMenu(): void;
  onWatch(): void;
  /** Saves a record of the game to watch again. */
  onDownload(): void;
}

export interface GameSummary {
  update: GameUpdate;
  ticksPerSecond: number;
  ownableTiles: number;
  /** Most land the human held at any time, in tiles. */
  peakTiles: number;
  /** Achievements this game earned for the first time. */
  achievements: readonly Gain[];
  /** Whether the game can be saved as a replay. */
  canRecord: boolean;
  /** Team of each player by id, in a team game. */
  teams: readonly number[];
  /** The map and the device, for a bug report. */
  details: string;
  /** Land and troops over the game, and what the chart needs to draw them. */
  stats: StatsHistory;
  /** Share of the land that wins, in percent. */
  winShare: number;
  /** Colour of a player on the map. */
  color: (player: number) => string;
  /** Special rules the game was played with (R-MODE-08); none shows nothing. */
  special?: Readonly<Record<string, boolean>>;
  /** Where the game was played: the first button plays it again or goes back to the lobby. */
  kind: "solo" | "online" | "replay";
}

/** One click on from the end: the same game again, the online lobby, or a new choice. */
const REMATCH_LABEL = {
  solo: "end.replay",
  online: "end.lobby",
  replay: "end.newGame",
} as const satisfies Record<GameSummary["kind"], MessageKey>;

/** Who won, how long it took, how far the player got, and a way to play again. */
export function endScreen(
  summary: GameSummary,
  tracker: GameTracker | undefined,
  actions: EndScreenActions,
): HTMLElement {
  const { update } = summary;
  const winner = update.players.find((player) => player.id === update.winner);
  const team = update.winningTeam;
  const won =
    team === undefined ? update.winner === update.you : summary.teams[update.you] === team;
  const seconds = update.tick / summary.ticksPerSecond;

  const button = (key: MessageKey, onClick: () => void, primary = false): HTMLButtonElement => {
    const element = h("button", {
      type: "button",
      class: primary ? "primary" : "secondary",
      "data-i18n": key,
    });
    element.addEventListener("click", onClick);
    return element;
  };

  const row = (key: MessageKey, value: string): HTMLElement[] => [
    h("dt", { "data-i18n": key }),
    h("dd", {}, value),
  ];

  const played = activeRuleNames(summary.special);
  const dialog = h(
    "section",
    {
      class: `end-screen ${won ? "won" : "lost"}`,
      id: "end-screen",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "end-title",
    },
    h(
      "div",
      { class: "end-body" },
      h("h1", { id: "end-title", "data-i18n": won ? "end.victory" : "end.defeat" }),
      h(
        "p",
        { class: "end-winner" },
        team === undefined
          ? t("end.winner", { name: winner?.name ?? "" })
          : t("end.teamWinner", { team, name: winner?.name ?? "" }),
      ),
      // The high point of the game: the most land the player held at once.
      h(
        "p",
        { class: "end-hero" },
        h(
          "strong",
          { class: "end-hero-value" },
          formatPercent(summary.peakTiles / Math.max(1, summary.ownableTiles)),
        ),
        h("span", { class: "end-hero-label", "data-i18n": "end.peak" }),
      ),
      h("dl", { class: "end-stats" }, ...row("end.duration", formatDuration(seconds))),
      ...(played.length > 0
        ? [h("p", { class: "end-rules" }, t("setup.rules.played", { rules: played.join(", ") }))]
        : []),
      ...(update.capitals ? capitalStory(update, summary.ticksPerSecond) : []),
      ...present(
        statsChart({
          history: summary.stats,
          you: update.you,
          ownableTiles: summary.ownableTiles,
          winShare: summary.winShare,
          color: summary.color,
        }),
      ),
      ...(summary.achievements.length > 0 ? [newAchievements(summary.achievements)] : []),
      // A thumbs up or down, once per game played (not for a replay).
      ...(tracker ? [feedbackBlock(tracker, summary.details)] : []),
    ),
    h(
      "div",
      { class: "end-actions" },
      button(
        REMATCH_LABEL[summary.kind],
        () => {
          actions.onNewGame();
        },
        true,
      ),
      button("end.watch", () => {
        actions.onWatch();
      }),
      ...(summary.canRecord
        ? [
            button("end.download", () => {
              actions.onDownload();
            }),
          ]
        : []),
      button("end.menu", () => {
        actions.onMenu();
      }),
    ),
  );
  applyTranslations(dialog);
  return h("div", { class: "overlay" }, dialog);
}

/** The achievements this game unlocked, each with its badge and, for a tiered one, the tier. */
/** Most fallen capitals listed, the latest ones. */
const FALLS_SHOWN = 6;

/**
 * Capital mode (R-CAP-03): how the player's own capital fared, then the
 * capitals that fell, the latest last.
 */
function capitalStory(update: GameUpdate, ticksPerSecond: number): HTMLElement[] {
  const falls = (update.capitals?.falls ?? []).filter((fall) => fall.by !== 0);
  const name = (id: number): string => update.players.find((p) => p.id === id)?.name ?? "";
  const time = (tick: number): string => formatDuration(tick / ticksPerSecond);
  const lost = falls.find((fall) => fall.player === update.you);
  const taken = falls.filter((fall) => fall.by === update.you).length;
  const story = lost
    ? t("end.capitalLost", { name: name(lost.by), time: time(lost.tick) })
    : taken === 1
      ? t("end.capitalTaken")
      : taken > 1
        ? t("end.capitalsTaken", { count: taken })
        : undefined;
  if (falls.length === 0 && story === undefined) return [];
  return [
    h(
      "section",
      { class: "end-capitals", "aria-labelledby": "end-capitals-title" },
      h("h2", { id: "end-capitals-title", "data-i18n": "end.falls" }),
      ...(story === undefined ? [] : [h("p", { class: "end-capital-story" }, story)]),
      h(
        "ol",
        { class: "end-falls" },
        ...falls
          .slice(-FALLS_SHOWN)
          .map((fall) =>
            h(
              "li",
              { class: fall.player === update.you || fall.by === update.you ? "mine" : "" },
              t("end.fall", { time: time(fall.tick), a: name(fall.by), b: name(fall.player) }),
            ),
          ),
      ),
    ),
  ];
}

function newAchievements(gains: readonly Gain[]): HTMLElement {
  return h(
    "section",
    { class: "end-achievements", "aria-labelledby": "end-achievements-title" },
    h("h2", { id: "end-achievements-title", "data-i18n": "end.achievements" }),
    h(
      "ul",
      {},
      ...gains.map(({ id, level }) => {
        const achievement = CATALOGUE.find((candidate) => candidate.id === id);
        return h(
          "li",
          {},
          badge(id, achievement ? badgeLevel(achievement, level) : 3),
          h(
            "span",
            {},
            h("strong", { "data-i18n": `achievement.${id}.name` as MessageKey }),
            achievement?.tiers
              ? h("em", { "data-i18n": `achievements.tier.${String(level)}` as MessageKey })
              : h("small", { "data-i18n": `achievement.${id}.text` as MessageKey }),
          ),
        );
      }),
    ),
  );
}
