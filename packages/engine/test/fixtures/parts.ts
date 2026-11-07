import type { Game } from "../../src/game.ts";
import type { PersistedPart } from "../../src/state/parts.ts";

/**
 * The rule part registered under `name`, for tests that set up a state by
 * hand: one that pushes onto a list must keep the parts kept by its slots in
 * step, as the list's owner does.
 */
export function partNamed(game: Game, name: string): PersistedPart {
  const found = game.persistedParts().find((entry) => entry.name === name);
  if (!found) throw new Error(`no part ${name}`);
  return found.part;
}
