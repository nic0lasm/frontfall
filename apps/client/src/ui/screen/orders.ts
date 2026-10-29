import { soldiersOf } from "../../game/attack-preview.ts";
import type { GameSession } from "../../game/session.ts";
import type { ClickMode, GameUpdate } from "../../game/solo-game.ts";
import type { GameTracker } from "../../usage.ts";

/** What decides whether the player can give orders now. */
export interface OrderState {
  readonly latest: () => GameUpdate | undefined;
  /** The game is paused, or a record is being watched. */
  readonly held: () => boolean;
  /** The attack ratio picked in the HUD, in percent. */
  readonly ratio: () => number;
  /** Reports the game; none for a replay. */
  readonly tracker: GameTracker | undefined;
}

/**
 * The orders the player gives from the screen: none while the game is
 * paused, watched from a record or won, and diplomacy only once play has
 * begun. Each method says nothing of what the game makes of the order.
 */
export class Orders {
  constructor(
    private readonly session: Pick<GameSession, "click" | "sendOrder">,
    private readonly state: OrderState,
  ) {}

  /** Whether a click on the map would go out now. */
  get clickable(): boolean {
    const update = this.state.latest();
    return update !== undefined && !this.state.held() && update.winner === undefined;
  }

  /** A click on the map, which the game reads by its mode; whether it went out. */
  click(tile: number, mode: ClickMode, reach: number): boolean {
    const update = this.state.latest();
    if (!update || !this.clickable) return false;
    this.ordered(update);
    this.session.click(tile, this.state.ratio(), mode, reach);
    return true;
  }

  /** Whether the order went out. */
  diplomatic(type: "ally" | "betray" | "embargo", target: number, on = true): boolean {
    const update = this.playing();
    if (!update) return false;
    this.ordered(update);
    this.session.sendOrder(
      type === "embargo" ? { type, target, on: on ? 1 : 0 } : { type, target },
    );
    return true;
  }

  /**
   * Sends a player the attack ratio's share of the soldiers or of the gold
   * (R-DIPLO-06); workers stay at home (R-ECO-07).
   */
  gift(target: number, what: "troops" | "gold"): void {
    const update = this.playing();
    if (!update) return;
    const you = update.players.find((p) => p.id === update.you);
    const held = you ? (what === "troops" ? soldiersOf(you) : you.gold) : 0;
    const amount = Math.floor((held * this.state.ratio()) / 100);
    if (amount < 1) return;
    this.ordered(update);
    this.session.sendOrder({
      type: "gift",
      target,
      troops: what === "troops" ? amount : 0,
      gold: what === "gold" ? amount : 0,
    });
  }

  /** Puts a share of the troops at home to work (R-ECO-07); allowed before play starts too. */
  work(share: number): void {
    const update = this.state.latest();
    if (!update || this.state.held() || update.winner !== undefined) return;
    this.session.sendOrder({ type: "work", share });
  }

  /** Sends a player a preset quick message (R-DIPLO-07). */
  quick(target: number, phrase: number): void {
    if (!this.playing()) return;
    this.session.sendOrder({ type: "quick", target, phrase });
  }

  retreat(attack: number): void {
    const update = this.state.latest();
    if (!update || this.state.held() || update.winner !== undefined) return;
    this.ordered(update);
    this.session.sendOrder({ type: "retreat", attack });
  }

  /** The game as it stands while play goes on and the player can act, or none. */
  private playing(): GameUpdate | undefined {
    const update = this.state.latest();
    if (!update || this.state.held() || update.phase !== "play" || update.winner !== undefined) {
      return undefined;
    }
    return update;
  }

  /** Notes the player's first order once play has begun, for the usage report. */
  private ordered(update: GameUpdate): void {
    if (update.phase === "play") this.state.tracker?.firstOrder(Date.now());
  }
}
