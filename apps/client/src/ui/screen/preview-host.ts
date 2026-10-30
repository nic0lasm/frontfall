import type { GameSession } from "../../game/session.ts";
import type { ClickMode, ClickPreview, GameUpdate } from "../../game/solo-game.ts";
import { aimReach } from "../../input/aim.ts";
import { t, type MessageKey } from "../../i18n/index.ts";
import type { ViewCamera } from "../../render/camera.ts";
import type { StructureMark } from "../../render/renderer.ts";
import { costOf } from "../build-modes.ts";
import type { BuildPreview } from "../build-preview.ts";

/** Storage key of the hint that points out the numbers; read with care, storage may throw. */
export const HINT_KEY = "frontfall.buildHint";
/** How often a preview asks again while it shows: gold comes in and land changes hands under it. */
const REFRESH_MS = 400;
/** Taps within this many pixels of the first one are the second tap of the same spot. */
const SAME_SPOT_PIXELS = 36;

/** The build modes that put a structure on the map, and so a faded one before it is placed. */
const STRUCTURE_MODES: Partial<Record<ClickMode, StructureMark["type"]>> = {
  city: "city",
  palace: "palace",
  fort: "fort",
  port: "port",
  silo: "silo",
  airDefense: "airDefense",
  mosque: "mosque",
};

export interface PreviewHostOptions {
  /** Takes the preview's layer, a tooltip level over the HUD's panels. */
  readonly mount: (layer: HTMLElement) => void;
  readonly session: Pick<GameSession, "peek">;
  readonly scene: {
    readonly camera: ViewCamera;
    setGhost(tile: number | undefined, type?: StructureMark["type"]): void;
  };
  readonly latest: () => GameUpdate | undefined;
  readonly mode: () => ClickMode;
  /** Says something to the player for a few seconds. */
  readonly say: (text: string) => void;
  readonly storage: Storage | undefined;
  /** Makes the click, as a press on the map would. */
  readonly commit: (tile: number, finger: boolean) => void;
}

/**
 * The preview of a build click: what the click would do, shown where the
 * pointer is before it is made. A mouse previews as it hovers; a finger taps
 * once to see it and again, on the same spot or on the card's button, to
 * place. Its code and styles come after the first visit, as the game starts.
 */
export class PreviewHost {
  private preview: BuildPreview | undefined;
  private module: typeof import("../build-preview.ts") | undefined;
  /** The tile the last question was about, with the mode it was asked in. */
  private asked: { tile: number; mode: ClickMode; finger: boolean } | undefined;
  private askedAt = 0;
  /** The tile under the mouse. */
  private hovered: number | undefined;
  /** The hint was said in this game. */
  private hinted = false;
  /** A finger's first tap, waiting for its second. */
  private tapped: { tile: number; x: number; y: number } | undefined;

  constructor(private readonly options: PreviewHostOptions) {
    void import("../build-preview.ts").then(
      (module) => {
        this.module = module;
        this.preview = new module.BuildPreview(() => {
          this.confirm();
        });
        options.mount(this.preview.element);
      },
      // Without it a click builds at once, as it always did.
      () => undefined,
    );
  }

  /** The build mode changed: the preview starts, follows the mouse, or goes away. */
  modeChanged(mode: ClickMode): void {
    this.clear();
    if (mode === "attack") return;
    this.hint();
    if (this.hovered !== undefined) this.ask(this.hovered, false);
  }

  /** The tile under the mouse changed, or the pointer left the map. */
  hover(tile: number | undefined): void {
    this.hovered = tile;
    // A finger's tap ends in a hover that leaves: the preview it showed stays.
    if (this.tapped) return;
    if (tile === undefined) this.clear();
    else if (this.options.mode() !== "attack") this.ask(tile, false);
  }

  /**
   * A press on the map in a build mode. A finger's first press only shows
   * the preview: the answer is whether the press was swallowed. A mouse
   * builds at once, as it points where it means to.
   */
  tap(tile: number, finger: boolean): boolean {
    if (!finger || !this.preview || this.options.mode() === "attack") return false;
    const camera = this.options.scene.camera;
    const at = camera.tileToScreen(tile);
    const first = this.tapped;
    if (first && Math.hypot(first.x - at.x, first.y - at.y) <= SAME_SPOT_PIXELS) {
      this.tapped = undefined;
      return false;
    }
    this.tapped = { tile, ...at };
    this.ask(tile, true);
    return true;
  }

  /** The answer to the last question. */
  answer(preview: ClickPreview): void {
    const { asked } = this;
    const view = this.preview;
    const module = this.module;
    if (!asked || !view || !module || asked.mode !== this.options.mode()) return;
    const text = module.previewText(preview, asked.finger);
    const build = this.options.latest()?.build;
    if (!text) {
      this.clear();
      return;
    }
    const cost = build ? costOf(asked.mode, build) : undefined;
    view.show({
      tile: preview.tile,
      text,
      name: t(`hud.${asked.mode}` as MessageKey),
      ...(cost === undefined ? {} : { cost }),
      touch: asked.finger,
    });
    const structure = STRUCTURE_MODES[asked.mode];
    this.options.scene.setGhost(text.ok ? preview.tile : undefined, structure);
  }

  /** Asks again now and then while the preview shows. */
  update(now: number): void {
    if (this.asked && this.preview?.shown && now - this.askedAt > REFRESH_MS) {
      this.ask(this.asked.tile, this.asked.finger);
    }
  }

  /** Follows the camera; once a frame. */
  place(): void {
    this.preview?.place(this.options.scene.camera);
  }

  private ask(tile: number, finger: boolean): void {
    const mode = this.options.mode();
    if (!this.preview || mode === "attack") return;
    this.asked = { tile, mode, finger };
    this.askedAt = performance.now();
    this.options.session.peek(tile, mode, aimReach(this.options.scene.camera.scale, finger));
  }

  /** The card's button: the second tap, wherever the first one was. */
  private confirm(): void {
    const first = this.tapped;
    this.tapped = undefined;
    if (first) this.options.commit(first.tile, true);
  }

  private clear(): void {
    this.tapped = undefined;
    this.asked = undefined;
    this.preview?.hide();
    this.options.scene.setGhost(undefined);
  }

  /** Points out the numbers, or the two taps, the first time a building is picked. */
  private hint(): void {
    if (this.hinted) return;
    this.hinted = true;
    const { storage } = this.options;
    try {
      if (storage?.getItem(HINT_KEY) === "seen") return;
      storage?.setItem(HINT_KEY, "seen");
    } catch {
      // Without storage the hint comes back each game.
    }
    const touch = matchMedia("(pointer: coarse)").matches;
    this.options.say(t(touch ? "preview.hintTouch" : "preview.hint"));
  }
}
