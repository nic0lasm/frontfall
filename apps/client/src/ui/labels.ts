import type { LabelAnchor } from "../game/label-anchors.ts";
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
      label.count = formatCount(player.troops);
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
