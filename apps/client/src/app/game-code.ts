import { warmMap, type MapInfo } from "../maps.ts";
import { prebakeGround } from "../render/prebaked-ground.ts";

export type GameModule = typeof import("../ui/game-screen.ts");

let gameModule: Promise<GameModule> | undefined;
/** The game screen's code, once loadGame has fetched it. */
let gameCode: GameModule | undefined;

/**
 * Fetches the game screen, with the renderer and the interface it draws: the menu does
 * not need them, so a first visit leaves them to a game that is about to start.
 */
export function loadGame(): Promise<GameModule> {
  gameModule ??= Promise.all([
    import("../ui/game-screen.ts"),
    // The territory layer, the pieces and the globe: without them no game can be drawn.
    import("../render/renderer.ts").then(({ loadGlobe }) => loadGlobe()),
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
export async function loadGameWithStyles(): Promise<GameModule> {
  const loaded = await loadGame();
  await loaded.loadGameStyles();
  return loaded;
}

/** The game screen's code if it is already here, for turns that cannot wait. */
export function loadedGame(): GameModule | undefined {
  return gameCode;
}

/** Fetches the map's files, which the worker would otherwise wait for, and bakes its ground. */
export function warmGameMap(info: MapInfo): void {
  void warmMap(info);
  void prebakeGround(info);
}
