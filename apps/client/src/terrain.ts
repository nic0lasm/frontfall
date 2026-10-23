import { Random, WorldGrid } from "@frontfall/engine";

/**
 * Placeholder continents grown from random seeds, until the map generator
 * built on Natural Earth data lands. Growth crosses the east-west seam.
 */
export function generateLand(grid: WorldGrid, seed: number): Uint8Array {
  const random = new Random(seed);
  const land = new Uint8Array(grid.size);
  const frontier: number[] = [];
  const margin = Math.floor(grid.height / 6);

  for (let i = 0; i < 12; i++) {
    const tile = grid.index(
      random.nextInt(0, grid.width),
      random.nextInt(margin, grid.height - margin),
    );
    land[tile] = 1;
    frontier.push(tile);
  }

  let budget = Math.floor(grid.size * 0.35);
  while (budget > 0 && frontier.length > 0) {
    const pick = random.nextInt(0, frontier.length);
    const tile = frontier[pick] as number;
    const neighbors = grid.neighbors(tile).filter((n) => land[n] === 0);
    if (neighbors.length === 0) {
      frontier.splice(pick, 1);
      continue;
    }
    const next = neighbors[random.nextInt(0, neighbors.length)] as number;
    land[next] = 1;
    frontier.push(next);
    budget--;
  }
  return land;
}
