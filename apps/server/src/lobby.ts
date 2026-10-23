import type { Intent, Turn } from "@frontfall/protocol";

/**
 * Collects the intents of one game and closes them into numbered turns. The
 * server never simulates the game: clients replay the same turns in order.
 */
export class Lobby {
  private readonly players = new Set<string>();
  private pending: Turn["intents"] = [];
  private tick = 0;
  private nextPlayer = 1;

  constructor(readonly seed: number) {}

  get playerCount(): number {
    return this.players.size;
  }

  join(): string {
    const id = `p${String(this.nextPlayer++)}`;
    this.players.add(id);
    return id;
  }

  leave(player: string): void {
    this.players.delete(player);
  }

  submit(player: string, intent: Intent): boolean {
    if (!this.players.has(player)) return false;
    this.pending.push({ player, intent });
    return true;
  }

  closeTurn(): Turn {
    const turn = { tick: this.tick++, intents: this.pending };
    this.pending = [];
    return turn;
  }
}
