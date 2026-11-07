declare const __FRONTFALL_SIMULATION__: string | undefined;

/**
 * Simulation build of this page, a hash of the engine, the balance, the
 * protocol, the maps and the setup of a game, set by Vite (docs/protocol.md,
 * "Simulation build"). The server refuses a page of another simulation build,
 * which would desynchronise; a release that keeps the simulation keeps the
 * pages already open. Snapshots and saved games carry it too. Outside a
 * Vite build it is "dev", always accepted.
 */
export const BUILD =
  typeof __FRONTFALL_SIMULATION__ === "string" ? __FRONTFALL_SIMULATION__ : "dev";
