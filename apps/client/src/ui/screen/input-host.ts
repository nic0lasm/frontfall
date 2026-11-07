import type { ClickOutcome } from "../../game/messages.ts";
import type { SessionCapabilities } from "../../game/session.ts";
import type { ClickMode, GameUpdate } from "../../game/game-runner.ts";
import { aimReach } from "../../input/aim.ts";
import { InputController } from "../../input/controller.ts";
import type { MapLandmarkData } from "../../maps.ts";
import type { ClickMarks } from "../click-marks.ts";
import type { Hud } from "../hud.ts";
import type { FeedHost } from "./feed-host.ts";
import type { MapScene } from "./map-scene.ts";
import type { Orders } from "./orders.ts";
import { falloutAt, landmarkNear, shipNear } from "./pointing.ts";
import type { PreviewHost } from "./preview-host.ts";

export interface InputHostOptions {
  /** The layer under the HUD that takes the pointer. */
  readonly surface: HTMLElement;
  readonly scene: MapScene;
  readonly can: SessionCapabilities;
  readonly orders: Orders;
  readonly previews: PreviewHost;
  readonly marks: ClickMarks;
  readonly hud: Pick<Hud, "hover" | "setMode">;
  readonly latest: () => GameUpdate | undefined;
  readonly landmarks: () => readonly MapLandmarkData[];
  /** The feed and the player card, once their code is here. */
  readonly feed: () => FeedHost | undefined;
  /** Opens the player menu of `player`, from a long press on `tile`. */
  readonly pick: (player: number, tile: number) => void;
}

/**
 * What the pointer does on the map: a click as an order in the mode picked
 * in the HUD, a long press as a card or the player menu, the hover as a
 * preview. The input is made once for the game and holds the scene's
 * camera, which stays the same across a switch of view.
 */
export class InputHost {
  private readonly input: InputController;
  private current: ClickMode = "attack";
  /** Shift was down when the last press began on the map. */
  private shiftDown = false;
  /** Mode of each click the worker has not answered yet, oldest first: it answers each one, in order. */
  private readonly inFlight: ClickMode[] = [];

  constructor(private readonly o: InputHostOptions) {
    this.input = this.create();
    // Capture phase: the press is read before the input controller turns it into a click.
    o.surface.addEventListener(
      "pointerdown",
      (event) => {
        this.shiftDown = event.shiftKey;
      },
      true,
    );
  }

  /** What a click on the map does. */
  get mode(): ClickMode {
    return this.current;
  }

  /** The mode of the oldest click the worker has not answered yet. */
  get answering(): ClickMode | undefined {
    return this.inFlight[0];
  }

  /** Picking the current mode again goes back to attacking. */
  setMode(mode: ClickMode): void {
    this.current = mode === this.current ? "attack" : mode;
    this.o.hud.setMode(this.current);
    this.o.surface.dataset.mode = this.current;
    this.o.previews.modeChanged(this.current);
  }

  /** Once a frame: the keys that move the camera. */
  update(ms: number): void {
    this.input.update(ms);
  }

  /**
   * Flat map to globe and back in a running game; whether it switched. The
   * input stays as it is: its camera passes to the new view's (MapScene).
   */
  switchView(): boolean {
    return this.o.scene.switchKind();
  }

  /** Makes a click at `tile`, as a press on the map would. */
  commit(tile: number, finger: boolean): void {
    // Shift-click attacks by boat, even from a shared border; only in attack mode.
    const mode = this.shiftDown && this.current === "attack" ? "boat" : this.current;
    if (!this.send(tile, mode, finger)) this.o.marks.unpress(performance.now());
  }

  /** The player menu's boat button: the attack lands at the tile it was opened on. */
  land(tile: number): void {
    this.send(tile, "boat", true);
  }

  /** One structure per pick of the button: once a build click goes through, clicks attack again. */
  answered(outcome: ClickOutcome): void {
    const sent = this.inFlight.shift();
    const built = outcome === "build" || outcome === "demolish" || outcome === "missile";
    if (built && sent !== undefined && sent === this.current) this.setMode("attack");
  }

  dispose(): void {
    this.input.dispose();
  }

  private send(tile: number, mode: ClickMode, finger: boolean): boolean {
    const { scene, orders, marks } = this.o;
    const reach = aimReach(scene.camera.scale, finger);
    if (!orders.click(tile, mode, reach, scene.ownerAt(tile))) return false;
    marks.clicked(tile, performance.now());
    // A build mode stays on until a structure goes up (answered): a click
    // made while the worker answers the one before is still a build click.
    this.inFlight.push(mode);
    return true;
  }

  private create(): InputController {
    const { surface, scene, marks, orders, previews, hud, can } = this.o;
    const ship = (tile: number) => shipNear(scene.camera, this.o.latest(), tile);
    const landmark = (tile: number) => landmarkNear(scene.camera, this.o.landmarks(), tile);
    const fallout = (tile: number) =>
      falloutAt(this.o.latest(), tile, (a, b, radius) => scene.within(a, b, radius));
    return new InputController(surface, scene.camera, {
      onTileClick: (tile, finger) => {
        // A finger's first tap in a build mode shows where it would go; the second places it.
        if (previews.tap(tile, finger)) marks.unpress(performance.now());
        else this.commit(tile, finger);
      },
      onPress: (tile) => {
        // Answered at once, before the game reads the click (ui/click-marks.ts).
        if (tile === undefined) marks.unpress(performance.now());
        else if (orders.clickable) marks.pressed(tile, performance.now());
      },
      onTileHold: (tile) => {
        // A long press on a landmark shows what it gives; elsewhere it opens the player menu.
        const feed = this.o.feed();
        const near = ship(tile);
        const mark = landmark(tile);
        const zone = fallout(tile);
        if (near && feed) {
          const at = scene.camera.tileToScreen(near.tile);
          feed.pinShip(near.ref, at.x, at.y);
        } else if (!mark && feed && zone !== undefined && scene.ownerAt(tile) === 0) {
          const at = scene.camera.tileToScreen(tile);
          feed.pinFallout(zone, at.x, at.y);
        } else if (mark && feed) {
          const at = scene.camera.tileToScreen(mark.tile);
          feed.pinLandmark(mark, at.x, at.y);
        } else if (can.canOrder) this.o.pick(scene.ownerAt(tile), tile);
      },
      onSecondary: () => {
        if (this.current === "attack" || !can.canOrder) return false;
        this.setMode("attack");
        return true;
      },
      onHover: (tile) => {
        scene.hover(tile);
        const feed = this.o.feed();
        // The attack preview is about land: the sea and impassable ground have none.
        const land = tile !== undefined && scene.isLand(tile);
        hud.hover(land ? scene.ownerAt(tile) : undefined);
        // The card is about land too, whoever holds it.
        feed?.over(land ? scene.ownerAt(tile) : 0);
        feed?.overShip(tile === undefined ? undefined : ship(tile)?.ref);
        feed?.overFallout(tile === undefined ? undefined : fallout(tile));
        feed?.overLandmark(tile === undefined ? undefined : landmark(tile));
        previews.hover(tile);
      },
    });
  }
}
