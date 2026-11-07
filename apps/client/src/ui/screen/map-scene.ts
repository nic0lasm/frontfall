import { youOf } from "../../game/selectors.ts";
import { safeStorage } from "../../storage.ts";
import { TileKind } from "@frontfall/engine";
import type { MapData, MapInfo } from "../../maps.ts";
import type { GameUpdate } from "../../game/game-runner.ts";
import type { MessageKey } from "../../i18n/index.ts";
import { colorOf } from "../../palette.ts";
import type { CameraView, ViewCamera } from "../../render/camera.ts";
import {
  createCamera,
  createContext,
  createMinimap,
  createRenderer,
  fitsGlobe,
  FRONT_SECONDS,
  globeLoaded,
  type BakedGround,
  type MissileEnd,
  type RenderContext,
  type Renderer,
  type StructureMark,
  type ViewKind,
} from "../../render/renderer.ts";
import { SwitchCamera } from "../../render/switch-camera.ts";
import type { Minimap } from "../../render/minimap.ts";
import { RenderScale } from "../../render/render-scale.ts";
import {
  type GraphicsProfile,
  SAVER,
  chooseProfile,
  learnedSaver,
  isPhone,
  readDevice,
  rememberSaver,
} from "../graphics.ts";
import { usage } from "../../usage.ts";
import { accessibility, motionReduced } from "../accessibility.ts";
import { probe } from "../../probe.ts";
import { sailing, ShipMotion } from "./ship-motion.ts";

/** Between two frames drawn for slow motion alone: 30 a second. The frame clock jitters, hence the margin. */
const GENTLE_FRAME_MS = 1000 / 30 - 3;
/** Matches the fade of the territory layer, with a frame to spare. */
const FADE_MS = 130;

/** Tiles taken light their front this long (territory layer), with a frame to spare. */
const FRONT_MS = FRONT_SECONDS * 1000 + 50;

/** Size of a tile on screen once the view closes in on the player's start. */
const START_TILE_PIXELS = 6;

/** Plate of a landmark nobody holds yet (R-LAND-01). */
const LANDMARK_UNHELD = "#a8875a";

/**
 * The view a game starts with, and whether G may switch to the globe: only
 * a page opened with `?view=` turns the globe on (a prototype, ADR 0005).
 */
export interface SceneView {
  readonly globe: boolean;
  readonly kind: ViewKind;
}

/** The flat map, with no globe to switch to. */
export const FLAT_VIEW: SceneView = { globe: false, kind: "flat" };

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
 *
 * The game has one WebGL context, made with the first renderer. On the
 * globe path both renderers live on it once the browser had time to make
 * the second, and G swaps which one draws, and which camera the input's
 * camera passes to (M7-07): nothing is disposed or made again.
 */
export class MapScene {
  /** Owner of every tile, read in place by the renderer. */
  private owners = new Uint16Array(0);
  /** The camera the input and the interface hold; it passes every call to the view shown's. */
  private readonly cam: SwitchCamera;
  /** The camera of each view made so far. */
  private readonly cameras: Partial<Record<ViewKind, ViewCamera>> = {};
  /** The game's one WebGL context, made with the first renderer and kept until dispose. */
  private context: RenderContext | undefined;
  /** The renderer of each view made so far: the one not shown waits, ready, for G. */
  private readonly views: Partial<Record<ViewKind, Renderer>> = {};
  /** Stops waiting for the browser to be idle to make the other view. */
  private cancelPrepare: (() => void) | undefined;
  /** The view made ahead, to draw once under the next frame of the view shown. */
  private rehearsal: Renderer | undefined;
  /** How sharp the map is drawn, lowered when the GPU cannot keep up with the display. */
  private scale: RenderScale;
  /** What the map is drawn with, from the graphics setting and the device. */
  private profile: GraphicsProfile;
  /** The scale changed since the last frame, and the renderer has yet to follow. */
  private rescaled = false;
  /** The renderer shown. */
  private view: Renderer | undefined;
  /** The overview in a corner, once the code it comes with has arrived. */
  private minimap: Minimap | undefined;
  /** Stops reporting the context of the current renderer as lost, ahead of freeing it. */
  private unwatchContext: (() => void) | undefined;
  private latest: GameUpdate | undefined;
  private readonly motion = new ShipMotion();
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
  private drawnStructures: readonly number[] = [];
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
  private disposed = false;

  constructor(
    /** The layer the canvas goes in. */
    private readonly surface: HTMLElement,
    map: MapInfo,
    /** The view to start with, and whether G may switch to the globe. */
    view: SceneView,
    /** No renderer could be made; the key names the message to show. */
    private readonly onFailure: (key: MessageKey) => void,
  ) {
    this.globeAllowed = view.globe && fitsGlobe(map) && globeLoaded();
    this.viewKind = this.globeAllowed ? view.kind : "flat";
    this.mapSize = { width: map.width, height: map.height };
    const camera = createCamera(map, this.viewKind);
    this.cameras[this.viewKind] = camera;
    this.cam = new SwitchCamera(camera);
    this.profile = chooseProfile(
      accessibility().graphics,
      readDevice(),
      learnedSaver(safeStorage()),
    );
    this.scale = new RenderScale(window.devicePixelRatio, this.profile.maxPixelRatio);
  }

  /** What a report of the game's smoothness holds (ui/perf-report.ts). */
  report(): { profile: GraphicsProfile; ratio: number; frameMs: number; flat: boolean } {
    return {
      profile: this.profile,
      ratio: this.scale.ratio,
      frameMs: this.scale.frameMs,
      flat: this.flat,
    };
  }

  /** The flat map, asked for in the accessibility settings or by the graphics profile. */
  private get flat(): boolean {
    return accessibility().flatMap || this.profile.flat;
  }

  /**
   * Frames stayed too slow at the lowest sharpness: in auto mode, the device
   * is remembered as one that needs the light picture, and the map is drawn
   * with it from now on.
   */
  private lighten(): void {
    if (accessibility().graphics !== "auto" || this.profile.saver || !this.view) return;
    rememberSaver(safeStorage());
    this.profile = SAVER;
    this.scale = new RenderScale(window.devicePixelRatio, SAVER.maxPixelRatio);
    // Both views are made again with the light picture, on the same context and ground.
    const ground = this.view.bakedGround();
    this.disposeViews();
    this.present(ground);
    this.prepareOther();
  }

  /** The camera the input and the interface hold for the whole game, whatever the view. */
  get camera(): ViewCamera {
    return this.cam;
  }

  get kind(): ViewKind {
    return this.viewKind;
  }

  /** Where the minimap's home button goes: the screen knows the player's land. */
  home: (() => void) | undefined;

  /** The minimap's element, for the screen to put in its HUD; none while its code is missing. */
  get minimapElement(): HTMLElement | undefined {
    return this.minimap?.element;
  }

  /** Who owns the tile, 0 for nobody. */
  /** Whether `a` and `b` are within `radius` tiles in a straight line, across the seam of a wrapping map. */
  within(a: number, b: number, radius: number): boolean {
    const { width } = this.mapSize;
    let dx = Math.abs((a % width) - (b % width));
    if (this.wrapsX && dx > width / 2) dx = width - dx;
    const dy = Math.floor(a / width) - Math.floor(b / width);
    return dx * dx + dy * dy <= radius * radius;
  }

  ownerAt(tile: number): number {
    return this.owners[tile] ?? 0;
  }

  /** Whether the tile is land a player can own: not the sea, not impassable ground. */
  isLand(tile: number): boolean {
    const kind = this.shown?.map.kinds[tile];
    return kind !== undefined && kind !== TileKind.Water && kind !== TileKind.Impassable;
  }

  /** Disposes the renderers, then the context, which it frees on purpose, without reporting that as lost. */
  dispose(): void {
    this.disposed = true;
    this.cancelPrepare?.();
    this.unwatchContext?.();
    this.unwatchContext = undefined;
    this.minimap?.dispose();
    this.minimap = undefined;
    this.disposeViews();
    this.context?.dispose();
    this.context = undefined;
  }

  private disposeViews(): void {
    for (const view of Object.values(this.views)) view.dispose();
    delete this.views.flat;
    delete this.views.globe;
    this.view = undefined;
    delete this.surface.dataset.ready;
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
    const view = this.present();
    if (!view) return;
    this.addMinimap(start, view);
    this.prepareOther();
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
        ground: view.ground(),
      },
      owners: this.owners,
      maxOwner: maxPlayer,
      you,
      camera: () => this.cam,
      onMove: (tile) => {
        this.cam.focus(tile);
      },
      onHome: () => {
        this.home?.();
      },
      storage: safeStorage(),
    });
    for (let id = 1; id <= maxPlayer; id++) {
      this.minimap?.setColor(id, colorOf(id, firstNation, teams));
    }
  }

  /** The kind of view G switches to. */
  private get otherKind(): ViewKind {
    return this.viewKind === "globe" ? "flat" : "globe";
  }

  /** The game's context, made with its first renderer, its canvas put in the surface. */
  private open(): RenderContext {
    const context = createContext();
    // Only a loss the browser inflicts is an error: disposing frees the context on purpose.
    const onLost = (): void => {
      usage().error("context_lost");
    };
    context.canvas.addEventListener("webglcontextlost", onLost);
    this.unwatchContext = () => {
      context.canvas.removeEventListener("webglcontextlost", onLost);
    };
    context.canvas.classList.add("map-canvas");
    this.surface.append(context.canvas);
    this.surface.removeAttribute("aria-busy");
    return context;
  }

  /**
   * Makes the renderer of `kind` on the game's context, over the owners
   * array, with the ground another view baked when there is one. Failing
   * says so, unless `quiet`: the view made ahead of a switch fails alone.
   */
  private make(kind: ViewKind, ground?: BakedGround, quiet = false): Renderer | undefined {
    if (!this.shown) return undefined;
    const { map, you, maxPlayer, firstNation, teams } = this.shown;
    let view: Renderer;
    try {
      this.context ??= this.open();
      const other = this.views[kind === "globe" ? "flat" : "globe"];
      view = createRenderer(
        this.context,
        {
          width: map.width,
          height: map.height,
          kinds: map.kinds,
          wrapsX: map.wrapsX,
          relief: map.relief,
          latitudes: map.latitudes,
          groundSource: map.source && { id: map.id, sha256: map.source.sha256 },
          flat: this.flat,
          phone: isPhone(readDevice()),
          ground: ground ?? other?.bakedGround(),
          owners: this.owners,
          maxOwner: maxPlayer,
        },
        kind,
      );
    } catch (error) {
      // Most likely the WebGL context, lost or refused after the check of the menu.
      console.error(error);
      if (quiet) return undefined;
      usage().error("webgl");
      this.onFailure("webgl.missing");
      return undefined;
    }
    for (let id = 1; id <= maxPlayer; id++) {
      view.setPlayerColor(id, colorOf(id, firstNation, teams));
    }
    view.setHighlight(you);
    this.views[kind] = view;
    return view;
  }

  /**
   * Shows the renderer of the current kind, made now if it was not made
   * ahead, and tells it everything the game shows: it may have waited
   * through a part of the game while the other view was shown.
   */
  private present(ground?: BakedGround): Renderer | undefined {
    const view = this.views[this.viewKind] ?? this.make(this.viewKind, ground);
    if (!view) return undefined;
    this.view = view;
    view.setHovered(this.hoveredOwner);
    view.setMotion(!motionReduced());
    view.setPixelRatio(this.scale.ratio);
    // The tiles that changed hands meanwhile were marked on it too (update): only those are sent.
    this.drawnAllies = "";
    this.drawnStructures = [];
    if (this.latest) {
      this.placeStructures(this.latest);
      this.placeFallout(this.latest);
      this.placeAllies(this.latest);
    }
    this.surface.dataset.view = this.viewKind;
    this.dirty = true;
    this.drawnView = undefined;
    this.resize();
    return view;
  }

  /**
   * On the globe path, makes the other view once the browser is idle, its
   * shaders built and its textures sent, then draws it once under a frame
   * of the view shown (rehearse), so that G only swaps the two.
   */
  private prepareOther(): void {
    this.cancelPrepare?.();
    this.cancelPrepare = undefined;
    if (!this.globeAllowed) return;
    const prepare = (): void => {
      this.cancelPrepare = undefined;
      const kind = this.otherKind;
      if (this.disposed || this.views[kind] || !this.context) return;
      const view = this.make(kind, undefined, true);
      const { width, height } = this.mapSize;
      this.cameras[kind] ??= createCamera({ width, height, wrapsX: this.wrapsX }, kind);
      void view?.warm().then(() => {
        if (this.views[kind] !== view) return;
        this.rehearsal = view;
        this.dirty = true;
      });
    };
    if ("requestIdleCallback" in window) {
      const handle = window.requestIdleCallback(prepare, { timeout: 2_000 });
      this.cancelPrepare = () => {
        window.cancelIdleCallback(handle);
      };
    } else {
      const handle = setTimeout(prepare, 2_000);
      this.cancelPrepare = () => {
        clearTimeout(handle);
      };
    }
  }

  /**
   * Draws the view made ahead once, just before the view shown draws over
   * it in the same frame, so nothing of it reaches the screen: what a
   * renderer makes on its first frame (buffers, the first use of its
   * shaders) is made now rather than on the frame after G.
   */
  private rehearse(): void {
    const view = this.rehearsal;
    if (!view) return;
    this.rehearsal = undefined;
    const { kind } = view.capabilities;
    const camera = this.cameras[kind];
    if (!camera || this.views[kind] !== view || view === this.view) return;
    camera.resize(this.cam.viewportWidth, this.cam.viewportHeight);
    view.setPixelRatio(this.scale.ratio);
    view.resize(window.innerWidth, window.innerHeight);
    view.render(camera.view());
    // The view G shows next is ready: the end-to-end test of the switch waits for it.
    this.surface.dataset.ready = kind;
  }

  /**
   * Flat map to globe and back in a running game: the input's camera passes
   * to the other view's camera, over the same tile and zoom, and the other
   * renderer draws on the same context, over the same owners array. Whether
   * the view switched.
   */
  switchKind(): boolean {
    if (!this.globeAllowed) return false;
    const kind = this.otherKind;
    const { width, height } = this.mapSize;
    const camera = (this.cameras[kind] ??= createCamera(
      { width, height, wrapsX: this.wrapsX },
      kind,
    ));
    this.cam.swap(camera, width, height);
    this.viewKind = kind;
    // The tile under the pointer is another one in the new view, known on its next move.
    this.hover(undefined);
    if (this.view) this.present();
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
    this.updatedAt = performance.now();
    this.motion.tick(
      update,
      { width: this.mapSize.width, wrapsX: this.wrapsX },
      this.shown?.ticksPerSecond ?? 10,
      this.updatedAt,
    );
    // The last tile each player lost in this update: where an elimination is drawn.
    const lost = new Map<number, number>();
    if (update.owners) {
      this.owners.set(update.owners);
      this.minimap?.noteAll();
      for (const view of Object.values(this.views)) view.markAllChanged();
      this.dirty = true;
    } else if (update.changedTiles.length > 0) {
      const { changedTiles, changedOwners } = update;
      const now = performance.now();
      for (let i = 0; i < changedTiles.length; i++) {
        const tile = changedTiles[i] as number;
        const owner = changedOwners[i] as number;
        const before = this.owners[tile] as number;
        if (before !== owner && before !== 0) lost.set(before, tile);
        this.minimap?.noteChange(tile, before, owner, now);
        this.owners[tile] = owner;
      }
      // The view waiting for G is told too, so that showing it sends only what changed.
      for (const view of Object.values(this.views)) view.markChanged(changedTiles);
      this.dirty = true;
      this.fadingUntil = performance.now() + FADE_MS;
      this.frontsOffAt = performance.now() + FRONT_MS;
    }
    // Only a renderer that draws the combat effects is told of them.
    const effects = this.view?.capabilities.effects;
    if (effects) {
      for (const event of update.events) {
        if (event.type === "collapsed" && event.tile !== undefined) effects.collapsed(event.tile);
        // The capital that fell is the one its owner had on the previous update.
        if (event.type === "capital" || event.type === "razed") {
          const tile = this.latest?.players.find((p) => p.id === event.b)?.capital;
          if (tile !== undefined) effects.capitalFell(tile);
        }
        if (event.type === "eliminated" && this.shown) {
          const tile =
            lost.get(event.b) ?? this.latest?.players.find((p) => p.id === event.b)?.capital;
          const { firstNation, teams } = this.shown;
          if (tile !== undefined) effects.eliminated(tile, colorOf(event.b, firstNation, teams));
        }
      }
      const mine = youOf(update)?.capital;
      effects.capitalThreat(update.capitals?.threat ? mine : undefined);
    }
    this.lightHovered();
    this.placeStructures(update);
    this.placeFallout(update);
    this.placeMissileEnds(update);
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
    const moving = sailing(this.latest) || this.motion.busy(now);
    const fading = now < this.fadingUntil;
    const frontsOff = this.frontsOffAt > 0 && now >= this.frontsOffAt;
    if (frontsOff) this.frontsOffAt = 0;
    // A new size clears the canvas: it is set just ahead of a frame, never between two.
    if (this.rescaled) {
      this.rescaled = false;
      this.view?.setPixelRatio(this.scale.ratio);
      this.dirty = true;
    }
    const urgent = moved || this.dirty || frontsOff;
    // Between two ticks (a tenth of a second) only the cell fade, the ships' glide and the effects move,
    // and the map's shader runs once per pixel, which is the GPU's whole load: 30 frames a second are
    // enough for them. A new view, a change from the game or from the player draws at once.
    const gentle =
      moving || this.settling || fading || this.view?.capabilities.effects?.animating() === true;
    const wanted = urgent || (gentle && now - this.drawnAt >= GENTLE_FRAME_MS);
    const drawn = this.view !== undefined && wanted;
    if (this.view && drawn) {
      this.rehearse();
      let phase = probe.mark();
      this.placeShips(now);
      probe.since("ships place", phase);
      phase = probe.mark();
      this.view.render(view);
      probe.since("map render", phase);
      if (probe.on) {
        phase = probe.mark();
        this.context?.sync();
        probe.since("gpu wait", phase);
      }
      const fault = this.view.fault();
      if (fault) {
        console.error(`the map cannot be drawn: ${fault}`);
        usage().error("webgl");
        this.onFailure(isBrave() ? "webgl.brave" : "webgl.broken");
        return;
      }
      this.drawnView = view;
      this.drawnAt = now;
      // Ships still glide after their last tick: one more frame to settle them.
      this.dirty = false;
      this.settling = moving;
    }
    if (this.scale.frame(now, drawn)) this.rescaled = true;
    if (this.scale.takeFloored()) this.lighten();
  }

  /** When the map was last drawn, on the frame clock. */
  private drawnAt = 0;
  /** A frame is owed after the last one drawn with ships moving. */
  private settling = false;

  private placeShips(now: number): void {
    const view = this.view;
    const latest = this.latest;
    if (!view || !latest || !this.shown) return;
    const { firstNation, teams, ticksPerSecond } = this.shown;
    const progress = Math.min(1, (now - this.updatedAt) / (1000 / ticksPerSecond));
    view.setShips(
      this.motion.marks(progress, now, (player) => colorOf(player, firstNation, teams)),
    );
  }

  /**
   * Structures change rarely: they are drawn again only when one appears,
   * finishes or changes hands, or a capital falls or moves (R-CAP).
   */
  private placeStructures(update: GameUpdate): void {
    const capitals = update.players.filter((p) => p.alive && p.capital !== undefined);
    // Numbers rather than a string: compared ten times a second, rarely different.
    const key: number[] = [];
    for (const s of update.structures) key.push(s.id, s.player, s.ready ? 1 : 0);
    key.push(-1);
    for (const p of capitals) key.push(p.id, p.capital as number);
    key.push(-1);
    const landmarks = this.shown?.map.landmarks ?? [];
    for (const l of landmarks) key.push(this.ownerAt(l.tile));
    const drawn = this.drawnStructures;
    const same = key.length === drawn.length && key.every((value, i) => value === drawn[i]);
    if (!this.view || !this.shown || same) return;
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
    for (const player of capitals) {
      const tile = player.capital as number;
      this.structureMarks.push({
        x: tile % width,
        y: Math.floor(tile / width),
        type: "capital",
        ready: true,
        color: colorOf(player.id, firstNation, teams),
      });
    }
    // R-LAND-01: in its holder's colour, bronze while nobody holds it.
    for (const landmark of landmarks) {
      const holder = this.ownerAt(landmark.tile);
      this.structureMarks.push({
        x: landmark.tile % width,
        y: Math.floor(landmark.tile / width),
        type: "landmark",
        ready: true,
        color: holder === 0 ? LANDMARK_UNHELD : colorOf(holder, firstNation, teams),
      });
    }
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
    if (!this.view || !this.shown) return;
    const { width } = this.mapSize;
    const { ticksPerSecond } = this.shown;
    const changed = this.view.setFallout(
      update.fallout.map(({ tile, radius, heavy, ticksLeft, duration }) => ({
        x: tile % width,
        y: Math.floor(tile / width),
        radius,
        heavy,
        secondsLeft: ticksLeft / ticksPerSecond,
        seconds: duration / ticksPerSecond,
      })),
    );
    this.dirty ||= changed;
  }

  /** Missiles that were stopped in the air or came down since the last update: each starts its own effect. */
  private placeMissileEnds(update: GameUpdate): void {
    const effects = this.view?.capabilities.effects;
    if (!effects || !this.shown) return;
    const { width } = this.mapSize;
    const { firstNation, teams } = this.shown;
    const at = (tile: number) => ({ x: tile % width, y: Math.floor(tile / width) });
    for (const event of update.missileEvents) {
      if (event.type === "spared") continue;
      const end: MissileEnd = {
        ...at(event.tile),
        heavy: event.heavy,
        color: colorOf(event.player, firstNation, teams),
        from: at(event.from),
        to: at(event.to),
        ...(event.site === undefined ? {} : { site: at(event.site) }),
      };
      if (event.type === "struck") effects.missileStruck(end);
      else effects.missileIntercepted(end);
      this.dirty = true;
    }
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

/** Brave's fingerprinting shield is the usual reason a context exists but draws nothing. */
function isBrave(): boolean {
  return (navigator as { brave?: unknown }).brave !== undefined;
}
