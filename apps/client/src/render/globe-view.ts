import * as THREE from "three";
import { STRUCTURE_COLORS } from "../palette.ts";
import type { CameraView } from "./camera.ts";
import { GlobeMarkers } from "./globe-markers.ts";
import { GLOBE_FOV, globePose, globeRays } from "./globe-projection.ts";
import { SHIP_SIZES, shipScale } from "./map-view.ts";
import type { Renderer, RendererOptions, StructureMark, UnitMark } from "./renderer.ts";
import { TerritoryLayer } from "./territory-layer.ts";

/** Same limits as the flat map's (map-view.ts). */
const SHIP_CAPACITY = 128;
const TRADE_CAPACITY = 512;
/** Warships at once: B-WARSHIP-MAX for each of up to 64 players. */
const WARSHIP_CAPACITY = 256;
const STRUCTURE_CAPACITY = 1024;
const MISSILE_CAPACITY = 256;
const STRUCTURE_MIN_PIXELS = 9;

/** Space around the planet: the brand's ink, darker than the deep sea. */
const SPACE = "#05090E";

interface StructureMarkers {
  readonly outline: GlobeMarkers;
  readonly fill: GlobeMarkers;
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
  private readonly territory: TerritoryLayer;
  private readonly ships: GlobeMarkers;
  private readonly tradeShips: GlobeMarkers;
  private readonly warships: GlobeMarkers;
  private readonly missiles: GlobeMarkers;
  private readonly heavyMissiles: GlobeMarkers;
  private readonly structures: Record<StructureMark["type"], StructureMarkers>;
  private readonly startedAt = performance.now();
  private cssWidth = 1;
  private cssHeight = 1;

  constructor(readonly options: RendererOptions) {
    if (!options.wrapsX) throw new RangeError("the globe needs a map of the whole planet");
    this.renderer = new THREE.WebGLRenderer({ antialias: false });
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
    this.warships = markers(SHIP_SIZES.warship.tiles, 3, 1, WARSHIP_CAPACITY);
    this.missiles = markers(SHIP_SIZES.missile.tiles, 4, 4, MISSILE_CAPACITY);
    this.heavyMissiles = markers(SHIP_SIZES.heavyMissile.tiles, 4, 4, MISSILE_CAPACITY);
    this.structures = {
      city: { outline: markers(5.5, 4, 2), fill: markers(4, 4, 3), size: 4 },
      palace: {
        outline: markers(7, 8, 2, STRUCTURE_CAPACITY),
        fill: markers(5.5, 8, 3, STRUCTURE_CAPACITY),
        size: 5.5,
      },
      fort: { outline: markers(6, 3, 2), fill: markers(4.5, 3, 3), size: 4.5 },
      port: { outline: markers(5.5, 6, 2), fill: markers(4, 6, 3), size: 4 },
      silo: { outline: markers(6, 5, 2), fill: markers(4.5, 5, 3), size: 4.5 },
      airDefense: { outline: markers(5.5, 12, 2), fill: markers(4, 12, 3), size: 4 },
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
    let missiles = 0;
    let heavy = 0;
    for (const ship of ships) {
      if (ship.kind === "missile") {
        if (missiles < MISSILE_CAPACITY) this.missiles.set(missiles++, ship.x, ship.y, ship.color);
      } else if (ship.kind === "heavyMissile") {
        if (heavy < MISSILE_CAPACITY) this.heavyMissiles.set(heavy++, ship.x, ship.y, ship.color);
      } else if (ship.kind === "trade") {
        if (trade < TRADE_CAPACITY) this.tradeShips.set(trade++, ship.x, ship.y, ship.color);
      } else if (ship.kind === "warship") {
        if (warships < WARSHIP_CAPACITY) this.warships.set(warships++, ship.x, ship.y, ship.color);
      } else if (transports < SHIP_CAPACITY) {
        this.ships.set(transports++, ship.x, ship.y, ship.color);
      }
    }
    this.ships.count = transports;
    this.tradeShips.count = trade;
    this.warships.count = warships;
    this.missiles.count = missiles;
    this.heavyMissiles.count = heavy;
  }

  setFallout(zones: readonly { x: number; y: number; radius: number }[]): boolean {
    return this.territory.setFallout(zones);
  }

  setStructures(structures: readonly StructureMark[]): void {
    for (const type of ["city", "palace", "fort", "port", "silo", "airDefense"] as const) {
      const { outline, fill } = this.structures[type];
      let count = 0;
      for (const structure of structures) {
        if (structure.type !== type || count >= STRUCTURE_CAPACITY) continue;
        outline.set(count, structure.x, structure.y, STRUCTURE_COLORS.outline);
        fill.set(
          count,
          structure.x,
          structure.y,
          structure.ready ? STRUCTURE_COLORS.fill : STRUCTURE_COLORS.building,
        );
        count++;
      }
      outline.count = count;
      fill.count = count;
    }
  }

  ground(): Uint8Array {
    return this.territory.groundTexture.image.data as Uint8Array;
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
    this.territory.setTime(this.clock());
    this.territory.flush();
    // At the middle of the screen a row of tiles has the flat map's size.
    const tilesPerPixel = (2 * view.halfHeight) / this.cssHeight;
    this.ships.setScale(shipScale(SHIP_SIZES.transport, tilesPerPixel));
    this.tradeShips.setScale(shipScale(SHIP_SIZES.trade, tilesPerPixel));
    this.warships.setScale(shipScale(SHIP_SIZES.warship, tilesPerPixel));
    this.missiles.setScale(shipScale(SHIP_SIZES.missile, tilesPerPixel));
    this.heavyMissiles.setScale(shipScale(SHIP_SIZES.heavyMissile, tilesPerPixel));
    for (const { outline, fill, size } of Object.values(this.structures)) {
      const scale = Math.max(1, (STRUCTURE_MIN_PIXELS * tilesPerPixel) / size);
      outline.setScale(scale);
      fill.setScale(scale);
    }
    this.renderer.render(this.scene, this.camera);
  }

  private clock(): number {
    return (performance.now() - this.startedAt) / 1000;
  }

  dispose(): void {
    this.territory.dispose();
    this.ships.dispose();
    this.tradeShips.dispose();
    this.warships.dispose();
    this.missiles.dispose();
    this.heavyMissiles.dispose();
    for (const { outline, fill } of Object.values(this.structures)) {
      outline.dispose();
      fill.dispose();
    }
    this.renderer.dispose();
    // Switching views creates another context; browsers cap how many stay alive.
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
