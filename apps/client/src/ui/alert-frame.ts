import type { GameUpdate } from "../game/game-view.ts";
import { h } from "./dom.ts";

/** Land lost between two updates that raises the alarm, as a share of the player's land. */
const ALERT_SHARE = 0.01;
const ALERT_TILES = 3;
/** How long the rim stays up, in milliseconds. */
const SHOW_MS = 1200;
/** Ticks before an enemy ship already announced raises the alarm again. */
const SHIP_QUIET_TICKS = 300;

/**
 * A red rim round the screen while the player loses land or an enemy ship
 * sails for their coast: the sound's alarm, for a player who cannot hear it.
 * It only reads updates, and the CSS fades it without any motion beyond an
 * opacity change (none at all with reduced motion).
 */
export class AlertFrame {
  readonly element = h("div", { class: "alert-frame", "aria-hidden": "true" });
  private tiles = -1;
  private readonly ships = new Map<number, number>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  observe(update: GameUpdate): void {
    const you = update.players.find((player) => player.id === update.you);
    const tiles = you?.tiles ?? 0;
    const before = this.tiles;
    this.tiles = tiles;
    if (update.phase !== "play" || update.replay || before < 0) return;
    let alarm = before - tiles >= Math.max(ALERT_TILES, before * ALERT_SHARE);
    for (const boat of update.boats) {
      if (boat.player === update.you || boat.target !== update.you) continue;
      const last = this.ships.get(boat.id);
      if (last === undefined || update.tick - last >= SHIP_QUIET_TICKS) {
        this.ships.set(boat.id, update.tick);
        alarm = true;
      }
    }
    if (alarm) this.flash();
  }

  private flash(): void {
    this.element.setAttribute("data-on", "");
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.element.removeAttribute("data-on");
    }, SHOW_MS);
  }

  dispose(): void {
    clearTimeout(this.timer);
  }
}
