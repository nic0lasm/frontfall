import type { LabelAnchor } from "../game/label-anchors.ts";
import type { GameUpdate } from "../game/game-view.ts";
import type { PlayerView } from "../game/solo-game.ts";
import type { Camera } from "../render/camera.ts";
import { h, setText } from "./dom.ts";
import { formatCount } from "./format.ts";

/**
 * Font sizes a name can take, in CSS pixels. Few steps, so neighbours of
 * about the same size get the same size rather than a pixel or two apart.
 */
const FONT_SIZES = [10, 12, 15, 19, 24, 30] as const;
/** Width of an average character of the label font, in ems. */
const CHAR_EM = 0.62;
/** Labels stay this far from the edges of the screen. */
const MARGIN = 4;
/** A name may run this much wider than the land around its tile before it shrinks. */
const OVERFLOW = 1.15;
/** Line height of name and troops together, in ems. */
const LINES_EM = 2.1;

/** Narrowest land, in CSS pixels, that carries a name at the smallest size. */
const MIN_ACROSS = FONT_SIZES[0] * LINES_EM;

/** Marks beside the troops of a player (setRelations). */
const MARK_LEADER = "\u265B";
const MARK_ALLY = "\u2713";
const MARK_TRAITOR = "\u26A0";
const MARK_EMBARGO = "\u2298";
const MARK_ASK = "\u2709";

/** A rectangle on the screen, in CSS pixels; a DOMRect is one. */
interface Box {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

interface Label {
  /** Built the first time the land is big enough to carry a name: city-states rarely are. */
  root?: HTMLElement;
  troops?: HTMLElement;
  name: string;
  /** The troops as text, kept here so that a label out of sight costs no DOM write. */
  count: string;
  /** The troops alone, as text. */
  raw: string;
  /** Marks of the player's standing, then a space; empty when there are none. */
  badges: string;
  /** What the styles of the element say now, to write only what changed. */
  transform: string;
  size: number;
  shown: boolean;
}

/**
 * Player names and troops drawn over their land, on its deepest tile, as
 * large as the land around that tile allows on screen. The simulation finds
 * the tiles (game/label-anchors.ts); this only places and sizes them.
 */
export class PlayerLabels {
  readonly element = h("div", { class: "labels", "aria-hidden": "true" });
  private readonly labels = new Map<number, Label>();
  private anchors: readonly LabelAnchor[] = [];
  private obstacles: readonly Box[] = [];

  update(players: readonly PlayerView[], anchors: readonly LabelAnchor[] | undefined): void {
    // Largest lands first: where two names would overlap, the smaller one gives way.
    if (anchors) this.anchors = [...anchors].sort((a, b) => b.depth - a.depth);
    for (const player of players) {
      let label = this.labels.get(player.id);
      if (!label) {
        label = {
          name: player.name,
          count: "",
          raw: "",
          badges: "",
          transform: "",
          size: 0,
          shown: false,
        };
        this.labels.set(player.id, label);
      }
      // A player hidden or shown again on this screen changes name (R-DIPLO-08).
      if (label.name !== player.name) {
        label.name = player.name;
        const name = label.root?.querySelector(".label-name");
        if (name) name.textContent = player.name;
      }
      label.raw = formatCount(player.troops);
      label.count = label.badges + label.raw;
      // Only city-states wait to be big enough: everyone else keeps an element, there are few.
      if (!player.cityState) this.build(label);
      if (label.troops) setText(label.troops, label.count);
    }
  }

  /**
   * Marks beside the troops of each player, from one update: the leader, an
   * ally, a traitor, an embargo and an alliance request. Texts are written
   * only for a player whose marks changed, on updates and not on frames.
   */
  setRelations(update: GameUpdate): void {
    const marks = new Map<number, string>();
    const add = (id: number, mark: string): void => {
      marks.set(id, (marks.get(id) ?? "") + mark);
    };
    if (update.phase === "play") {
      let top = 0;
      let leader = 0;
      for (const player of update.players) {
        if (!player.alive || player.cityState === true || player.tiles <= top) continue;
        top = player.tiles;
        leader = player.id;
      }
      if (leader !== 0) add(leader, MARK_LEADER);
    }
    const { diplomacy } = update;
    for (const ally of diplomacy.allies) add(ally.id, MARK_ALLY);
    for (const traitor of diplomacy.traitors) add(traitor.id, MARK_TRAITOR);
    for (const id of new Set([...diplomacy.embargoes, ...diplomacy.embargoedBy])) {
      add(id, MARK_EMBARGO);
    }
    for (const request of diplomacy.incoming) add(request.from, MARK_ASK);
    for (const id of diplomacy.outgoing) add(id, MARK_ASK);
    for (const [id, label] of this.labels) {
      const found = marks.get(id);
      const badges = found === undefined ? "" : `${found} `;
      if (badges === label.badges) continue;
      label.badges = badges;
      label.count = badges + label.raw;
      if (label.troops) setText(label.troops, label.count);
    }
  }

  private build(label: Label): HTMLElement {
    if (label.root) return label.root;
    const troops = h("span", { class: "label-troops" }, label.count);
    const root = h(
      "div",
      { class: "label" },
      h("span", { class: "label-name" }, label.name),
      troops,
    );
    root.hidden = true;
    this.element.append(root);
    label.root = root;
    label.troops = troops;
    return root;
  }

  /** Parts of the screen labels must leave clear, such as the panels of the HUD. */
  avoid(obstacles: readonly Box[]): void {
    this.obstacles = obstacles;
  }

  /** Moves the labels to follow the camera; call every frame. */
  place(camera: Camera, scale: number): void {
    const shown = new Set<number>();
    const { viewportWidth, viewportHeight } = camera;
    // Largest lands first: where two names would overlap, the smaller one gives way.
    const taken: Box[] = [...this.obstacles];
    for (const anchor of this.anchors) {
      const label = this.labels.get(anchor.player);
      if (!label) continue;
      // The size follows the depth of the land alone, so it does not jump with the name.
      const across = 2 * anchor.depth * scale;
      // Anchors come largest first: from here on no land carries even the smallest name.
      if (across < MIN_ACROSS) break;
      const room = across * OVERFLOW;
      // Widest line in ems: the name, or the troops below it at three quarters of its size.
      const length = Math.max(label.name.length, 0.75 * label.count.length) * CHAR_EM;
      const { x, y } = camera.tileToScreen(anchor.tile);
      // From the largest size that fits the land down: where a name would overlap
      // another or the HUD, it shrinks a step, and is hidden only at the smallest.
      let placed: { size: number; left: number; top: number } | undefined;
      for (let step = FONT_SIZES.length - 1; step >= 0 && !placed; step--) {
        const size = FONT_SIZES[step] as number;
        if (size * LINES_EM > across || size * length > room) continue;
        const halfWidth = (length * size) / 2;
        const halfHeight = (size * LINES_EM) / 2;
        if (x < -halfWidth || x > viewportWidth + halfWidth) break;
        if (y < -halfHeight || y > viewportHeight + halfHeight) break;
        // Half off the screen, a name slides in whole rather than being cut.
        const left = Math.min(viewportWidth - halfWidth - MARGIN, Math.max(halfWidth + MARGIN, x));
        const top = Math.min(
          viewportHeight - halfHeight - MARGIN,
          Math.max(halfHeight + MARGIN, y),
        );
        if (halfWidth * 2 + 2 * MARGIN > viewportWidth) continue;
        const box = {
          left: left - halfWidth,
          right: left + halfWidth,
          top: top - halfHeight,
          bottom: top + halfHeight,
        };
        if (taken.some((other) => overlaps(box, other))) continue;
        taken.push(box);
        placed = { size, left, top };
      }
      if (!placed) continue;
      const { size, left, top } = placed;
      const root = this.build(label);
      const transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px) translate(-50%, -50%)`;
      if (transform !== label.transform) {
        label.transform = transform;
        root.style.transform = transform;
      }
      if (size !== label.size) {
        label.size = size;
        root.style.fontSize = `${String(size)}px`;
      }
      shown.add(anchor.player);
    }
    for (const [id, label] of this.labels) {
      const show = shown.has(id);
      if (show === label.shown) continue;
      label.shown = show;
      if (label.root) label.root.hidden = !show;
    }
  }
}

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}
