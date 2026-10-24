import * as THREE from "three";
import { MAP_COLORS, STRUCTURE_COLORS } from "../palette.ts";
import type { CameraView } from "./camera.ts";
import { applyView } from "./orthographic.ts";
import type { Renderer, RendererOptions, StructureMark, UnitMark } from "./renderer.ts";
import { TerritoryLayer } from "./territory-layer.ts";
import { UnitLayer } from "./unit-layer.ts";

/** Ships at sea at once: B-BOAT-MAX for each of up to 26 players, with room to spare. */
const SHIP_CAPACITY = 128;

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
  private readonly structures: Record<StructureMark["type"], StructureLayers>;
  private readonly startedAt = performance.now();
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
      size: 2.5,
    });
    this.ships.mesh.position.copy(this.territory.mesh.position);
    this.scene.add(this.ships.mesh);
    // Cities are diamonds, forts triangles, both larger than a ship.
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
    this.structures = { city: layers(4, 4), fort: layers(3, 4.5) };
    this.camera.position.z = 10;
  }

  setPlayerColor(id: number, color: string): void {
    this.territory.setOwnerColor(id, color);
  }

  /** The player whose land gets the wide rim. */
  setHighlight(id: number): void {
    this.territory.setHighlight(id);
  }

  /** Tiles whose owner changed in the shared array since the last frame; they fade in. */
  markChanged(tiles: ArrayLike<number>): void {
    this.territory.markChanged(tiles, this.clock());
  }

  markAllChanged(): void {
    this.territory.markAllChanged();
  }

  /** Ships at sea, replacing the previous ones. */
  setShips(ships: readonly UnitMark[]): void {
    const count = Math.min(ships.length, SHIP_CAPACITY);
    for (let i = 0; i < count; i++) {
      const ship = ships[i] as UnitMark;
      this.ships.set(i, ship.x, ship.y, ship.color);
    }
    this.ships.count = count;
  }

  setStructures(structures: readonly StructureMark[]): void {
    for (const type of ["city", "fort"] as const) {
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
    this.ships.update(this.camera.position.x);
    const tilesPerPixel = (2 * view.halfWidth) / this.cssWidth;
    for (const { outline, fill, size } of Object.values(this.structures)) {
      const scale = Math.max(1, (STRUCTURE_MIN_PIXELS * tilesPerPixel) / size);
      outline.setScale(scale);
      fill.setScale(scale);
      outline.update(this.camera.position.x);
      fill.update(this.camera.position.x);
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** Seconds since the view was made: small enough for exact 32-bit floats in the shader. */
  private clock(): number {
    return (performance.now() - this.startedAt) / 1000;
  }

  dispose(): void {
    this.territory.dispose();
    this.ships.dispose();
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
