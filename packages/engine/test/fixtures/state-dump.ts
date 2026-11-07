import type { Attack } from "../../src/attacks.ts";
import type { Alliance, Embargo } from "../../src/diplomacy.ts";
import type { CapitalFall, Game, Player } from "../../src/game.ts";
import { sha256Hex } from "../../src/map/sha256.ts";
import { SnapshotWriter } from "../../src/snapshot-bytes.ts";

/**
 * Where the dump reads the values that belong to a special rule or to one
 * kind of order. Today they are fields of `Player`, `Attack`, `Alliance`,
 * `Embargo` and `Game`. If they move into rule parts, only this table changes:
 * the dump, and so its pinned digests, must stay the same.
 */
export const RULE_VALUES = {
  /** R-ECO-07. */
  workShare: (_game: Game, player: Player): number => player.workShare,
  /** R-DOCTRINE-01; 0 without doctrines. */
  doctrine: (_game: Game, player: Player): number => player.doctrine,
  /** R-CAP-01; undefined without capitals. */
  capital: (_game: Game, player: Player): number | undefined => player.capital,
  /** R-CAP-03, R-CAP-04; empty without capitals. */
  capitalFalls: (game: Game): readonly CapitalFall[] => game.capitalFalls,
  /** R-ATTACK-10; 0 without collapsing fronts. */
  pressure: (_game: Game, attack: Attack): number => attack.pressure,
  /** R-DIPLO-10. */
  truce: (_game: Game, alliance: Alliance): boolean => alliance.truce,
  /** R-DIPLO-09; 0 for an embargo placed by order. */
  embargoUntil: (_game: Game, embargo: Embargo): number => embargo.until,
};

/**
 * Rule parts whose values the dump reads one by one through `RULE_VALUES`,
 * so their bytes are left out. Every other part is dumped as its bytes.
 */
export const PARTS_READ_AS_VALUES: ReadonlySet<string> = new Set(["capitals"]);

/** The fields of each entity, in the order of the dump; the values of `RULE_VALUES` follow them. */
const FIELDS = {
  player: [
    "id",
    "name",
    "home",
    "team",
    "troops",
    "gold",
    "goldRemainder",
    "alive",
    "start",
    "traitorUntil",
  ],
  attacks: ["id", "player", "target", "aim", "troops"],
  boats: ["id", "player", "target", "troops", "step", "path"],
  structures: ["id", "player", "kind", "tile", "readyAt", "reloadAt"],
  tradeShips: ["id", "player", "port", "from", "to", "step", "path"],
  warships: [
    "id",
    "player",
    "tile",
    "health",
    "patrol",
    "path",
    "step",
    "reloadAt",
    "firedAt",
    "aim",
  ],
  missiles: ["id", "player", "size", "from", "to", "launchedAt", "arrivesAt", "tried"],
  fallout: ["tile", "radius", "until"],
  fights: ["a", "b", "until"],
  alliances: ["a", "b", "until", "renewA", "renewB"],
  allianceRequests: ["from", "to", "expiresAt"],
  requestCooldowns: ["from", "to", "until"],
  embargoes: ["from", "to", "since"],
  quickCooldowns: ["player", "until"],
  capitalFalls: ["tick", "player", "by", "tile"],
} as const;

/** Fields an entity may still carry that the dump reads through `RULE_VALUES`. */
const RULE_FIELDS: Partial<Record<keyof typeof FIELDS, readonly string[]>> = {
  player: ["workShare", "doctrine", "capital"],
  attacks: ["pressure"],
  alliances: ["truce"],
  embargoes: ["until"],
};

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function value(raw: unknown): Json {
  if (raw === undefined) return null;
  if (raw instanceof Int32Array || Array.isArray(raw)) return Array.from(raw as ArrayLike<number>);
  if (typeof raw === "number" || typeof raw === "boolean" || typeof raw === "string") return raw;
  throw new Error(`the state dump cannot write ${typeof raw}`);
}

/** The listed fields of one entity, refusing a field the dump does not know. */
function entity(
  kind: keyof typeof FIELDS,
  item: object,
  extra: Record<string, Json> = {},
): Record<string, Json> {
  const known = new Set<string>([...FIELDS[kind], ...(RULE_FIELDS[kind] ?? [])]);
  for (const key of Object.keys(item)) {
    if (!known.has(key)) throw new Error(`the state dump does not know ${kind}.${key}`);
  }
  const record = item as Record<string, unknown>;
  const out: Record<string, Json> = {};
  for (const key of FIELDS[kind]) out[key] = value(record[key]);
  return { ...out, ...extra };
}

/** An array as [value, length] runs, as snapshots write it. */
function runs(values: ArrayLike<number>): number[] {
  const out: number[] = [];
  let start = 0;
  for (let i = 1; i <= values.length; i++) {
    if (i < values.length && values[i] === values[start]) continue;
    out.push(values[start] as number, i - start);
    start = i;
  }
  return out;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Events in the order they happened, each with its keys sorted, as they are not of one shape. */
function events(list: readonly object[]): Json[] {
  return list.map((event) => {
    const record = event as Record<string, unknown>;
    const out: Record<string, Json> = {};
    for (const key of Object.keys(record).sort()) out[key] = value(record[key]);
    return out;
  });
}

/**
 * The state of a game as canonical JSON: what it is, not how it is stored
 * or hashed. Two games with the same dump play on alike. The values of the
 * special rules are read through `RULE_VALUES`, and rule parts are written
 * as their bytes, in registration order, but for `PARTS_READ_AS_VALUES`.
 */
export function dumpState(game: Game): string {
  const { territory } = game;
  const borders: number[][] = [];
  for (let player = 1; player <= territory.maxPlayers; player++) {
    const list: number[] = [];
    for (let i = 0; i < territory.borderCount(player); i++)
      list.push(territory.borderTile(player, i));
    borders.push(list);
  }
  const parts: Json[] = [];
  for (const { name, part } of game.persistedParts()) {
    if (PARTS_READ_AS_VALUES.has(name)) continue;
    const out = new SnapshotWriter();
    part.save(out);
    parts.push({ name, bytes: hex(out.finish()) });
  }
  const list = <T extends object>(
    kind: keyof typeof FIELDS,
    items: readonly T[],
    extra: (item: T) => Record<string, Json> = () => ({}),
  ): Json[] => items.map((item) => entity(kind, item, extra(item)));
  const dump: Record<string, Json> = {
    tick: game.tick,
    random: [...game.random.state()],
    owners: runs(territory.owners),
    borders,
    falloutUntil: runs(game.falloutUntil),
    players: list("player", game.players(), (p) => ({
      workShare: RULE_VALUES.workShare(game, p),
      doctrine: RULE_VALUES.doctrine(game, p),
      capital: value(RULE_VALUES.capital(game, p)),
    })),
    nextIds: [
      game.nextAttackId,
      game.nextBoatId,
      game.nextStructureId,
      game.nextTradeShipId,
      game.nextWarshipId,
      game.nextMissileId,
    ],
    attacks: list("attacks", game.attacks, (a) => ({ pressure: RULE_VALUES.pressure(game, a) })),
    boats: list("boats", game.boats),
    structures: list("structures", game.structures),
    tradeShips: list("tradeShips", game.tradeShips),
    warships: list("warships", game.warships),
    missiles: list("missiles", game.missiles),
    fallout: list("fallout", game.fallout),
    fights: list("fights", game.fights),
    alliances: list("alliances", game.alliances, (a) => ({ truce: RULE_VALUES.truce(game, a) })),
    allianceRequests: list("allianceRequests", game.allianceRequests),
    requestCooldowns: list("requestCooldowns", game.requestCooldowns),
    embargoes: list("embargoes", game.embargoes, (e) => ({
      until: RULE_VALUES.embargoUntil(game, e),
    })),
    quickCooldowns: list("quickCooldowns", game.quickCooldowns),
    capitalFalls: list("capitalFalls", RULE_VALUES.capitalFalls(game)),
    winner: value(game.winner),
    winningTeam: value(game.winningTeam),
    decidedAt: value(game.decidedAt),
    parts,
    diplomacyEvents: events(game.diplomacyEvents),
    missileEvents: events(game.missileEvents),
  };
  return JSON.stringify(dump);
}

/** SHA-256 of `dumpState`, in hex. */
export function stateDigest(game: Game): string {
  const json = dumpState(game);
  const bytes = new Uint8Array(json.length);
  for (let i = 0; i < json.length; i++) {
    const code = json.charCodeAt(i);
    if (code > 0x7f) throw new Error("the state dump is ASCII");
    bytes[i] = code;
  }
  return sha256Hex(bytes);
}
