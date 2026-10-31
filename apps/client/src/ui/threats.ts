import type { BoatView, GameUpdate } from "../game/game-view.ts";
import { t } from "../i18n/index.ts";
import { h, setText } from "./dom.ts";
import { formatCount, formatDuration } from "./format.ts";

/** Where a click on a line sends the map: a tile, else the land of a player. */
export interface ThreatTarget {
  tile?: number;
  player?: number;
}

export interface ThreatActions {
  /** A line was picked: show where it happens. */
  onCentre(target: ThreatTarget): void;
  /** The Counter button of an attack: send troops back at the attacker. */
  onCounter(attacker: number, troops: number): void;
}

interface Row {
  row: HTMLElement;
  focus: HTMLButtonElement;
  counter: HTMLButtonElement | undefined;
}

/**
 * The attacks on the player and the ships under way, under the player's own
 * attacks (docs/client.md). Rows are kept from one update to the next, so a
 * button under the pointer stays put, and a row's text is written only when
 * it changes.
 */
export class ThreatList {
  readonly element = h("ul", { class: "attack-list threat-list" });
  private readonly rows = new Map<string, Row>();

  constructor(private readonly actions: ThreatActions) {}

  /** How many lines show. */
  get size(): number {
    return this.rows.size;
  }

  render(update: GameUpdate, ticksPerSecond: number): void {
    const names = new Map(update.players.map((player) => [player.id, player.name]));
    const name = (id: number): string =>
      id === 0 ? t("hud.unclaimed") : (names.get(id) ?? t("hud.unclaimed"));
    const seen = new Set<string>();
    for (const attack of update.incoming ?? []) {
      const key = `in:${String(attack.id)}`;
      seen.add(key);
      const row = this.row(key, "incoming", true);
      setText(
        row.focus,
        t("hud.incoming", { name: name(attack.attacker), troops: formatCount(attack.troops) }),
      );
      row.focus.onclick = () => {
        this.actions.onCentre({ player: attack.attacker });
      };
      if (row.counter) {
        row.counter.onclick = () => {
          this.actions.onCounter(attack.attacker, attack.troops);
        };
        row.counter.title = t("hud.counterHint", { name: name(attack.attacker) });
      }
    }
    for (const boat of update.boats) {
      const kind = boatKind(boat, update.you);
      if (kind === undefined) continue;
      const key = `boat:${String(boat.id)}`;
      seen.add(key);
      const row = this.row(key, kind, false);
      const time = formatDuration(Math.ceil((boat.ticksLeft ?? 0) / ticksPerSecond));
      const troops = formatCount(boat.troops);
      setText(
        row.focus,
        kind === "boatIn"
          ? t("hud.boatIn", { name: name(boat.player), troops, time })
          : t("hud.boatOut", { target: name(boat.target ?? 0), troops, time }),
      );
      row.focus.onclick = () => {
        this.actions.onCentre({ tile: boat.tile });
      };
    }
    for (const [key, row] of this.rows) {
      if (seen.has(key)) continue;
      row.row.remove();
      this.rows.delete(key);
    }
  }

  private row(key: string, kind: string, counter: boolean): Row {
    const found = this.rows.get(key);
    if (found) return found;
    const focus = h("button", { type: "button", class: "attack-text threat-focus" });
    const button = counter
      ? h("button", { type: "button", class: "attack-retreat" }, t("hud.counter"))
      : undefined;
    const row: Row = {
      row: h("li", { class: `attack threat threat-${kind}` }, focus, ...(button ? [button] : [])),
      focus,
      counter: button,
    };
    this.rows.set(key, row);
    this.element.append(row.row);
    return row;
  }
}

/** The player's ship at sea, or an enemy ship heading for the player's land. */
function boatKind(boat: BoatView, you: number): "boatOut" | "boatIn" | undefined {
  if (boat.player === you) return "boatOut";
  return boat.target === you ? "boatIn" : undefined;
}
