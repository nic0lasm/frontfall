import type { GameUpdate } from "../../game/solo-game.ts";
// The guide loads when first shown, out of the first download.
import type { Guide } from "../guide.ts";
import { setGuideDone } from "../guide-state.ts";
import { safeStorage } from "../setup.ts";

/** The guide of a solo game, shown over the HUD while it lasts: the whole tutorial, or the first steps of a first game. */
export class GuideHost {
  private guide: Guide | undefined;
  /** The player's land when the attacks opened, for the guide. */
  private tilesAtPlay: number | undefined;
  /** Whether the player moved the slider of the share of troops, or of the workers, since the guide began. */
  private ratioMoved = false;
  private workMoved = false;
  /** Things done once, that the game then forgets: an attack on a city-state, a request for an alliance. */
  private cityStateAttacked = false;
  private asked = false;

  constructor(
    /** Where the guide goes: the HUD. */
    private readonly parent: HTMLElement,
    /** A finger rather than a mouse: the guide shows gestures instead of keys. */
    private readonly coarsePointer: MediaQueryList,
    /** The game as it stands, to start the guide at its step. */
    private readonly latest: () => GameUpdate | undefined,
    /** The player went through every step of the tutorial. */
    private readonly onFinish: () => void,
  ) {
    this.parent.querySelector("#attack-ratio")?.addEventListener("input", () => {
      this.ratioMoved = true;
    });
    this.parent.querySelector("#work-share")?.addEventListener("input", () => {
      this.workMoved = true;
    });
  }

  /** Shows the guide from its first step, over the one showing if any; `full` for the tutorial. */
  start(full: boolean): void {
    void import("../guide.ts").then(({ Guide, STEPS, FIRST_STEPS }) => {
      this.guide?.element.remove();
      this.ratioMoved = false;
      this.workMoved = false;
      this.cityStateAttacked = false;
      this.asked = false;
      this.guide = new Guide(
        this.coarsePointer.matches,
        () => {
          setGuideDone(safeStorage(), true);
        },
        full ? STEPS : FIRST_STEPS,
        this.onFinish,
      );
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
    const you = update.players.find((player) => player.id === update.you);
    const mine = (type: string): number =>
      update.structures.filter((s) => s.player === update.you && s.type === type).length;
    const cityStates = new Set(update.players.filter((p) => p.cityState).map((p) => p.id));
    if (update.attacks.some((attack) => cityStates.has(attack.target))) {
      this.cityStateAttacked = true;
    }
    const { diplomacy } = update;
    if (diplomacy.outgoing.length > 0 || diplomacy.allies.length > 0) this.asked = true;
    guide.update(
      {
        phase: update.phase,
        tiles,
        tilesAtPlay: this.tilesAtPlay ?? 0,
        cities: mine("city"),
        ports: mine("port"),
        forts: mine("fort"),
        doctrine: update.doctrines ? (you?.doctrine !== undefined ? "picked" : "open") : "none",
        ratioMoved: this.ratioMoved,
        workMoved: this.workMoved,
        cityStates: cityStates.size > 0,
        cityStateAttacked: this.cityStateAttacked,
        asked: this.asked,
        gold: you?.gold ?? 0,
      },
      { city: update.build.cityCost, port: update.build.portCost, fort: update.build.fortCost },
    );
  }

  refresh(): void {
    this.guide?.refresh();
  }
}
