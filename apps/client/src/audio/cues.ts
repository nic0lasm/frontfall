import type { GameUpdate } from "../game/game-view.ts";

/** The moments of a game that make a sound. */
export type Cue = "attack" | "conquest" | "build" | "missile" | "alliance" | "victory" | "defeat";

/**
 * Reads the updates the screen already gets and says which cues they hold,
 * for the player at the screen only. Nothing here touches the game, so no
 * rule, replay or message depends on it.
 */
export class CueWatcher {
  private started = false;
  /** Attacks of the player's under way, by id, with the player's land when each was first seen. */
  private readonly attacks = new Map<number, number>();
  private readonly structures = new Set<number>();
  private readonly missiles = new Set<number>();
  private readonly allies = new Set<number>();
  private over = false;

  /** The first update only sets the baseline: a game joined half way makes no noise. */
  observe(update: GameUpdate): Cue[] {
    const cues: Cue[] = [];
    const you = update.players.find((player) => player.id === update.you);
    const tiles = you?.tiles ?? 0;
    const play = update.phase === "play";

    const attackIds = new Set(update.attacks.map((attack) => attack.id));
    for (const attack of update.attacks) {
      if (this.attacks.has(attack.id)) continue;
      this.attacks.set(attack.id, tiles);
      if (this.started && play) cues.push("attack");
    }
    for (const [id, before] of this.attacks) {
      if (attackIds.has(id)) continue;
      this.attacks.delete(id);
      if (this.started && tiles > before) cues.push("conquest");
    }

    for (const structure of update.structures) {
      if (
        structure.player !== update.you ||
        !structure.ready ||
        this.structures.has(structure.id)
      ) {
        continue;
      }
      this.structures.add(structure.id);
      if (this.started) cues.push("build");
    }

    for (const missile of update.missiles) {
      if (missile.player !== update.you || this.missiles.has(missile.id)) continue;
      this.missiles.add(missile.id);
      if (this.started) cues.push("missile");
    }

    const allied = new Set(update.diplomacy.allies.map((ally) => ally.id));
    for (const ally of allied) {
      if (!this.allies.has(ally) && this.started) cues.push("alliance");
    }
    this.allies.clear();
    for (const ally of allied) this.allies.add(ally);

    if (update.winner !== undefined && !this.over && this.started) {
      this.over = true;
      const won =
        update.winningTeam === undefined
          ? update.winner === update.you
          : update.diplomacy.teammates.includes(update.winner) || update.winner === update.you;
      cues.push(won ? "victory" : "defeat");
    }
    this.started = true;
    return cues;
  }
}
