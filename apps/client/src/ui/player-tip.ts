import type { GameRules } from "../game/messages.ts";
import type { GameUpdate } from "../game/game-view.ts";
import type { MapLandmarkData } from "../game/maps.ts";
import { getLanguage, t, type MessageKey } from "../i18n/index.ts";
import { colorOf } from "../palette.ts";
import { h, swatch } from "./dom.ts";
import { formatCount, formatPercent } from "./format.ts";

type TipRules = Pick<GameRules, "ticksPerSecond" | "firstNation" | "teams" | "ownableTiles">;

/** What the player at this screen is to `id`, in words, with the embargoes that apply. */
export function relation(update: GameUpdate, id: number, rules: TipRules): string {
  if (id === update.you) return t("tip.you");
  const { diplomacy } = update;
  const ally = diplomacy.allies.find((a) => a.id === id);
  const parts: string[] = [];
  if (diplomacy.teammates.includes(id)) parts.push(t("tip.teammate"));
  else if (ally) {
    parts.push(t("tip.allyFor", { seconds: Math.ceil(ally.ticksLeft / rules.ticksPerSecond) }));
  } else if (diplomacy.atWar.includes(id)) parts.push(t("tip.atWar"));
  else if (id >= rules.firstNation) parts.push(t("tip.nation"));
  else parts.push(t("tip.notAllied"));
  const mood = diplomacy.moods.find((m) => m.id === id);
  if (mood) parts.push(t(`mood.${mood.mood}`));
  const traitor = diplomacy.traitors.find((x) => x.id === id);
  if (traitor) {
    parts.push(t("tip.traitor", { seconds: Math.ceil(traitor.ticksLeft / rules.ticksPerSecond) }));
  }
  if (diplomacy.embargoes.includes(id)) parts.push(t("tip.embargoing"));
  if (diplomacy.embargoedBy.includes(id)) parts.push(t("tip.embargoedBy"));
  return parts.join(" · ");
}

/** Troops out of their cap, gold, and the share of the map: one line. */
export function facts(update: GameUpdate, id: number, rules: TipRules): string {
  const player = update.players.find((p) => p.id === id);
  if (!player) return "";
  return t("tip.facts", {
    troops: formatCount(Math.floor(player.troops)),
    cap: formatCount(Math.floor(player.cap)),
    gold: formatCount(Math.floor(player.gold)),
    land: formatPercent(player.tiles / Math.max(1, rules.ownableTiles)),
  });
}

/** A ship under the pointer: which list it is in, and its id there. */
export interface ShipRef {
  kind: "transport" | "trade" | "warship";
  id: number;
}

/**
 * The card of a ship: whose it is, what it is, what it carries or how it
 * fares, and where it is bound, read from the latest update.
 */
export function shipLines(
  update: GameUpdate,
  ref: ShipRef,
  ownerAt: (tile: number) => number,
): { owner: number; kind: string; lines: string[] } | undefined {
  const nameOf = (id: number): string => update.players.find((p) => p.id === id)?.name ?? "";
  const bound = (to: number | undefined, key: MessageKey): string[] => {
    if (to === undefined) return [];
    const holder = ownerAt(to);
    if (holder === 0) return [t(`${key}Free` as MessageKey)];
    return [t(key, { name: holder === update.you ? t("tip.you") : nameOf(holder) })];
  };
  if (ref.kind === "transport") {
    const ship = update.boats.find((b) => b.id === ref.id);
    if (!ship) return undefined;
    return {
      owner: ship.player,
      kind: t("tip.ship.transport"),
      lines: [
        t("tip.ship.troops", { troops: formatCount(Math.floor(ship.troops)) }),
        ...bound(ship.to, "tip.ship.landsOn"),
      ],
    };
  }
  if (ref.kind === "trade") {
    const ship = update.tradeShips.find((s) => s.id === ref.id);
    if (!ship) return undefined;
    return {
      owner: ship.player,
      kind: t("tip.ship.trade"),
      lines: [t("tip.ship.cargo"), ...bound(ship.to, "tip.ship.sailsTo")],
    };
  }
  const ship = update.warships.find((s) => s.id === ref.id);
  if (!ship) return undefined;
  return {
    owner: ship.player,
    kind: t("tip.ship.warship"),
    lines: [
      t("tip.ship.health", {
        health: formatPercent(
          Math.max(0, ship.health) / Math.max(1, ship.maxHealth ?? ship.health),
        ),
      }),
    ],
  };
}

/** The card of a zone of fallout: what it does, how long it lasts, whose missile left it. */
export function falloutLines(
  update: GameUpdate,
  zone: GameUpdate["fallout"][number],
  firer: number | undefined,
  rules: Pick<TipRules, "ticksPerSecond">,
): string[] {
  const name = (id: number): string => update.players.find((p) => p.id === id)?.name ?? "";
  const factor = (zone.costPercent ?? 200) / 100;
  return [
    t("tip.fallout.cost", { factor: String(factor) }),
    t("tip.fallout.left", { seconds: Math.ceil(zone.ticksLeft / rules.ticksPerSecond) }),
    ...(firer === undefined
      ? []
      : [t("tip.fallout.by", { name: firer === update.you ? t("tip.you") : name(firer) })]),
  ];
}

/** How long a landmark's card stays after a long press, unless the finger touches again. */
const PINNED_MS = 6000;

/**
 * The card of a landmark (R-LAND-02): its name, what it gives in numbers,
 * who holds it, and what that means for the player at this screen.
 */
export function landmarkLines(
  update: GameUpdate,
  landmark: MapLandmarkData,
  holder: number,
): { effect: string; holder: string; hint: string } {
  const name = update.players.find((p) => p.id === holder)?.name ?? "";
  return {
    effect: t(`tip.landmark.${landmark.effect}` as MessageKey),
    holder:
      holder === 0
        ? t("tip.landmarkFree")
        : holder === update.you
          ? t("tip.landmarkYours")
          : t("tip.landmarkHeld", { name }),
    hint: t(holder === update.you ? "tip.landmarkKeep" : "tip.landmarkTake"),
  };
}

/**
 * The card of the player whose land the pointer rests on: name, how they
 * stand with you, who they are allied with, troops, gold and land. A mouse
 * convenience; on a touch screen the long press opens the player menu, and
 * the keyboard has the leaderboard, which shows the same things. Over a
 * landmark, the landmark's card takes its place; a long press on one shows
 * it to a finger too, and the help lists every landmark for the keyboard.
 */
export class PlayerTip {
  readonly element = h("div", {
    class: "panel player-tip",
    id: "player-tip",
    role: "tooltip",
    hidden: true,
  });
  private owner = 0;
  /** A mouse has moved over the map: until then the pointer position is unknown. */
  private mouse = false;
  private x = 0;
  private y = 0;
  private key = "";
  private rules: TipRules = {
    ticksPerSecond: 10,
    firstNation: Infinity,
    teams: [],
    ownableTiles: 1,
  };
  private last: GameUpdate | undefined;
  /** The landmark under the pointer, which the card is about instead of a player. */
  private landmark: MapLandmarkData | undefined;
  /** The ship under the pointer or pressed by a finger, which the card is about first of all. */
  private ship: ShipRef | undefined;
  /** Centre tile of the zone of fallout under the pointer, which the card is about when nothing else is. */
  private zone: number | undefined;
  /** Who fired the missile that left fallout around a tile, learned as missiles come down. */
  private readonly firers = new Map<number, number>();
  /** Shown by a long press: stays until it times out or the finger touches again. */
  private pinned: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly alliesOf: (id: number) => number[],
    private readonly ownerAt: (tile: number) => number = () => 0,
  ) {}

  setRules(rules: TipRules): void {
    this.rules = rules;
  }

  /** Follows the mouse over `surface`; a finger or a drag shows nothing. */
  track(surface: HTMLElement): () => void {
    const move = (event: PointerEvent): void => {
      if (event.pointerType !== "mouse") return;
      this.mouse = true;
      this.x = event.clientX;
      this.y = event.clientY;
      if (event.buttons !== 0) this.hide();
      else this.place();
    };
    const leave = (): void => {
      this.landmark = undefined;
      this.ship = undefined;
      this.zone = undefined;
      this.over(0);
    };
    const down = (): void => {
      if (this.pinned !== undefined) this.unpin();
    };
    surface.addEventListener("pointerdown", down);
    surface.addEventListener("pointermove", move);
    surface.addEventListener("pointerleave", leave);
    surface.addEventListener("wheel", leave, { passive: true });
    return () => {
      this.unpin();
      surface.removeEventListener("pointerdown", down);
      surface.removeEventListener("pointermove", move);
      surface.removeEventListener("pointerleave", leave);
      surface.removeEventListener("wheel", leave);
    };
  }

  /** The pointer is over the land of `owner`, 0 for none. */
  over(owner: number): void {
    this.owner = owner;
    this.render();
  }

  /** The pointer is over `landmark`, undefined for none: its card shows instead of the player's. */
  overLandmark(landmark: MapLandmarkData | undefined): void {
    if (landmark === this.landmark || this.pinned !== undefined) return;
    this.landmark = landmark;
    this.render();
  }

  /** The pointer is over `ship`, undefined for none: its card shows before anything else. */
  overShip(ship: ShipRef | undefined): void {
    if (this.pinned !== undefined) return;
    if (ship?.kind === this.ship?.kind && ship?.id === this.ship?.id) return;
    this.ship = ship;
    this.render();
  }

  /** The pointer is over the fallout around `zone`, undefined for none. */
  overFallout(zone: number | undefined): void {
    if (zone === this.zone || this.pinned !== undefined) return;
    this.zone = zone;
    this.render();
  }

  /** A long press on the fallout around `zone` at (x, y): its card shows by the finger for a while. */
  pinFallout(zone: number, x: number, y: number): void {
    this.unpin();
    this.zone = zone;
    this.x = x;
    this.y = y;
    this.pinned = setTimeout(() => {
      this.unpin();
    }, PINNED_MS);
    this.render();
  }

  /** A long press on `ship` at (x, y): its card shows by the finger for a while. */
  pinShip(ship: ShipRef, x: number, y: number): void {
    this.unpin();
    this.ship = ship;
    this.x = x;
    this.y = y;
    this.pinned = setTimeout(() => {
      this.unpin();
    }, PINNED_MS);
    this.render();
  }

  /** A long press on `landmark` at (x, y): its card shows by the finger for a while. */
  pin(landmark: MapLandmarkData, x: number, y: number): void {
    this.unpin();
    this.landmark = landmark;
    this.x = x;
    this.y = y;
    this.pinned = setTimeout(() => {
      this.unpin();
    }, PINNED_MS);
    this.render();
  }

  private unpin(): void {
    if (this.pinned === undefined) return;
    clearTimeout(this.pinned);
    this.pinned = undefined;
    this.landmark = undefined;
    this.ship = undefined;
    this.zone = undefined;
    this.render();
  }

  hide(): void {
    this.element.hidden = true;
    this.key = "";
  }

  update(update: GameUpdate): void {
    this.last = update;
    for (const event of update.missileEvents) {
      if (event.type === "struck") this.firers.set(event.to, event.player);
    }
    if (this.owner !== 0 || this.landmark || this.ship || this.zone !== undefined) this.render();
  }

  private render(): void {
    if (this.ship) {
      this.renderShip(this.ship);
      return;
    }
    if (this.landmark) {
      this.renderLandmark(this.landmark);
      return;
    }
    if (this.zone !== undefined) {
      this.renderFallout(this.zone);
      return;
    }
    const update = this.last;
    const id = this.owner;
    const player = update?.players.find((p) => p.id === id);
    if (!update || !player?.alive || id === 0 || !this.mouse) {
      this.hide();
      return;
    }
    const allies = this.alliesOf(id)
      .map((ally) => update.players.find((p) => p.id === ally))
      .filter((p) => p?.alive === true)
      .map((p) => p?.name ?? "");
    const lines = [
      relation(update, id, this.rules),
      facts(update, id, this.rules),
      ...(allies.length > 0 ? [t("tip.allies", { names: allies.join(", ") })] : []),
    ];
    const key = [id, player.name, ...lines].join("|");
    if (key !== this.key) {
      this.key = key;
      this.element.replaceChildren(
        h(
          "p",
          { class: "player-tip-name" },
          swatch(colorOf(id, this.rules.firstNation, this.rules.teams)),
          player.name,
        ),
        ...lines.map((line) => h("p", { class: "player-tip-line" }, line)),
      );
    }
    this.element.hidden = false;
    this.place();
  }

  private renderFallout(centre: number): void {
    const update = this.last;
    const zone = update?.fallout.find((f) => f.tile === centre);
    if (!update || !zone || (!this.mouse && this.pinned === undefined)) {
      this.hide();
      return;
    }
    const lines = falloutLines(update, zone, this.firers.get(centre), this.rules);
    const key = ["fallout", centre, zone.heavy, ...lines].join("|");
    if (key !== this.key) {
      this.key = key;
      this.element.replaceChildren(
        h("p", { class: "player-tip-kicker" }, t("tip.fallout")),
        h(
          "p",
          { class: "player-tip-name" },
          t(zone.heavy ? "tip.fallout.heavy" : "tip.fallout.light"),
        ),
        ...lines.map((line) => h("p", { class: "player-tip-line" }, line)),
      );
    }
    this.element.hidden = false;
    this.place();
  }

  private renderShip(ref: ShipRef): void {
    const update = this.last;
    const card = update && shipLines(update, ref, this.ownerAt);
    if (!update || !card || (!this.mouse && this.pinned === undefined)) {
      this.hide();
      return;
    }
    const owner = update.players.find((p) => p.id === card.owner);
    const key = ["ship", ref.kind, ref.id, owner?.name ?? "", card.kind, ...card.lines].join("|");
    if (key !== this.key) {
      this.key = key;
      this.element.replaceChildren(
        h("p", { class: "player-tip-kicker" }, card.kind),
        h(
          "p",
          { class: "player-tip-name" },
          swatch(colorOf(card.owner, this.rules.firstNation, this.rules.teams)),
          owner?.name ?? "",
        ),
        ...card.lines.map((line) => h("p", { class: "player-tip-line" }, line)),
      );
    }
    this.element.hidden = false;
    this.place();
  }

  private renderLandmark(landmark: MapLandmarkData): void {
    const update = this.last;
    if (!update || (!this.mouse && this.pinned === undefined)) {
      this.hide();
      return;
    }
    const holder = this.ownerAt(landmark.tile);
    const lines = landmarkLines(update, landmark, holder);
    const name = landmark.name[getLanguage()];
    const key = ["landmark", landmark.id, name, lines.effect, lines.holder, lines.hint].join("|");
    if (key !== this.key) {
      this.key = key;
      this.element.replaceChildren(
        h("p", { class: "player-tip-kicker" }, t("tip.landmark")),
        h("p", { class: "player-tip-name" }, name),
        h("p", { class: "player-tip-effect" }, lines.effect),
        h(
          "p",
          { class: "player-tip-line" },
          ...(holder === 0
            ? []
            : [swatch(colorOf(holder, this.rules.firstNation, this.rules.teams))]),
          lines.holder,
        ),
        h("p", { class: "player-tip-hint" }, lines.hint),
      );
    }
    this.element.hidden = false;
    this.place();
  }

  /** By the pointer, kept inside the window. */
  private place(): void {
    if (this.element.hidden) return;
    const width = this.element.offsetWidth;
    const height = this.element.offsetHeight;
    const left = Math.min(this.x + 16, Math.max(0, window.innerWidth - width - 8));
    const below = this.y + 20 + height > window.innerHeight;
    this.element.style.left = `${String(Math.round(left))}px`;
    this.element.style.top = `${String(Math.round(below ? this.y - height - 12 : this.y + 20))}px`;
  }
}
