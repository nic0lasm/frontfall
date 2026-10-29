import { installAttacks } from "./attacks.ts";
import { installBoats } from "./boats.ts";
import { installCapitals } from "./capitals.ts";
import { installDiplomacy } from "./diplomacy.ts";
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

/**
 * A game with every rule of the engine installed, in the order the rules
 * expect: spawns, then alliances, gifts and messages, then attacks, then warships, then missiles, then transport ships, then capitals (R-CAP), then structures changing hands
 * with their tiles, then trade, then growth, then landmarks changing hands, then victory. Order handlers and
 * tick systems run in registration order, so this order is part of the game.
 */
export function createGame(setup: GameSetup): Game {
  const game = new Game(setup);
  game.terrain.prepare();
  installSpawn(game);
  installDiplomacy(game);
  installGifts(game);
  installQuickMessages(game);
  installAttacks(game);
  installWarships(game);
  installMissiles(game);
  installBoats(game);
  installCapitals(game);
  installStructures(game);
  installTrade(game);
  installEconomy(game);
  installLandmarks(game);
  installVictory(game);
  return game;
}
