import { youOf } from "../../game/selectors.ts";
import { safeStorage } from "../../storage.ts";
import type { GameUpdate } from "../../game/game-runner.ts";
// The guide loads when first shown, out of the first download.
import type { Guide, Step } from "../guide.ts";
import type { due as dueHint, Hints } from "../hints.ts";
import { hintsSeen, markHint, setGuideDone, turnHintsOff } from "../guide-state.ts";

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
  private attacked = false;
  /** The tips of the first times, loaded when a game reaches play. */
  private hints: { card: Hints; due: typeof dueHint } | undefined;
  private hintsLoading = false;

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
    // Shift + a digit sets the share of troops without an input event of the slider.
    document.addEventListener("keydown", this.onKey);
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.shiftKey && /^(Digit|Numpad)[0-9]$/.test(event.code)) this.ratioMoved = true;
  };

  /** The guide's host is done with: the shortcut is no longer watched. */
  dispose(): void {
    document.removeEventListener("keydown", this.onKey);
  }

  /** Shows the guide from its first step, over the one showing if any: a first game's steps, the tutorial's core, or one chapter's. */
  start(steps: "first" | "bases" | readonly Step[], onFinish: () => void = this.onFinish): void {
    void import("../guide.ts").then(({ Guide, BASES, FIRST_STEPS }) => {
      this.guide?.element.remove();
      this.ratioMoved = false;
      this.workMoved = false;
      this.cityStateAttacked = false;
      this.asked = false;
      this.attacked = false;
      this.guide = new Guide(
        this.coarsePointer.matches,
        () => {
          setGuideDone(safeStorage(), true);
        },
        steps === "first" ? FIRST_STEPS : steps === "bases" ? BASES : steps,
        onFinish,
      );
      this.parent.append(this.guide.element);
      const latest = this.latest();
      const human = latest ? youOf(latest) : undefined;
      if (latest) this.follow(latest, human?.tiles ?? 0);
    });
  }

  /** Shows a tip the first time something happens that a new player may not understand; the guide's card goes first. */
  hint(update: GameUpdate): void {
    if (update.phase !== "play") return;
    const storage = safeStorage();
    const seen = hintsSeen(storage);
    if (seen.includes("off")) return;
    if (!this.hints) {
      if (this.hintsLoading) return;
      this.hintsLoading = true;
      void import("../hints.ts").then(({ Hints, due }) => {
        const card = new Hints(
          (id) => {
            markHint(safeStorage(), id);
          },
          () => {
            turnHintsOff(safeStorage());
          },
        );
        this.parent.append(card.element);
        this.hints = { card, due };
      });
      return;
    }
    const { card, due } = this.hints;
    card.tick(update.tick);
    if (card.open || this.guide?.shown) return;
    const id = due(update, seen);
    if (id) card.show(id, update.tick);
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
    const you = youOf(update);
    // Eliminated: the steps ahead no longer apply, so the card goes.
    if (you && !you.alive && update.phase === "play") {
      guide.element.remove();
      this.guide = undefined;
      return;
    }
    const mine = (type: string): number =>
      update.structures.filter((s) => s.player === update.you && s.type === type).length;
    const cityStates = new Set(update.players.filter((p) => p.cityState).map((p) => p.id));
    if (update.attacks.some((attack) => cityStates.has(attack.target))) {
      this.cityStateAttacked = true;
    }
    if (update.attacks.some((attack) => attack.target !== 0)) this.attacked = true;
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
        attacked: this.attacked,
        asked: this.asked,
        gold: you?.gold ?? 0,
      },
      { city: update.build.cityCost, port: update.build.portCost, fort: update.build.fortCost },
    );
  }

  refresh(): void {
    this.guide?.refresh();
    this.hints?.card.refresh();
  }
}
