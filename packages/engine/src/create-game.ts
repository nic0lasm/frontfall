import { ORDER_TYPES } from "@frontfall/contracts";
import { installAttacks } from "./attacks.ts";
import { installBoats } from "./boats.ts";
import { installCapitals } from "./capitals.ts";
import { installDiplomacy } from "./diplomacy.ts";
import { installDoctrines } from "./doctrines.ts";
import { installEconomy } from "./economy.ts";
import { installGifts } from "./gifts.ts";
import { installLandmarks } from "./landmarks.ts";
import { installQuickMessages } from "./quick-messages.ts";
import { installMissiles } from "./missiles.ts";
import { Game, type GameSetup } from "./game.ts";
import { installSpawn } from "./spawn.ts";
import { installStructures } from "./structures.ts";
import { installTrade } from "./trade.ts";
import { installVictory } from "./victory.ts";
import { installWarships } from "./warships.ts";

/** One rule of the engine: its name, and the function that installs it on a game. */
export interface Rule {
  readonly name: string;
  /**
   * Registers the rule's orders, tick systems, observers and parts. A rule
   * the game does not play with installs nothing: capitals without capital
   * mode (R-CAP), landmarks on a map that has none (R-LAND).
   */
  readonly install: (game: Game) => void;
}

/**
 * Every rule of the engine, in the order the rules expect: spawns, then
 * doctrines, then alliances, gifts and messages, then attacks, then warships,
 * then missiles, then transport ships, then capitals (R-CAP), then structures
 * changing hands with their tiles, then trade, then growth, then landmarks
 * changing hands, then victory. Order rules, tick systems and observers run
 * in registration order, so this order is part of the game.
 */
export const STANDARD_RULES: readonly Rule[] = Object.freeze([
  { name: "spawn", install: installSpawn },
  { name: "doctrines", install: installDoctrines },
  { name: "diplomacy", install: installDiplomacy },
  { name: "gifts", install: installGifts },
  { name: "quick-messages", install: installQuickMessages },
  { name: "attacks", install: installAttacks },
  { name: "warships", install: installWarships },
  { name: "missiles", install: installMissiles },
  { name: "boats", install: installBoats },
  { name: "capitals", install: installCapitals },
  { name: "structures", install: installStructures },
  { name: "trade", install: installTrade },
  { name: "economy", install: installEconomy },
  { name: "landmarks", install: installLandmarks },
  { name: "victory", install: installVictory },
]);

/**
 * A game with every rule of `STANDARD_RULES` installed, in its order. Every
 * kind of order of the spec has its rule, or the game is not created.
 */
export function createGame(setup: GameSetup): Game {
  const game = new Game(setup);
  game.terrain.prepare();
  for (const rule of STANDARD_RULES) rule.install(game);
  assertOrderRules(game);
  return game;
}

/** Throws unless every order type of `ORDER_SPEC` has a rule in `game`: such orders would be dropped. */
export function assertOrderRules(game: Game): void {
  const missing = ORDER_TYPES.filter((type) => !game.hasOrderRule(type));
  if (missing.length > 0) {
    throw new RangeError(`no rule for the orders of type ${missing.join(", ")}`);
  }
}
