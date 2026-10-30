import type { GameUpdate, StructureType } from "../game/game-view.ts";

/** The moments of a game that make a sound. */
export type Cue =
  | "start"
  | "attack"
  | "conquest"
  | "grand"
  | "city"
  | "fort"
  | "port"
  | "palace"
  | "silo"
  | "defense"
  | "missile"
  | "impact"
  | "alliance"
  | "request"
  | "betrayal"
  | "alert"
  | "victory"
  | "defeat";

/** A cue, with where on the map it happens when it has a place, and whether it is the player's own doing. */
export interface CueEvent {
  cue: Cue;
  tile?: number;
  own: boolean;
}

const STRUCTURE_CUES: Record<StructureType, Cue> = {
  city: "city",
  palace: "palace",
  fort: "fort",
  port: "port",
  silo: "silo",
  airDefense: "defense",
};

/** An attack that wins at least this many tiles, or this share of the player's land, is a grand one. */
const GRAND_TILES = 30;
const GRAND_SHARE = 0.1;
/** Land lost between two updates that raises the alarm, as a share of the player's land. */
const ALERT_SHARE = 0.01;
const ALERT_TILES = 3;

/**
 * Reads the updates the screen already gets and says which cues they hold.
 * Nothing here touches the game, so no rule, replay or message depends on it.
 */
export class CueWatcher {
  private started = false;
  private playing = false;
  /** Attacks of the player's under way, by id, with the player's land when each was first seen. */
  private readonly attacks = new Map<number, number>();
  private readonly structures = new Set<number>();
  /** Missiles in flight, by id, to tell a launch from one already heard. */
  private readonly missiles = new Set<number>();
  private readonly allies = new Set<number>();
  private readonly requests = new Set<number>();
  private tiles = 0;
  private over = false;

  /** The first update only sets the baseline: a game joined half way makes no noise. */
  observe(update: GameUpdate): CueEvent[] {
    const events: CueEvent[] = [];
    const add = (cue: Cue, own: boolean, tile?: number): void => {
      if (!this.started) return;
      events.push(tile === undefined ? { cue, own } : { cue, own, tile });
    };
    const you = update.players.find((player) => player.id === update.you);
    const tiles = you?.tiles ?? 0;
    const play = update.phase === "play";

    if (play && !this.playing) add("start", true);
    this.playing = play;

    const attackIds = new Set(update.attacks.map((attack) => attack.id));
    for (const attack of update.attacks) {
      if (this.attacks.has(attack.id)) continue;
      this.attacks.set(attack.id, tiles);
      if (play) add("attack", true);
    }
    for (const [id, before] of this.attacks) {
      if (attackIds.has(id)) continue;
      this.attacks.delete(id);
      const won = tiles - before;
      if (won <= 0) continue;
      add(won >= Math.max(GRAND_TILES, before * GRAND_SHARE) ? "grand" : "conquest", true);
    }

    const lost = this.tiles - tiles;
    if (play && lost >= Math.max(ALERT_TILES, this.tiles * ALERT_SHARE)) add("alert", false);
    this.tiles = tiles;

    for (const structure of update.structures) {
      if (
        structure.player !== update.you ||
        !structure.ready ||
        this.structures.has(structure.id)
      ) {
        continue;
      }
      this.structures.add(structure.id);
      add(STRUCTURE_CUES[structure.type], true, structure.tile);
    }

    const flying = new Set<number>();
    for (const missile of update.missiles) {
      flying.add(missile.id);
      if (this.missiles.has(missile.id)) continue;
      this.missiles.add(missile.id);
      if (missile.player === update.you) add("missile", true, missile.tile);
    }
    for (const id of this.missiles) if (!flying.has(id)) this.missiles.delete(id);
    // Only a missile that came down is heard to land: one stopped in the air is not.
    for (const event of update.missileEvents) {
      if (event.type === "struck") add("impact", event.player === update.you, event.tile);
    }

    const allied = new Set(update.diplomacy.allies.map((ally) => ally.id));
    for (const ally of allied) {
      if (!this.allies.has(ally)) add("alliance", true);
    }
    this.allies.clear();
    for (const ally of allied) this.allies.add(ally);

    const asked = new Set(update.diplomacy.incoming.map((request) => request.from));
    for (const from of asked) {
      if (!this.requests.has(from)) add("request", false);
    }
    this.requests.clear();
    for (const from of asked) this.requests.add(from);

    for (const event of update.events) {
      if (event.type === "betrayed" && event.b === update.you) add("betrayal", false);
    }

    if (update.winner !== undefined && !this.over) {
      this.over = true;
      const won =
        update.winningTeam === undefined
          ? update.winner === update.you
          : update.diplomacy.teammates.includes(update.winner) || update.winner === update.you;
      add(won ? "victory" : "defeat", true);
    }
    this.started = true;
    return events;
  }
}
