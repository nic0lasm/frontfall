import * as THREE from "three";
import { MAP_COLORS, STRUCTURE_COLORS } from "../palette.ts";
import type { CameraView } from "./camera.ts";
import type { EffectsLayer } from "./effects-layer.ts";
import { applyView } from "./orthographic.ts";
import type { Renderer, RendererOptions, StructureMark, UnitMark } from "./renderer.ts";
import { TerritoryLayer } from "./territory-layer.ts";
import { UnitLayer } from "./unit-layer.ts";

/** Ships at sea at once: B-BOAT-MAX for each of up to 26 players, with room to spare. */
const SHIP_CAPACITY = 128;

/** Trade ships at sea at once: B-TRADE-MAX for each port of a crowded map. */
const TRADE_CAPACITY = 512;
/** Warships at once: B-WARSHIP-MAX for each of up to 64 players. */
const WARSHIP_CAPACITY = 256;

/**
 * Size of each kind of ship in tiles, and its smallest size on screen in CSS
 * pixels: zoomed out, a trade ship stays a readable dot rather than vanishing.
 */
export const SHIP_SIZES = {
  transport: { tiles: 2.5, minPixels: 6 },
  trade: { tiles: 1.6, minPixels: 6 },
  warship: { tiles: 3.5, minPixels: 10 },
  missile: { tiles: 2.5, minPixels: 9 },
  heavyMissile: { tiles: 4, minPixels: 13 },
} as const;

/** Scale of a ship of `size` for its smallest size on screen at `tilesPerPixel`. */
export function shipScale(
  size: { tiles: number; minPixels: number },
  tilesPerPixel: number,
): number {
  return Math.max(1, (size.minPixels * tilesPerPixel) / size.tiles);
}

/** Missiles in flight at once: one per silo, with room to spare. */
const MISSILE_CAPACITY = 256;

/** Smallest size of a structure on screen, in CSS pixels, however far the view is zoomed out. */
const STRUCTURE_MIN_PIXELS = 9;

/** Structures drawn at once; each player's land rarely holds more than a few. */
const STRUCTURE_CAPACITY = 1024;

/** One kind of structure: a dark shape with a lighter one on top. */
interface StructureLayers {
  readonly outline: UnitLayer;
  readonly fill: UnitLayer;
  /** Footprint of the fill in tiles. */
  readonly size: number;
}

/**
 * The flat map: one WebGL canvas, the territory layer, and an orthographic
 * camera placed from the view of the interface's camera.
 */
export class MapView implements Renderer {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera();
  private readonly territory: TerritoryLayer;
  private readonly ships: UnitLayer;
  private readonly tradeShips: UnitLayer;
  private readonly warships: UnitLayer;
  private readonly missiles: UnitLayer;
  private readonly heavyMissiles: UnitLayer;
  private readonly structures: Record<StructureMark["type"], StructureLayers>;
  private readonly startedAt = performance.now();
  /** Combat effects, once their code has arrived; they are not in the first bundle. */
  private effects: EffectsLayer | undefined;
  private moving = true;
  private disposed = false;
  /** Width of the canvas in CSS pixels, to keep structures readable when zoomed out. */
  private cssWidth = 1;

  constructor(readonly options: RendererOptions) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(MAP_COLORS.oceanDeep);
    this.canvas = this.renderer.domElement;
    this.territory = new TerritoryLayer({
      width: options.width,
      height: options.height,
      owners: options.owners,
      terrain: options.kinds,
      wrapsX: options.wrapsX,
      relief: options.relief,
      maxOwner: options.maxOwner,
    });
    // The layer spans x in [-width, 2 * width) and y in [0, height) from the
    // south edge; applyView puts the origin at the centre of the middle copy.
    this.territory.mesh.position.set(-options.width / 2, -options.height / 2, 0);
    this.scene.add(this.territory.mesh);
    this.ships = new UnitLayer({
      worldWidth: options.width,
      worldHeight: options.height,
      capacity: SHIP_CAPACITY,
      wrapsX: options.wrapsX,
      size: SHIP_SIZES.transport.tiles,
    });
    this.ships.mesh.position.copy(this.territory.mesh.position);
    this.scene.add(this.ships.mesh);
    this.tradeShips = new UnitLayer({
      worldWidth: options.width,
      worldHeight: options.height,
      capacity: TRADE_CAPACITY,
      wrapsX: options.wrapsX,
      size: SHIP_SIZES.trade.tiles,
    });
    this.tradeShips.mesh.position.copy(this.territory.mesh.position);
    this.scene.add(this.tradeShips.mesh);
    this.warships = new UnitLayer({
      worldWidth: options.width,
      worldHeight: options.height,
      capacity: WARSHIP_CAPACITY,
      wrapsX: options.wrapsX,
      size: SHIP_SIZES.warship.tiles,
      sides: 3,
      depth: 0.15,
    });
    this.warships.mesh.position.copy(this.territory.mesh.position);
    this.scene.add(this.warships.mesh);
    // Missiles are diamonds above everything else.
    const missiles = (size: number): UnitLayer => {
      const layer = new UnitLayer({
        worldWidth: options.width,
        worldHeight: options.height,
        capacity: MISSILE_CAPACITY,
        wrapsX: options.wrapsX,
        size,
        sides: 4,
        depth: 0.4,
      });
      layer.mesh.position.copy(this.territory.mesh.position);
      this.scene.add(layer.mesh);
      return layer;
    };
    this.missiles = missiles(SHIP_SIZES.missile.tiles);
    this.heavyMissiles = missiles(SHIP_SIZES.heavyMissile.tiles);
    // Cities are diamonds, forts triangles, ports hexagons, silos pentagons and
    // air defenses discs, all larger than a ship.
    const layers = (sides: number, size: number): StructureLayers => {
      const layer = (extra: number, depth: number): UnitLayer => {
        const unit = new UnitLayer({
          worldWidth: options.width,
          worldHeight: options.height,
          capacity: STRUCTURE_CAPACITY,
          wrapsX: options.wrapsX,
          size: size + extra,
          sides,
          depth,
        });
        unit.mesh.position.copy(this.territory.mesh.position);
        this.scene.add(unit.mesh);
        return unit;
      };
      return { outline: layer(1.5, 0.2), fill: layer(0, 0.3), size };
    };
    this.structures = {
      city: layers(4, 4),
      palace: layers(8, 5.5),
      fort: layers(3, 4.5),
      port: layers(6, 4),
      silo: layers(5, 4.5),
      airDefense: layers(12, 4),
    };
    this.camera.position.z = 10;
    this.loadEffects();
  }

  private loadEffects(): void {
    void import("./effects-layer.ts").then(
      ({ EffectsLayer }) => {
        if (this.disposed) return;
        this.effects = new EffectsLayer({
          three: [
            THREE.Mesh,
            THREE.ShaderMaterial,
            THREE.InstancedBufferGeometry,
            THREE.InstancedBufferAttribute,
            THREE.BufferAttribute,
          ],
          map: this.options,
          scene: this.scene,
          anchor: this.territory.mesh.position,
          moving: this.moving,
        });
      },
      // The map is as playable without them.
      () => undefined,
    );
  }

  setPlayerColor(id: number, color: string): void {
    this.territory.setOwnerColor(id, color);
  }

  /** The player whose land gets the wide rim. */
  setAllies(ids: readonly number[]): void {
    this.territory.setAllies(ids);
  }

  setHighlight(id: number): void {
    this.territory.setHighlight(id);
  }

  setHovered(id: number): void {
    this.territory.setHovered(id);
  }

  setMotion(moving: boolean): void {
    this.moving = moving;
    this.effects?.setMotion(moving);
    this.territory.setMotion(moving);
  }

  /** Tiles whose owner changed in the shared array since the last frame; they fade in. */
  markChanged(tiles: ArrayLike<number>): void {
    this.territory.markChanged(tiles, this.clock());
    this.effects?.changed(tiles, this.clock());
  }

  markAllChanged(): void {
    this.territory.markAllChanged();
  }

  /** Ships at sea, replacing the previous ones. */
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
    this.effects?.ships(ships, this.clock());
  }

  animating(): boolean {
    return this.effects?.alive(this.clock()) ?? false;
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

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.cssWidth = Math.max(1, width);
  }

  render(view: CameraView): void {
    applyView(this.camera, view, this.options.width, this.options.height);
    this.territory.setTime(this.clock());
    this.territory.flush();
    const tilesPerPixel = (2 * view.halfWidth) / this.cssWidth;
    this.ships.setScale(shipScale(SHIP_SIZES.transport, tilesPerPixel));
    this.tradeShips.setScale(shipScale(SHIP_SIZES.trade, tilesPerPixel));
    this.warships.setScale(shipScale(SHIP_SIZES.warship, tilesPerPixel));
    this.missiles.setScale(shipScale(SHIP_SIZES.missile, tilesPerPixel));
    this.heavyMissiles.setScale(shipScale(SHIP_SIZES.heavyMissile, tilesPerPixel));
    this.missiles.update(this.camera.position.x);
    this.heavyMissiles.update(this.camera.position.x);
    this.ships.update(this.camera.position.x);
    this.tradeShips.update(this.camera.position.x);
    this.warships.update(this.camera.position.x);
    for (const { outline, fill, size } of Object.values(this.structures)) {
      const scale = Math.max(1, (STRUCTURE_MIN_PIXELS * tilesPerPixel) / size);
      outline.setScale(scale);
      fill.setScale(scale);
      outline.update(this.camera.position.x);
      fill.update(this.camera.position.x);
    }
    this.effects?.update(this.clock(), this.camera.position.x, view, tilesPerPixel);
    this.renderer.render(this.scene, this.camera);
  }

  /** Seconds since the view was made: small enough for exact 32-bit floats in the shader. */
  private clock(): number {
    return (performance.now() - this.startedAt) / 1000;
  }

  dispose(): void {
    this.disposed = true;
    this.effects?.dispose();
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
