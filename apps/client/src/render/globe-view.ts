import * as THREE from "three";
import { STRUCTURE_COLORS } from "../palette.ts";
import type { CameraView } from "./camera.ts";
import { flightPoint } from "./globe-flight.ts";
import { GlobeMarkers } from "./globe-markers.ts";
import { GLOBE_FOV, globePose, globeRays } from "./globe-projection.ts";
import { SHIP_SIZES, shipScale } from "./map-view.ts";
import type {
  FalloutZone,
  Renderer,
  RendererOptions,
  StructureMark,
  UnitMark,
} from "./renderer.ts";
import { TerritoryLayer } from "./territory-layer.ts";

/** Same limits as the flat map's (map-view.ts). */
const SHIP_CAPACITY = 128;
const TRADE_CAPACITY = 512;
/** Warships at once: B-WARSHIP-MAX for each of up to 64 players. */
const WARSHIP_CAPACITY = 256;
/** Flashes of shots at once: a muzzle and a target for each of 32 shots. */
const FLASH_CAPACITY = 64;
/** The pale rim of a warship and the hot colour of a shot. */
const HALO_COLOR = "#F4F8FC";
const SHOT_COLOR = "#FFD27A";
const STRUCTURE_CAPACITY = 1024;
const MISSILE_CAPACITY = 256;
/** Size of a structure's token on screen, in CSS pixels: never a speck far out, never a slab up close. */
const STRUCTURE_MIN_PIXELS = 14;
const STRUCTURE_MAX_PIXELS = 30;

/** Space around the planet: the brand's ink, darker than the deep sea. */
const SPACE = "#05090E";

interface StructureMarkers {
  readonly tokens: GlobeMarkers;
  readonly size: number;
}

/**
 * The map on a globe (ADR 0005, a prototype): the territory layer ray-traces
 * the planet on a quad over the screen, ships and structures lie on it, and
 * a perspective camera stands where globe-projection.ts puts it for the view,
 * the same place the globe camera picks tiles from.
 */
export class GlobeView implements Renderer {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(GLOBE_FOV, 1, 0.001, 100);
  private readonly bufferSize = new THREE.Vector2();
  private readonly territory: TerritoryLayer;
  private readonly ships: GlobeMarkers;
  private readonly tradeShips: GlobeMarkers;
  private readonly warships: GlobeMarkers;
  /** A pale triangle under each warship, so that it stands out from a trade ship of the same colour. */
  private readonly warshipHalos: GlobeMarkers;
  /** The flash of a shot, at the muzzle and on the target. */
  private readonly flashes: GlobeMarkers;
  private readonly missiles: GlobeMarkers;
  private readonly heavyMissiles: GlobeMarkers;
  private readonly structures: Record<StructureMark["type"], StructureMarkers>;
  private readonly startedAt = performance.now();
  private cssWidth = 1;
  private cssHeight = 1;

  constructor(readonly options: RendererOptions) {
    if (!options.wrapsX) throw new RangeError("the globe needs a map of the whole planet");
    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.watch();
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(SPACE);
    this.canvas = this.renderer.domElement;
    this.territory = new TerritoryLayer({
      width: options.width,
      height: options.height,
      owners: options.owners,
      terrain: options.kinds,
      wrapsX: true,
      relief: options.relief,
      groundSource: options.groundSource,
      latitudes: options.latitudes,
      flat: options.flat,
      maxOwner: options.maxOwner,
      surface: "sphere",
    });
    this.territory.mesh.renderOrder = 0;
    this.scene.add(this.territory.mesh);
    const markers = (
      size: number,
      sides: number,
      order: number,
      capacity = sides === 8 ? SHIP_CAPACITY : STRUCTURE_CAPACITY,
    ): GlobeMarkers => {
      const layer = new GlobeMarkers({
        worldWidth: options.width,
        worldHeight: options.height,
        capacity,
        size,
        sides,
        order,
      });
      this.scene.add(layer.mesh);
      return layer;
    };
    this.ships = markers(SHIP_SIZES.transport.tiles, 8, 1);
    this.tradeShips = markers(SHIP_SIZES.trade.tiles, 8, 1, TRADE_CAPACITY);
    this.warshipHalos = markers(SHIP_SIZES.warship.tiles * 1.45, 3, 1.2, WARSHIP_CAPACITY);
    this.warships = markers(SHIP_SIZES.warship.tiles, 3, 1.5, WARSHIP_CAPACITY);
    this.flashes = markers(SHIP_SIZES.warship.tiles, 8, 1.7, FLASH_CAPACITY);
    this.missiles = markers(SHIP_SIZES.missile.tiles, 4, 4, MISSILE_CAPACITY);
    this.heavyMissiles = markers(SHIP_SIZES.heavyMissile.tiles, 4, 4, MISSILE_CAPACITY);
    const tokens = (sides: number, size: number): StructureMarkers => {
      const layer = new GlobeMarkers({
        worldWidth: options.width,
        worldHeight: options.height,
        capacity: STRUCTURE_CAPACITY,
        size,
        sides,
        order: 3,
        token: true,
      });
      this.scene.add(layer.mesh);
      return { tokens: layer, size };
    };
    this.structures = {
      city: tokens(4, 4),
      palace: tokens(8, 5.5),
      mosque: tokens(10, 5.5),
      fort: tokens(3, 4.5),
      port: tokens(6, 4),
      silo: tokens(5, 4.5),
      airDefense: tokens(12, 4),
      capital: tokens(5, 6.5),
      landmark: tokens(3, 6),
    };
  }

  setPlayerColor(id: number, color: string): void {
    this.territory.setOwnerColor(id, color);
  }

  setHighlight(id: number): void {
    this.territory.setHighlight(id);
  }

  setHovered(id: number): void {
    this.territory.setHovered(id);
  }

  setMotion(moving: boolean): void {
    this.territory.setMotion(moving);
  }

  setAllies(ids: readonly number[]): void {
    this.territory.setAllies(ids);
  }

  markChanged(tiles: ArrayLike<number>): void {
    this.territory.markChanged(tiles, this.clock());
  }

  markAllChanged(): void {
    this.territory.markAllChanged();
  }

  setShips(ships: readonly UnitMark[]): void {
    let transports = 0;
    let trade = 0;
    let warships = 0;
    let flashes = 0;
    let missiles = 0;
    let heavy = 0;
    for (const ship of ships) {
      // A ship leaving the sea is not drawn as a plate: it is for the layer that draws hulls.
      if (ship.state) continue;
      if (ship.kind === "missile") {
        if (missiles < MISSILE_CAPACITY) this.placeMissile(this.missiles, missiles++, ship);
      } else if (ship.kind === "heavyMissile") {
        if (heavy < MISSILE_CAPACITY) this.placeMissile(this.heavyMissiles, heavy++, ship);
      } else if (ship.kind === "trade") {
        if (trade < TRADE_CAPACITY) this.tradeShips.set(trade++, ship.x, ship.y, ship.color);
      } else if (ship.kind === "warship") {
        if (warships < WARSHIP_CAPACITY) {
          this.warshipHalos.set(warships, ship.x, ship.y, HALO_COLOR);
          this.warships.set(warships++, ship.x, ship.y, ship.color);
        }
        if (ship.shot && flashes + 2 <= FLASH_CAPACITY) {
          this.flashes.set(flashes++, ship.x, ship.y, SHOT_COLOR);
          this.flashes.set(flashes++, ship.shot.x, ship.shot.y, SHOT_COLOR);
        }
      } else if (transports < SHIP_CAPACITY) {
        this.ships.set(transports++, ship.x, ship.y, ship.color);
      }
    }
    this.ships.count = transports;
    this.tradeShips.count = trade;
    this.warships.count = warships;
    this.warshipHalos.count = warships;
    this.flashes.count = flashes;
    this.missiles.count = missiles;
    this.heavyMissiles.count = heavy;
  }

  /** A missile on its great circle, lifted off the planet; one that does not say where it goes lies on its tile. */
  private placeMissile(layer: GlobeMarkers, index: number, ship: UnitMark): void {
    const { from, to, flown } = ship;
    if (from && to && flown !== undefined) {
      const { width, height } = this.options;
      layer.setPoint(index, flightPoint(from, to, flown, width, height), ship.color);
    } else {
      layer.set(index, ship.x, ship.y, ship.color);
    }
  }

  setFallout(zones: readonly FalloutZone[]): boolean {
    return this.territory.setFallout(zones);
  }

  setStructures(structures: readonly StructureMark[]): void {
    for (const type of [
      "city",
      "palace",
      "mosque",
      "fort",
      "port",
      "silo",
      "airDefense",
      "capital",
      "landmark",
    ] as const) {
      const { tokens } = this.structures[type];
      let count = 0;
      for (const structure of structures) {
        if (structure.type !== type || count >= STRUCTURE_CAPACITY) continue;
        tokens.set(count, structure.x, structure.y, structure.color ?? STRUCTURE_COLORS.fill);
        tokens.setGlyph(count, structure.ready ? 1 : 0.5);
        count++;
      }
      tokens.count = count;
    }
  }

  ground(): Uint8Array {
    return this.territory.groundTexture.image.data as Uint8Array;
  }

  setPixelRatio(ratio: number): void {
    // Three.js sizes the drawing buffer again for the same CSS size.
    this.renderer.setPixelRatio(ratio);
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.cssWidth = Math.max(1, width);
    this.cssHeight = Math.max(1, height);
  }

  render(view: CameraView): void {
    const { width, height } = this.options;
    const pose = globePose(view, width, height, this.cssWidth, this.cssHeight);
    this.camera.aspect = this.cssWidth / this.cssHeight;
    this.camera.position.set(...pose.position);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 0, 0);
    // Close to the ground the near plane must come closer too.
    this.camera.near = Math.max(1e-4, (pose.distance - 1) * 0.1);
    this.camera.far = pose.distance + 2;
    this.camera.updateProjectionMatrix();
    this.territory.setGlobePose(globeRays(pose));
    // The stars keep their size in device pixels.
    this.renderer.getDrawingBufferSize(this.bufferSize);
    this.territory.setViewport(this.bufferSize.x, this.bufferSize.y);
    this.territory.setTime(this.clock());
    this.territory.flush(this.renderer);
    // At the middle of the screen a row of tiles has the flat map's size.
    const tilesPerPixel = (2 * view.halfHeight) / this.cssHeight;
    this.ships.setScale(shipScale(SHIP_SIZES.transport, tilesPerPixel));
    this.tradeShips.setScale(shipScale(SHIP_SIZES.trade, tilesPerPixel));
    this.warships.setScale(shipScale(SHIP_SIZES.warship, tilesPerPixel));
    this.warshipHalos.setScale(shipScale(SHIP_SIZES.warship, tilesPerPixel));
    this.flashes.setScale(shipScale(SHIP_SIZES.warship, tilesPerPixel) * 0.7);
    this.missiles.setScale(shipScale(SHIP_SIZES.missile, tilesPerPixel));
    this.heavyMissiles.setScale(shipScale(SHIP_SIZES.heavyMissile, tilesPerPixel));
    for (const { tokens, size } of Object.values(this.structures)) {
      const pixels = Math.min(
        STRUCTURE_MAX_PIXELS,
        Math.max(STRUCTURE_MIN_PIXELS, size / tilesPerPixel),
      );
      tokens.setScale((pixels * tilesPerPixel) / size);
    }
    this.renderer.render(this.scene, this.camera);
    if (this.frames < 3) {
      this.frames++;
      this.inspect();
    }
  }

  private frames = 0;
  private broken: string | undefined;

  /** What went wrong with the context or the shaders, found after the first frames. */
  fault(): string | undefined {
    return this.broken;
  }

  private watch(): void {
    this.renderer.debug.onShaderError = (gl, _program, vertex, fragment) => {
      this.broken ??= `shader: ${gl.getShaderInfoLog(vertex) ?? ""} ${gl.getShaderInfoLog(fragment) ?? ""}`;
    };
  }

  private inspect(): void {
    if (this.broken) return;
    const gl = this.renderer.getContext();
    if (gl.isContextLost()) this.broken = "context lost";
    else {
      const code = gl.getError();
      if (code !== gl.NO_ERROR) this.broken = `gl error ${String(code)}`;
    }
  }

  private clock(): number {
    return (performance.now() - this.startedAt) / 1000;
  }

  dispose(): void {
    this.territory.dispose();
    this.ships.dispose();
    this.tradeShips.dispose();
    this.warships.dispose();
    this.warshipHalos.dispose();
    this.flashes.dispose();
    this.missiles.dispose();
    this.heavyMissiles.dispose();
    for (const { tokens } of Object.values(this.structures)) tokens.dispose();
    this.renderer.dispose();
    // Switching views creates another context; browsers cap how many stay alive.
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
