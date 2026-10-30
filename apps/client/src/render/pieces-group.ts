/**
 * Grouping of crowded pieces at world zoom (docs/art-direction.md, pieces):
 * cities, forts and ports of one player that sit closer than their own size on
 * screen are drawn as one figurine with two satellites and a count, instead of
 * a carpet of plates. Pure, so it is tested without a canvas.
 */

export interface Groupable {
  /** Tile coordinates, y counted from the north. */
  readonly x: number;
  readonly y: number;
  /** Pieces only group with those of the same owner (and, by the caller, the same kind). */
  readonly owner: string;
}

export interface Group {
  /** Indices into the input, the one nearest the centre first. */
  readonly members: readonly number[];
}

/** Pieces are wider than tall: a vertical gap counts for a little more. */
const ASPECT = 1.2;
/** A pair that was together keeps this much more reach, so a group does not flicker at a zoom threshold. */
export const HYSTERESIS = 1.12;

/** The tile of a piece, as a key to remember it by between two groupings. */
export const keyOf = (x: number, y: number): number => y * 65536 + x;

/**
 * Groups pieces closer than `reach` tiles (measured on the same scale in x
 * and y). `before` maps the key of each piece grouped last time to its group
 * number, to give those a little more reach.
 */
export function groupPieces(
  items: readonly Groupable[],
  reach: number,
  before: ReadonlyMap<number, number> = new Map(),
): Group[] {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root] ?? root;
    // Path compression.
    while (parent[i] !== root) {
      const next = parent[i] ?? root;
      parent[i] = root;
      i = next;
    }
    return root;
  };
  const wide = reach * HYSTERESIS;
  const cells = new Map<string, number[]>();
  const cellOf = (v: number): number => Math.floor(v / wide);
  items.forEach((item, i) => {
    const key = `${String(cellOf(item.x))},${String(cellOf(item.y))}`;
    const cell = cells.get(key);
    if (cell) cell.push(i);
    else cells.set(key, [i]);
  });
  items.forEach((a, i) => {
    const cx = cellOf(a.x);
    const cy = cellOf(a.y);
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        for (const j of cells.get(`${String(gx)},${String(gy)}`) ?? []) {
          const b = items[j];
          if (j <= i || !b || b.owner !== a.owner) continue;
          const apart = Math.hypot(a.x - b.x, (a.y - b.y) * ASPECT);
          const was = before.get(keyOf(a.x, a.y));
          const together = was !== undefined && was === before.get(keyOf(b.x, b.y));
          if (apart < (together ? wide : reach)) parent[find(i)] = find(j);
        }
      }
    }
  });
  const byRoot = new Map<number, number[]>();
  items.forEach((_, i) => {
    const root = find(i);
    const list = byRoot.get(root);
    if (list) list.push(i);
    else byRoot.set(root, [i]);
  });
  return [...byRoot.values()].map((list) => {
    const at = (i: number): Groupable => items[i] as Groupable;
    const mx = list.reduce((sum, i) => sum + at(i).x, 0) / list.length;
    const my = list.reduce((sum, i) => sum + at(i).y, 0) / list.length;
    const centre = (i: number): number => Math.hypot(at(i).x - mx, at(i).y - my);
    return { members: [...list].sort((p, q) => centre(p) - centre(q)) };
  });
}
