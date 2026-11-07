import {
  GAME_SPEEDS,
  type GameOptions,
  type GameSpeed,
  type Teams,
  type Visibility,
} from "@frontfall/protocol";
import { defaultRules } from "../game/defaults.ts";
import type { MapInfo } from "../maps.ts";
import type { GameStart } from "../net/online.ts";
import { botLimit, seatLimit } from "../ui/lobby.ts";
import type { GameSetup } from "../ui/setup.ts";

/** The pace of the game before, unless it is the normal one or a test's own (R-MODE-07). */
export function rematchSpeed(speed: number | undefined): { speed?: GameSpeed } {
  const pace = GAME_SPEEDS.find((candidate) => candidate === speed);
  return pace === undefined || pace === 1 ? {} : { speed: pace };
}

/** The menu's choices as settings of a new game, kept within what the server accepts. */
export function initialOptions(
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
      ? { rules: { ...defaultRules(), ...chosen.rules } }
      : {}),
  };
}

/** A new private game with the settings of the game that just ended, for a rematch. */
export function rematchSetup(setup: GameSetup, start: GameStart): GameSetup {
  return {
    ...setup,
    map: start.map,
    bots: start.bots,
    difficulty: start.difficulty,
    nations: start.nations,
    teams: start.teams,
    disabled: start.disabled,
    speed: start.speed,
    rules: start.rules,
  };
}

/** The address of a private game, to share: this page with `?game=<id>`. */
export function inviteLink(href: string, game: string): string {
  const url = new URL(href);
  url.search = new URLSearchParams({ game }).toString();
  url.hash = "";
  return url.href;
}
