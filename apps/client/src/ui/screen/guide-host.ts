import type { GameUpdate } from "../../game/solo-game.ts";
// The guide loads when first shown, out of the first download.
import type { Guide } from "../guide.ts";
import { setGuideDone } from "../guide-state.ts";
import { safeStorage } from "../setup.ts";

/** The first steps of a first solo game, shown over the HUD while they last. */
export class GuideHost {
  private guide: Guide | undefined;
  /** The player's land when the attacks opened, for the guide. */
  private tilesAtPlay: number | undefined;
  /** Whether the player moved the slider of the share of troops since the guide began. */
  private ratioMoved = false;

  constructor(
    /** Where the guide goes: the HUD. */
    private readonly parent: HTMLElement,
    /** A finger rather than a mouse: the guide shows gestures instead of keys. */
    private readonly coarsePointer: MediaQueryList,
    /** The game as it stands, to start the guide at its step. */
    private readonly latest: () => GameUpdate | undefined,
    /** Whether the player menu is open, a step of the guide. */
    private readonly playerMenu: () => boolean,
  ) {
    this.parent.querySelector("#attack-ratio")?.addEventListener("input", () => {
      this.ratioMoved = true;
    });
  }

  /** Shows the guide from its first step, over the one showing if any. */
  start(): void {
    void import("../guide.ts").then(({ Guide }) => {
      this.guide?.element.remove();
      this.ratioMoved = false;
      this.guide = new Guide(this.coarsePointer.matches, () => {
        setGuideDone(safeStorage(), true);
      });
      this.parent.append(this.guide.element);
      const latest = this.latest();
      const human = latest?.players.find((player) => player.id === latest.you);
      if (latest) this.follow(latest, human?.tiles ?? 0);
    });
  }

  /** Moves the guide on with the game; `tiles` is the player's land. */
  follow(update: GameUpdate, tiles: number): void {
    const guide = this.guide;
    if (!guide) return;
    if (!guide.shown) {
      this.guide = undefined;
      return;
    }
    if (update.phase === "play") this.tilesAtPlay ??= tiles;
    guide.update(
      {
        phase: update.phase,
        tiles,
        tilesAtPlay: this.tilesAtPlay ?? 0,
        cities: update.structures.filter((s) => s.player === update.you && s.type === "city")
          .length,
        forts: update.structures.filter((s) => s.player === update.you && s.type === "fort").length,
        ratioMoved: this.ratioMoved,
        playerMenu: this.playerMenu(),
      },
      { city: update.build.cityCost },
    );
  }

  refresh(): void {
    this.guide?.refresh();
  }
}
