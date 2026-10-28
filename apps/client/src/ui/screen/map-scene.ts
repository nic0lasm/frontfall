import { TileKind } from "@frontfall/engine";
import type { MapData, MapInfo } from "../../game/maps.ts";
import type { GameUpdate } from "../../game/solo-game.ts";
import type { MessageKey } from "../../i18n/index.ts";
import { colorOf } from "../../palette.ts";
import type { CameraView, ViewCamera } from "../../render/camera.ts";
import {
  createCamera,
  createMinimap,
  createRenderer,
  fitsGlobe,
  FRONT_SECONDS,
  globeLoaded,
  type Renderer,
  type StructureMark,
  type ViewKind,
} from "../../render/renderer.ts";
import type { Minimap } from "../../render/minimap.ts";
import { usage } from "../../usage.ts";
import { accessibility, motionReduced } from "../accessibility.ts";
import { safeStorage } from "../setup.ts";
import { sailing, shipMarks, shipTiles } from "./ship-motion.ts";

/** Matches the fade of the territory layer, with a frame to spare. */
const FADE_MS = 200;

/** Tiles taken light their front this long (territory layer), with a frame to spare. */
const FRONT_MS = FRONT_SECONDS * 1000 + 50;

/** Size of a tile on screen once the view closes in on the player's start. */
const START_TILE_PIXELS = 6;

/** What the map is drawn with, known once the game starts. */
export interface SceneStart {
  readonly map: MapData;
  readonly you: number;
  readonly maxPlayer: number;
  /** Lowest id of the nations, who take colours of their own. */
  readonly firstNation: number;
  /** Team of each player by id, in a team game. */
  readonly teams: readonly number[];
  readonly ticksPerSecond: number;
}

/**
 * The map of one game on screen: who owns each tile, the camera over it and
 * the renderer that draws it, flat or globe. It draws a frame only when
 * something changed, and keeps the renderer told of what the game shows:
 * ships, structures, fallout, allies and the land under the pointer.
 */
export class MapScene {
  /** Owner of every tile, read in place by the renderer. */
  private owners = new Uint16Array(0);
  private cam: ViewCamera;
  private view: Renderer | undefined;
  /** The overview in a corner, once the code it comes with has arrived. */
  private minimap: Minimap | undefined;
  /** Stops reporting the context of the current renderer as lost, ahead of freeing it. */
  private unwatchContext: (() => void) | undefined;
  private latest: GameUpdate | undefined;
  private previousShips = new Map<number, number>();
  private updatedAt = 0;
  /** Something to draw that the camera alone does not show. */
  private dirty = true;
  private drawnView: CameraView | undefined;
  private wrapsX = true;
  /** Tiles that changed hands fade in until then: frames are drawn until it passes. */
  private fadingUntil = 0;
  /**
   * When the last fronts go dark: one more frame is drawn then. While an
   * attack goes on, its ticks keep frames coming and the fronts move; once
   * it stops, they are not animated to the end, only cleared.
   */
  private frontsOffAt = 0;
  /** The structures last drawn, as a key that changes when any of them does. */
  private drawnStructures = "";
  /** The structures of the game, as last drawn. */
  private structureMarks: StructureMark[] = [];
  /** The structure the player is about to place, drawn faded among them. */
  private ghost: StructureMark | undefined;
  /** The allies last marked on the map. */
  private drawnAllies = "";
  /** The tile under the mouse or a resting finger, and the owner lit for it. */
  private hoveredTile: number | undefined;
  private hoveredOwner = 0;
  /** Flat map or globe; G switches when the globe was asked for and the map allows it. */
  private viewKind: ViewKind;
  readonly globeAllowed: boolean;
  private readonly mapSize: { readonly width: number; readonly height: number };
  /** What the renderer is made from, kept to make another one when the view switches. */
  private shown: SceneStart | undefined;

  constructor(
    /** The layer the canvas goes in. */
    private readonly surface: HTMLElement,
    map: MapInfo,
    /** The view to start with; "globe" also lets G switch views (a prototype, ADR 0005). */
    view: ViewKind,
    /** No renderer could be made; the key names the message to show. */
    private readonly onFailure: (key: MessageKey) => void,
  ) {
    this.globeAllowed = view === "globe" && fitsGlobe(map) && globeLoaded();
    this.viewKind = this.globeAllowed ? "globe" : "flat";
    this.mapSize = { width: map.width, height: map.height };
    this.cam = createCamera(map, this.viewKind);
  }

  /** The camera of the current view; another one after a switch. */
  get camera(): ViewCamera {
    return this.cam;
  }

  get kind(): ViewKind {
    return this.viewKind;
  }

  /** The minimap's element, for the screen to put in its HUD; none while its code is missing. */
  get minimapElement(): HTMLElement | undefined {
    return this.minimap?.element;
  }

  /** Who owns the tile, 0 for nobody. */
  ownerAt(tile: number): number {
    return this.owners[tile] ?? 0;
  }

  /** Whether the tile is land a player can own: not the sea, not impassable ground. */
  isLand(tile: number): boolean {
    const kind = this.shown?.map.kinds[tile];
    return kind !== undefined && kind !== TileKind.Water && kind !== TileKind.Impassable;
  }

  /** Disposes the renderer, whose context it frees on purpose, without reporting that as lost. */
  dispose(): void {
    this.unwatchContext?.();
    this.unwatchContext = undefined;
    this.minimap?.dispose();
    this.minimap = undefined;
    this.view?.dispose();
    this.view = undefined;
  }

  /** The tile under the pointer changed, or the pointer left the map. */
  hover(tile: number | undefined): void {
    this.hoveredTile = tile;
    this.lightHovered();
  }

  /** Lights the land of whoever owns the hovered tile, which changes as it is taken. */
  private lightHovered(): void {
    const owner = this.hoveredTile === undefined ? 0 : (this.owners[this.hoveredTile] ?? 0);
    if (owner === this.hoveredOwner) return;
    this.hoveredOwner = owner;
    this.view?.setHovered(owner);
    this.dirty = true;
  }

  show(start: SceneStart): void {
    this.owners = new Uint16Array(start.map.width * start.map.height);
    this.wrapsX = start.map.wrapsX;
    this.shown = start;
    const view = this.mount();
    if (view) this.addMinimap(start, view);
  }

  /** The minimap of a game: over the ground the renderer baked, in the players' colours. */
  private addMinimap(start: SceneStart, view: Renderer): void {
    const { map, you, maxPlayer, firstNation, teams } = start;
    this.minimap = createMinimap({
      source: {
        width: map.width,
        height: map.height,
        kinds: map.kinds,
        wrapsX: map.wrapsX,
        ground: view.ground?.(),
      },
      owners: this.owners,
      maxOwner: maxPlayer,
      you,
      camera: () => this.cam,
      onMove: (tile) => {
        this.cam.focus(tile);
      },
      storage: safeStorage(),
    });
    for (let id = 1; id <= maxPlayer; id++) {
      this.minimap?.setColor(id, colorOf(id, firstNation, teams));
    }
  }

  /** Makes the renderer of the current kind over the owners array, already filled or not. */
  private mount(): Renderer | undefined {
    if (!this.shown) return undefined;
    const { map, you, maxPlayer, firstNation, teams } = this.shown;
    let view: Renderer;
    try {
      view = createRenderer(
        {
          width: map.width,
          height: map.height,
          kinds: map.kinds,
          wrapsX: map.wrapsX,
          relief: map.relief,
          latitudes: map.latitudes,
          flat: accessibility().flatMap,
          owners: this.owners,
          maxOwner: maxPlayer,
        },
        this.viewKind,
      );
    } catch (error) {
      // Most likely the WebGL context, lost or refused after the check of the menu.
      console.error(error);
      usage().error("webgl");
      this.onFailure("webgl.missing");
      return undefined;
    }
    for (let id = 1; id <= maxPlayer; id++) {
      view.setPlayerColor(id, colorOf(id, firstNation, teams));
    }
    view.setHighlight(you);
    view.setHovered(this.hoveredOwner);
    view.setMotion(!motionReduced());
    this.drawnAllies = "";
    // Only a loss the browser inflicts is an error: disposing frees the context on purpose.
    const onLost = (): void => {
      usage().error("context_lost");
    };
    view.canvas.addEventListener("webglcontextlost", onLost);
    this.unwatchContext = () => {
      view.canvas.removeEventListener("webglcontextlost", onLost);
    };
    view.canvas.classList.add("map-canvas");
    this.surface.append(view.canvas);
    this.surface.removeAttribute("aria-busy");
    this.view = view;
    this.dirty = true;
    this.drawnView = undefined;
    this.resize();
    return view;
  }

  /**
   * Flat map to globe and back in a running game: a new camera over the same
   * tile and zoom, and a new renderer over the same owners array. The caller
   * wires its input to the new camera. Whether the view switched.
   */
  switchKind(): boolean {
    if (!this.globeAllowed) return false;
    const { centerX, centerY } = this.cam.view();
    const { width, height } = this.mapSize;
    const centre = Math.min(height - 1, Math.floor(centerY)) * width + Math.floor(centerX);
    const zoom = this.cam.zoom;
    this.viewKind = this.viewKind === "globe" ? "flat" : "globe";
    this.cam = createCamera({ width, height, wrapsX: this.wrapsX }, this.viewKind);
    this.cam.resize(window.innerWidth, window.innerHeight);
    this.cam.focus(centre, zoom);
    // The tile under the pointer is another one in the new view, known on its next move.
    this.hover(undefined);
    if (!this.view) return true;
    this.dispose();
    // The owners are already there to draw.
    this.mount()?.markAllChanged();
    this.drawnStructures = "";
    if (this.latest) this.placeStructures(this.latest);
    return true;
  }

  resize(): void {
    this.dirty = true;
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.view?.resize(width, height);
    this.cam.resize(width, height);
  }

  setMotion(moving: boolean): void {
    this.view?.setMotion(moving);
  }

  /** Takes in what a tick changed on the map. */
  update(update: GameUpdate): void {
    this.previousShips = shipTiles(this.latest);
    this.updatedAt = performance.now();
    if (update.owners) {
      this.owners.set(update.owners);
      this.minimap?.noteAll();
      this.view?.markAllChanged();
      this.dirty = true;
    } else if (update.changedTiles.length > 0) {
      const { changedTiles, changedOwners } = update;
      const now = performance.now();
      for (let i = 0; i < changedTiles.length; i++) {
        const tile = changedTiles[i] as number;
        const owner = changedOwners[i] as number;
        this.minimap?.noteChange(tile, this.owners[tile] as number, owner, now);
        this.owners[tile] = owner;
      }
      this.view?.markChanged(changedTiles);
      this.dirty = true;
      this.fadingUntil = performance.now() + FADE_MS;
      this.frontsOffAt = performance.now() + FRONT_MS;
    }
    for (const event of update.events) {
      if (event.type === "collapsed" && event.tile !== undefined)
        this.view?.collapsed?.(event.tile);
    }
    this.lightHovered();
    this.placeStructures(update);
    this.placeFallout(update);
    this.placeAllies(update);
    this.latest = update;
  }

  /** Centres the view on a tile, closing in when the map is shown whole. */
  centerOn(tile: number): void {
    this.cam.focus(tile, this.closeZoom());
  }

  /**
   * Closes in on the player's land, picked or placed by the game: on a large
   * map it is a few pixels wide at the zoom that shows it all.
   */
  focusOn(player: number): void {
    const start = this.owners.indexOf(player);
    if (start >= 0) this.cam.focus(start, this.closeZoom());
  }

  private closeZoom(): number {
    const zoom = (START_TILE_PIXELS * this.mapSize.height) / this.cam.viewportHeight;
    return Math.max(this.cam.zoom, zoom);
  }

  /**
   * Draws a frame only when something on the map changed: the GPU idles
   * while nothing moves, during a pause above all.
   */
  draw(now: number): void {
    this.minimap?.tick(now);
    const view = this.cam.view();
    const moved = !sameView(view, this.drawnView);
    const moving = sailing(this.latest);
    const fading = now < this.fadingUntil;
    const frontsOff = this.frontsOffAt > 0 && now >= this.frontsOffAt;
    if (frontsOff) this.frontsOffAt = 0;
    if (
      this.view &&
      (moved || this.dirty || moving || fading || frontsOff || this.view.animating?.())
    ) {
      this.placeShips(now);
      this.view.render(view);
      this.drawnView = view;
      // Ships still glide after their last tick: one more frame to settle them.
      this.dirty = moving;
    }
  }

  private placeShips(now: number): void {
    const view = this.view;
    const latest = this.latest;
    if (!view || !latest || !this.shown) return;
    const { firstNation, teams, ticksPerSecond } = this.shown;
    const progress = Math.min(1, (now - this.updatedAt) / (1000 / ticksPerSecond));
    view.setShips(
      shipMarks(
        latest,
        this.previousShips,
        progress,
        { width: this.mapSize.width, wrapsX: this.wrapsX },
        (player) => colorOf(player, firstNation, teams),
      ),
    );
  }

  /** Structures change rarely: they are drawn again only when one appears, finishes or changes hands. */
  private placeStructures(update: GameUpdate): void {
    const key = update.structures
      .map((s) => `${String(s.id)}:${String(s.player)}:${s.ready ? "1" : "0"}`)
      .join(",");
    if (!this.view || !this.shown || key === this.drawnStructures) return;
    this.drawnStructures = key;
    const { width } = this.mapSize;
    const { firstNation, teams } = this.shown;
    this.structureMarks = update.structures.map((structure) => ({
      x: structure.tile % width,
      y: Math.floor(structure.tile / width),
      type: structure.type,
      ready: structure.ready,
      color: colorOf(structure.player, firstNation, teams),
    }));
    this.drawStructures();
  }

  /** Draws the structures, and the one about to be placed, faded in the player's colour, among them. */
  private drawStructures(): void {
    if (!this.view) return;
    this.view.setStructures(
      this.ghost ? [...this.structureMarks, this.ghost] : this.structureMarks,
    );
    this.dirty = true;
  }

  /** Shows a structure of the player's on `tile`, faded as when it is being built, or none. */
  setGhost(tile: number | undefined, type?: StructureMark["type"]): void {
    const shown = this.shown;
    const { width } = this.mapSize;
    const next =
      tile === undefined || type === undefined || !shown
        ? undefined
        : {
            x: tile % width,
            y: Math.floor(tile / width),
            type,
            ready: false,
            color: colorOf(shown.you, shown.firstNation, shown.teams),
          };
    if (next?.x === this.ghost?.x && next?.y === this.ghost?.y && next?.type === this.ghost?.type) {
      return;
    }
    this.ghost = next;
    this.drawStructures();
  }

  private placeFallout(update: GameUpdate): void {
    if (!this.view) return;
    const { width } = this.mapSize;
    const changed = this.view.setFallout(
      update.fallout.map(({ tile, radius }) => ({
        x: tile % width,
        y: Math.floor(tile / width),
        radius,
      })),
    );
    this.dirty ||= changed;
  }

  private placeAllies(update: GameUpdate): void {
    const allies = [
      ...update.diplomacy.teammates,
      ...update.diplomacy.allies.map((ally) => ally.id),
    ];
    const key = allies.join(",");
    if (!this.view || key === this.drawnAllies) return;
    this.drawnAllies = key;
    this.view.setAllies(allies);
    this.dirty = true;
  }
}

function sameView(a: CameraView, b: CameraView | undefined): boolean {
  return (
    b !== undefined &&
    a.centerX === b.centerX &&
    a.centerY === b.centerY &&
    a.halfWidth === b.halfWidth &&
    a.halfHeight === b.halfHeight
  );
}
