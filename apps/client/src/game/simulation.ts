import {
  CITY_STATES_PER_NATION,
  DEFAULT_BALANCE,
  createGame,
  installBots,
  installCityStates,
  installNations,
  type Balance,
  type Game,
  type GameSetup,
  type PlayerSetup,
} from "@frontfall/engine";
import type { Difficulty, SoloOptions } from "./solo-game.ts";

/**
 * How this client sets up the simulation of a game from its options: who
 * plays with which id, the balance, and the rules installed. Every client of
 * an online game must do it alike, so this file is part of the simulation
 * build (docs/protocol.md, "Simulation build"), with the engine and the
 * protocol; keep anything else out of it.
 */

export const HUMAN_ID = 1;

/** Options that decide the setup, and only those. */
export type SetupOptions = Pick<
  SoloOptions,
  "bots" | "players" | "playerName" | "nations" | "maxMinutes" | "goldRate" | "cityLand"
>;

/** Names for computer players. Invented, so they never collide with real countries. */
const BOT_NAMES = [
  "Aldmere",
  "Brask",
  "Corvan",
  "Dunmoor",
  "Elsk",
  "Fenwold",
  "Gorran",
  "Halvik",
  "Istra",
  "Jorvel",
  "Kesh",
  "Lorne",
  "Mirava",
  "Norrin",
  "Ostmark",
  "Pellan",
  "Quill",
  "Ravenna",
  "Sorrel",
  "Tarsk",
  "Ulvar",
  "Vesk",
  "Wyndham",
  "Yarrow",
  "Zennor",
];

export const MAX_BOTS = BOT_NAMES.length;
export { CITY_STATES_PER_NATION };

/** Halves of invented city-state names, joined first by last: 24 x 24 names, none a real country. */
const CITY_HEADS = [
  "Ar",
  "Bel",
  "Cal",
  "Dor",
  "Esk",
  "Fal",
  "Gal",
  "Hal",
  "Ith",
  "Jar",
  "Kel",
  "Lor",
  "Mar",
  "Nor",
  "Ost",
  "Pel",
  "Quar",
  "Ros",
  "Sal",
  "Tor",
  "Ul",
  "Val",
  "Wen",
  "Zar",
];
const CITY_TAILS = [
  "ada",
  "bury",
  "cor",
  "dell",
  "ene",
  "ford",
  "gard",
  "hold",
  "ia",
  "is",
  "keep",
  "lin",
  "mere",
  "nor",
  "on",
  "port",
  "rath",
  "stead",
  "ton",
  "um",
  "vale",
  "wick",
  "ya",
  "zen",
];

/** The name of the `index`th city-state of a game, the same on every client. */
export function cityStateName(index: number): string {
  const head = CITY_HEADS[index % CITY_HEADS.length] as string;
  // A stride prime to the tails' count, so neighbouring numbers do not rhyme.
  const tail = CITY_TAILS[
    (index * 7 + Math.floor(index / CITY_HEADS.length)) % CITY_TAILS.length
  ] as string;
  return head + tail;
}

/** Players and balance of a new game: the humans, then the bots, then the map's nations and their city-states. */
export function newSetup(
  options: SetupOptions,
  mapNations: readonly { name: string; tile: number }[],
): {
  players: PlayerSetup[];
  botIds: number[];
  nationIds: number[];
  cityStateIds: number[];
  balance: Balance;
} {
  const bots = Math.max(0, Math.min(MAX_BOTS, Math.floor(options.bots)));
  const humans = options.players ?? [{ id: HUMAN_ID, name: options.playerName }];
  const firstBot = Math.max(...humans.map((human) => human.id)) + 1;
  const players: PlayerSetup[] = [...humans];
  const botIds: number[] = [];
  for (let i = 0; i < bots; i++) {
    botIds.push(firstBot + i);
    players.push({ id: firstBot + i, name: BOT_NAMES[i] as string });
  }
  // Nations take the numbers after the bots, in the manifest's order, the same on every client.
  const nationIds: number[] = [];
  if (options.nations) {
    for (const { name, tile } of mapNations) {
      const id = firstBot + bots + nationIds.length;
      nationIds.push(id);
      players.push({ id, name, start: tile });
    }
  }
  // City-states come with the nations, placed at random when the spawn phase ends (R-BOT-29).
  const cityStateIds: number[] = [];
  const firstCity = firstBot + bots + nationIds.length;
  for (let i = 0; i < nationIds.length * CITY_STATES_PER_NATION; i++) {
    cityStateIds.push(firstCity + i);
    players.push({ id: firstCity + i, name: cityStateName(i) });
  }
  const balance = { ...DEFAULT_BALANCE };
  if (options.maxMinutes !== undefined) {
    balance.maxDurationTicks = Math.round(options.maxMinutes * 60 * DEFAULT_BALANCE.ticksPerSecond);
  }
  if (options.goldRate !== undefined) balance.goldPerThousandTroops = Math.floor(options.goldRate);
  if (options.cityLand !== undefined) balance.cityLand = Math.floor(options.cityLand);
  return { players, botIds, nationIds, cityStateIds, balance };
}

/** A game with every rule installed, then the bots, the city-states and the nations, in that order. */
export function createSimulation(
  setup: GameSetup,
  botIds: readonly number[],
  nationIds: readonly number[],
  difficulty: Difficulty,
  cityStateIds: readonly number[] = [],
): Game {
  const game = createGame(setup);
  installBots(game, botIds, difficulty);
  installCityStates(game, cityStateIds);
  installNations(game, nationIds, difficulty);
  return game;
}
