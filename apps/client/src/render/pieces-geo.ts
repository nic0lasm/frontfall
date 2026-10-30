/**
 * The shape of the nine buildings the map draws (docs/art-direction.md, pieces):
 * one description per kind, as flat parts with a material role and a level of
 * detail, so the atlas painter and the tests read the same drawing. Pure data,
 * no canvas and no WebGL.
 *
 * Local space: x in [-50, 50], y in [-100, 0] (up is negative), the ground
 * contact near y = -10, light from the north-west.
 */

export type BuildingKind =
  "city" | "palace" | "mosque" | "capital" | "fort" | "port" | "silo" | "airDefense" | "landmark";

export const BUILDING_KINDS: readonly BuildingKind[] = [
  "city",
  "palace",
  "mosque",
  "capital",
  "fort",
  "port",
  "silo",
  "airDefense",
  "landmark",
];

/**
 * What a part is made of, then the face it shows: F front, S shaded side, T lit
 * top. `own…` parts carry the owner's colour, `ownDF` the darker band of it.
 */
export type Role =
  | `${"wall" | "metal" | "wood" | "gold"}${"F" | "S" | "T"}`
  | `own${"F" | "S" | "T"}`
  | "ownDF"
  | "dark"
  | "glass"
  | "flame"
  | "white";

/**
 * Detail level of a part: 0 is kept at the smallest size (the silhouette), 1
 * appears from about 30 px (windows, crenels, flags), 2 only close up.
 */
export type Level = 0 | 1 | 2;

export type Point = readonly [number, number];

interface Part {
  readonly role: Role;
  readonly level: Level;
}

/** A flat polygon. */
export interface Polygon extends Part {
  readonly kind: "polygon";
  readonly points: readonly Point[];
}

/** An ellipse turned by `turn` radians around its centre. */
export interface Ellipse extends Part {
  readonly kind: "ellipse";
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
  readonly turn: number;
}

/** A solid of revolution standing on the ground ellipse at (cx, yb) with radius r and height h. */
export interface Solid extends Part {
  readonly kind: "cylinder" | "dome" | "cone";
  readonly cx: number;
  readonly yb: number;
  readonly r: number;
  readonly h: number;
}

export type Op = Polygon | Ellipse | Solid;

/** Smallest on-screen size, in px, from which each of the levels 1 and 2 is drawn. */
export const LEVEL_FROM_PIXELS: readonly [number, number] = [30, 70];

/** The level of detail for a piece drawn `pixels` tall on screen. */
export function levelFor(pixels: number): Level {
  if (pixels < LEVEL_FROM_PIXELS[0]) return 0;
  return pixels < LEVEL_FROM_PIXELS[1] ? 1 : 2;
}

/** How far past a threshold a piece must be to change level, as a share of it. */
const LEVEL_MARGIN = 0.1;

/**
 * The level a piece moves to from `current` as it is drawn `pixels` tall: it
 * keeps its level until clearly past a threshold, so a zoom that rests on one
 * does not make the details flicker.
 */
export function settleLevel(current: Level, pixels: number): Level {
  const [first, second] = LEVEL_FROM_PIXELS;
  const wanted = levelFor(pixels);
  if (wanted > current) {
    return pixels >= (current === 0 ? first : second) * (1 + LEVEL_MARGIN) ? wanted : current;
  }
  if (wanted < current) {
    return pixels <= (current === 2 ? second : first) * (1 - LEVEL_MARGIN) ? wanted : current;
  }
  return current;
}

/** Squash of the ground ellipse under a cylinder or cone, relative to its radius. */
const GROUND = 0.38;

type Material = "wall" | "metal" | "own" | "ownD";

function describe(kind: BuildingKind): Op[] {
  const ops: Op[] = [];
  const poly = (role: Role, points: readonly Point[], level: Level = 0): void => {
    ops.push({ kind: "polygon", role, points, level });
  };
  const ellipse = (
    role: Role,
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    level: Level = 0,
    turn = 0,
  ): void => {
    ops.push({ kind: "ellipse", role, cx, cy, rx, ry, level, turn });
  };
  const solid =
    (shape: Solid["kind"]) =>
    (role: Role, cx: number, yb: number, r: number, h: number, level: Level = 0): void => {
      ops.push({ kind: shape, role, cx, yb, r, h, level });
    };
  const cylinder = solid("cylinder");
  const dome = solid("dome");
  const cone = solid("cone");
  /** A block seen from the south-east: shaded side, front, lit top. `dp` is its depth. */
  const box = (
    x: number,
    yb: number,
    w: number,
    h: number,
    dp: number,
    m: Material,
    level: Level = 0,
  ): void => {
    const dx = dp * 0.55;
    const dy = dp * 0.35;
    const face = (f: "F" | "S" | "T"): Role => (m === "ownD" ? "ownDF" : (`${m}${f}` as Role));
    poly(
      face("S"),
      [
        [x + w, yb],
        [x + w + dx, yb - dy],
        [x + w + dx, yb - h - dy],
        [x + w, yb - h],
      ],
      level,
    );
    poly(
      face("F"),
      [
        [x, yb],
        [x + w, yb],
        [x + w, yb - h],
        [x, yb - h],
      ],
      level,
    );
    poly(
      face("T"),
      [
        [x, yb - h],
        [x + dx, yb - h - dy],
        [x + w + dx, yb - h - dy],
        [x + w, yb - h],
      ],
      level,
    );
  };
  /** A hipped roof on top of a block whose top edge is at yt. */
  const hip = (
    x: number,
    yt: number,
    w: number,
    dp: number,
    rise: number,
    level: Level = 0,
  ): void => {
    const dx = dp * 0.55;
    const dy = dp * 0.35;
    const ax = x + (w + dx) / 2;
    const ay = yt - dy / 2 - rise;
    poly(
      "ownS",
      [
        [x + w, yt],
        [x + w + dx, yt - dy],
        [ax, ay],
      ],
      level,
    );
    poly(
      "ownF",
      [
        [x - 2, yt],
        [x + w + 2, yt],
        [ax, ay],
      ],
      level,
    );
  };
  const window = (x: number, y: number, w = 4, h = 5): void => {
    poly(
      "glass",
      [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ],
      1,
    );
  };
  /** A pole and a pennant in the owner's colour: fine detail, so from level 1 only. */
  const flag = (x: number, yb: number, h: number): void => {
    poly(
      "metalF",
      [
        [x - 1, yb],
        [x + 1, yb],
        [x + 1, yb - h],
        [x - 1, yb - h],
      ],
      1,
    );
    poly(
      "ownF",
      [
        [x + 1, yb - h],
        [x + 16, yb - h + 4],
        [x + 1, yb - h + 9],
      ],
      1,
    );
  };

  switch (kind) {
    case "city": {
      // A skyline that climbs from the left to one slender spire, then drops to an annex: the only
      // asymmetric piece, so it reads apart from the fort and the palace at 24 px.
      box(-46, -14, 22, 24, 14, "wall");
      hip(-46, -38, 22, 14, 12);
      box(-19, -12, 27, 46, 16, "wall");
      box(-19, -58, 27, 4, 16, "own");
      box(14, -14, 14, 52, 10, "wall");
      cone("ownF", 21 + 2.75, -66, 11, 32);
      box(32, -14, 14, 18, 12, "wall");
      hip(32, -32, 14, 12, 8);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) window(-14 + j * 12, -52 + i * 12);
      window(-39, -33);
      window(-31, -33);
      window(-39, -23);
      window(17, -52);
      window(17, -40);
      window(17, -28);
      window(37, -24);
      poly(
        "dark",
        [
          [-9, -12],
          [-1, -12],
          [-1, -22],
          [-9, -22],
        ],
        1,
      );
      break;
    }
    case "palace": {
      // A wide body under a round dome, a gilded spire and two low pavilions: symmetric and round-topped.
      box(-22, -12, 44, 34, 18, "wall");
      box(-22, -46, 44, 3, 18, "ownD");
      dome("ownF", 5, -49, 21, 30);
      poly("goldF", [
        [3, -78],
        [7, -78],
        [7, -94],
        [3, -94],
      ]);
      ellipse("goldT", 5, -96, 3.5, 3.5);
      cylinder("wallF", -32, -12, 6.5, 44);
      cone("ownF", -32, -56, 8, 16);
      cylinder("wallF", 42, -12, 6.5, 44);
      cone("ownF", 42, -56, 8, 16);
      poly(
        "dark",
        [
          [-6, -12],
          [6, -12],
          [6, -24],
          [0, -29],
          [-6, -24],
        ],
        1,
      );
      for (const x of [-18, -11, 8, 15])
        poly(
          "glass",
          [
            [x, -34],
            [x + 4, -34],
            [x + 4, -26],
            [x, -26],
          ],
          1,
        );
      break;
    }
    case "mosque": {
      // A prayer hall under one plain dome and a finial, between two slender minarets with
      // pointed caps: tall and thin where the palace is wide and stocky, and nothing but the
      // building itself, no figure and no emblem.
      box(-22, -12, 44, 28, 16, "wall");
      box(-22, -40, 44, 3, 16, "ownD");
      dome("ownF", 3, -43, 19, 26);
      poly("goldF", [
        [1.5, -67],
        [4.5, -67],
        [4.5, -82],
        [1.5, -82],
      ]);
      ellipse("goldT", 3, -84, 3.5, 3.5);
      for (const cx of [-34, 40]) {
        cylinder("wallF", cx, -12, 5, 58);
        cylinder("ownDF", cx, -66, 7, 4, 1);
        cone("ownF", cx, -70, 5.5, 26);
      }
      poly(
        "dark",
        [
          [-5, -12],
          [5, -12],
          [5, -21],
          [0, -28],
          [-5, -21],
        ],
        1,
      );
      for (const x of [-17, -10, 8, 15])
        poly(
          "glass",
          [
            [x, -28],
            [x + 3.5, -28],
            [x + 3.5, -21],
            [x + 1.75, -24],
            [x, -21],
          ],
          1,
        );
      break;
    }
    case "capital": {
      // The crown: five points, a band, jewels.
      cylinder("wallF", 0, -10, 34, 20);
      cylinder("wallF", 0, -22, 27, 8, 1);
      poly("goldS", [
        [-34, -30],
        [-36, -76],
        [-19, -52],
        [-8, -88],
        [0, -56],
        [8, -88],
        [19, -52],
        [36, -76],
        [34, -30],
      ]);
      poly("goldF", [
        [-30, -30],
        [-31, -66],
        [-17, -48],
        [-8, -80],
        [0, -52],
        [8, -80],
        [17, -48],
        [31, -66],
        [30, -30],
      ]);
      poly("ownF", [
        [-31, -30],
        [31, -30],
        [31, -40],
        [-31, -40],
      ]);
      poly(
        "goldT",
        [
          [-31, -40],
          [31, -40],
          [31, -42],
          [-31, -42],
        ],
        1,
      );
      ellipse("white", 0, -35, 3.5, 3.5);
      ellipse("white", -17, -35, 2.6, 2.6, 1);
      ellipse("white", 17, -35, 2.6, 2.6, 1);
      for (const [x, y] of [
        [-36, -77],
        [36, -77],
        [-8, -89],
        [8, -89],
      ] as const)
        ellipse("goldT", x, y, 3.2, 3.2);
      break;
    }
    case "fort": {
      // A low, wide block without a roof: coarse crenels, two squat corner bastions, a gate.
      box(-44, -12, 88, 34, 16, "wall");
      for (let i = 0; i < 4; i++) box(-30 + i * 19, -46, 11, 8, 6, "wall");
      box(-50, -12, 16, 46, 12, "wall");
      box(34, -12, 16, 46, 12, "wall");
      poly(
        "ownF",
        [
          [-44, -34],
          [44, -34],
          [44, -38],
          [-44, -38],
        ],
        1,
      );
      for (const x of [-50, 34])
        for (let i = 0; i < 2; i++) box(x + i * 9, -58, 7, 6, 4, "wall", 1);
      poly("dark", [
        [-9, -12],
        [9, -12],
        [9, -26],
        [0, -32],
        [-9, -26],
      ]);
      poly(
        "dark",
        [
          [-26, -30],
          [-22, -30],
          [-22, -24],
          [-26, -24],
        ],
        1,
      );
      poly(
        "dark",
        [
          [22, -30],
          [26, -30],
          [26, -24],
          [22, -24],
        ],
        1,
      );
      flag(0, -46, 14);
      break;
    }
    case "port": {
      poly("woodS", [
        [-46, -4],
        [46, -4],
        [52, -14],
        [-40, -14],
      ]);
      poly("woodF", [
        [-46, -4],
        [46, -4],
        [46, -9],
        [-46, -9],
      ]);
      for (let i = 0; i < 6; i++)
        poly(
          "woodS",
          [
            [-38 + i * 15, -4],
            [-35 + i * 15, -4],
            [-35 + i * 15, -9],
            [-38 + i * 15, -9],
          ],
          1,
        );
      box(14, -14, 28, 22, 14, "wall");
      box(12, -36, 32, 4, 14, "own");
      // The crane over the quay.
      box(-34, -14, 8, 58, 8, "metal");
      poly("metalF", [
        [-34, -72],
        [32, -62],
        [32, -57],
        [-34, -66],
      ]);
      poly(
        "goldF",
        [
          [-34, -72],
          [-22, -72],
          [-22, -66],
          [-34, -66],
        ],
        1,
      );
      poly(
        "metalS",
        [
          [-31, -72],
          [-26, -72],
          [-26, -58],
        ],
        1,
      );
      poly(
        "metalF",
        [
          [28, -60],
          [30, -60],
          [30, -36],
          [28, -36],
        ],
        1,
      );
      poly("ownF", [
        [24, -36],
        [34, -36],
        [34, -29],
        [24, -29],
      ]);
      poly("dark", [
        [-44, -2],
        [-6, -2],
        [-12, 4],
        [-38, 4],
      ]);
      break;
    }
    case "silo": {
      ellipse("metalS", 0, -14, 40, 15);
      ellipse("metalF", 0, -16, 38, 13.5);
      ellipse("dark", 0, -17, 28, 9.5);
      // The missile rising from the hatch, and the open hatch leaves.
      cylinder("white", 0, -20, 10, 52);
      cone("ownF", 0, -72, 10, 20);
      poly(
        "ownF",
        [
          [-10, -52],
          [10, -52],
          [10, -44],
          [-10, -44],
        ],
        1,
      );
      poly("ownS", [
        [-10, -34],
        [-20, -22],
        [-10, -26],
      ]);
      poly("ownS", [
        [10, -34],
        [20, -22],
        [10, -26],
      ]);
      poly("metalF", [
        [-40, -16],
        [-30, -16],
        [-23, -52],
        [-34, -52],
      ]);
      poly("metalS", [
        [40, -16],
        [30, -16],
        [23, -52],
        [34, -52],
      ]);
      ellipse("flame", 0, -18, 7, 3, 1);
      break;
    }
    case "airDefense": {
      box(-30, -12, 54, 12, 18, "metal");
      cylinder("metalF", -4, -24, 12, 26);
      dome("white", -4, -50, 12, 9, 1);
      // The radar dish, and the launcher tubes.
      ellipse("metalS", -4, -66, 28, 21, 0, -0.62);
      ellipse("metalT", -4, -66, 24, 17, 0, -0.62);
      ellipse("dark", -4, -66, 6, 4.5, 1, -0.62);
      poly("metalF", [
        [-6, -66],
        [-2, -66],
        [-2, -50],
        [-6, -50],
      ]);
      poly("ownS", [
        [10, -18],
        [18, -24],
        [42, -52],
        [34, -58],
      ]);
      poly("ownF", [
        [10, -26],
        [20, -30],
        [44, -60],
        [34, -62],
      ]);
      ellipse("dark", 39, -60, 5, 2.4, 1, -0.9);
      break;
    }
    case "landmark": {
      // A pediment on four columns, for the landmarks of a city map.
      box(-40, -10, 80, 6, 14, "wall");
      box(-37, -16, 74, 5, 12, "wall", 1);
      for (const cx of [-28, -9.5, 9.5, 28]) cylinder("wallF", cx, -20, 5.2, 36);
      box(-40, -58, 80, 8, 14, "wall");
      poly("wallF", [
        [-42, -66],
        [0, -92],
        [42, -66],
      ]);
      poly("wallS", [
        [42, -66],
        [48, -70],
        [0, -92],
      ]);
      poly(
        "goldF",
        [
          [-30, -68],
          [0, -86],
          [30, -68],
        ],
        1,
      );
      ellipse("goldT", 0, -72, 5.5, 5.5);
      poly("ownF", [
        [-3.5, -92],
        [3.5, -92],
        [3.5, -99],
        [-3.5, -99],
      ]);
      break;
    }
  }
  return ops;
}

const cache = new Map<BuildingKind, readonly Op[]>();

/** Every part of a building, back to front, for all levels of detail. */
export function parts(kind: BuildingKind): readonly Op[] {
  let ops = cache.get(kind);
  if (!ops) {
    ops = describe(kind);
    cache.set(kind, ops);
  }
  return ops;
}

/** The parts drawn at `level` of detail: those kept at that level or any coarser one. */
export function partsAt(kind: BuildingKind, level: Level): readonly Op[] {
  return parts(kind).filter((op) => op.level <= level);
}

const ARC = 16;

/** The outline of a part as a closed polygon, for clips and silhouettes. */
export function outline(op: Op): readonly Point[] {
  switch (op.kind) {
    case "polygon":
      return op.points;
    case "ellipse": {
      const cos = Math.cos(op.turn);
      const sin = Math.sin(op.turn);
      return Array.from({ length: ARC * 2 }, (_, i): Point => {
        const a = (i / (ARC * 2)) * Math.PI * 2;
        const x = Math.cos(a) * op.rx;
        const y = Math.sin(a) * op.ry;
        return [op.cx + x * cos - y * sin, op.cy + x * sin + y * cos];
      });
    }
    case "dome": {
      // The painter's cubic: both controls 1.25 heights above the base.
      const { cx, yb, r, h } = op;
      return Array.from({ length: ARC + 1 }, (_, i): Point => {
        const t = i / ARC;
        const u = 1 - t;
        const x = (u * u * u + 3 * u * u * t) * (cx - r) + (3 * u * t * t + t * t * t) * (cx + r);
        const y = (u * u * u + t * t * t) * yb + 3 * (u * u * t + u * t * t) * (yb - h * 1.25);
        return [x, y];
      });
    }
    case "cylinder":
    case "cone": {
      const { cx, yb, r, h } = op;
      // The lower half of the ground ellipse, left to right.
      const floor = Array.from({ length: ARC + 1 }, (_, i): Point => {
        const a = Math.PI - (i / ARC) * Math.PI;
        return [cx + Math.cos(a) * r, yb + Math.sin(a) * r * GROUND];
      });
      return op.kind === "cone"
        ? [[cx, yb - h], ...floor]
        : [[cx - r, yb - h], ...floor, [cx + r, yb - h]];
    }
  }
}
