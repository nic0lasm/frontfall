import { youOf } from "../../game/selectors.ts";
import { soldiersOf } from "../../game/attack-preview.ts";
import type { GameSession } from "../../game/session.ts";
import type { ClickMode, GameUpdate } from "../../game/game-runner.ts";
import type { GameTracker } from "../../usage.ts";
import { canAct, type ActState } from "./policy.ts";

/** What decides whether the player can give orders now. */
export interface OrderState {
  /** The state the policy reads (canAct). */
  readonly act: () => ActState;
  /** The attack ratio picked in the HUD, in percent. */
  readonly ratio: () => number;
  /** Reports the game; none for a replay. */
  readonly tracker: GameTracker | undefined;
}

/**
 * The orders the player gives from the screen, each when canAct allows it:
 * diplomacy only once play has begun, a doctrine only in the spawn phase.
 * Each method says nothing of what the game makes of the order.
 */
export class Orders {
  constructor(
    private readonly session: Pick<GameSession, "click" | "sendOrder">,
    private readonly state: OrderState,
  ) {}

  /** Whether a click on the map would go out now. */
  get clickable(): boolean {
    return canAct(this.state.act());
  }

  /** A click on the map, which the game reads by its mode; whether it went out. */
  click(tile: number, mode: ClickMode, reach: number, seen?: number): boolean {
    const state = this.state.act();
    if (!canAct(state)) return false;
    this.ordered(state.latest);
    this.session.click(tile, this.state.ratio(), mode, reach, seen);
    return true;
  }

  /** Whether the order went out. */
  diplomatic(type: "ally" | "betray" | "embargo" | "tribute", target: number, on = true): boolean {
    const update = this.playing();
    if (!update) return false;
    this.ordered(update);
    if (type === "ally") this.state.tracker?.used("ally");
    if (type === "embargo" && on) this.state.tracker?.used("embargo");
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
    const you = youOf(update);
    const held = you ? (what === "troops" ? soldiersOf(you) : you.gold) : 0;
    const amount = Math.floor((held * this.state.ratio()) / 100);
    if (amount < 1) return;
    this.ordered(update);
    this.state.tracker?.used("gift");
    this.session.sendOrder({
      type: "gift",
      target,
      troops: what === "troops" ? amount : 0,
      gold: what === "gold" ? amount : 0,
    });
  }

  /** Puts a share of the troops at home to work (R-ECO-07); allowed before play starts too. */
  work(share: number): void {
    if (!canAct(this.state.act())) return;
    this.session.sendOrder({ type: "work", share });
  }

  /** Picks a doctrine (R-DOCTRINE-01); only the spawn phase takes it. */
  doctrine(pick: number): void {
    if (!canAct(this.state.act(), "spawn")) return;
    this.session.sendOrder({ type: "doctrine", pick });
  }

  /** Sends a player a preset quick message (R-DIPLO-07). */
  quick(target: number, phrase: number): void {
    if (!this.playing()) return;
    this.session.sendOrder({ type: "quick", target, phrase });
  }

  /**
   * Sends troops back at the land of a player who attacks, at most as many
   * as theirs and the attack ratio's share of the soldiers.
   */
  retaliate(tile: number, troops: number): void {
    const update = this.playing();
    if (!update) return;
    const you = youOf(update);
    if (!you) return;
    const send = Math.min(troops, Math.floor((soldiersOf(you) * this.state.ratio()) / 100));
    if (send < 1) return;
    this.ordered(update);
    this.session.sendOrder({ type: "attack", target: tile, troops: send });
  }

  retreat(attack: number): void {
    const state = this.state.act();
    if (!canAct(state)) return;
    this.ordered(state.latest);
    this.session.sendOrder({ type: "retreat", attack });
  }

  /** The game as it stands while play goes on and the player can act, or none. */
  private playing(): GameUpdate | undefined {
    const state = this.state.act();
    return canAct(state, "play") ? state.latest : undefined;
  }

  /** Notes the player's first order once play has begun, for the usage report. */
  private ordered(update: GameUpdate): void {
    if (update.phase === "play") this.state.tracker?.firstOrder(Date.now());
  }
}
