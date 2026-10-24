import * as THREE from "three";
import { STRUCTURE_COLORS } from "../palette.ts";
import type { CameraView } from "./camera.ts";
import { GlobeMarkers } from "./globe-markers.ts";
import { GLOBE_FOV, globePose, globeRays } from "./globe-projection.ts";
import type { Renderer, RendererOptions, StructureMark, UnitMark } from "./renderer.ts";
import { TerritoryLayer } from "./territory-layer.ts";

/** Same limits as the flat map's (map-view.ts). */
const SHIP_CAPACITY = 128;
const STRUCTURE_CAPACITY = 1024;
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
      maxOwner: options.maxOwner,
      surface: "sphere",
    });
    this.territory.mesh.renderOrder = 0;
    this.scene.add(this.territory.mesh);
    const markers = (size: number, sides: number, order: number): GlobeMarkers => {
      const layer = new GlobeMarkers({
        worldWidth: options.width,
        worldHeight: options.height,
        capacity: sides === 8 ? SHIP_CAPACITY : STRUCTURE_CAPACITY,
        size,
        sides,
        order,
      });
      this.scene.add(layer.mesh);
      return layer;
    };
    this.ships = markers(2.5, 8, 1);
    this.structures = {
      city: { outline: markers(5.5, 4, 2), fill: markers(4, 4, 3), size: 4 },
      fort: { outline: markers(6, 3, 2), fill: markers(4.5, 3, 3), size: 4.5 },
    };
  }

  setPlayerColor(id: number, color: string): void {
    this.territory.setOwnerColor(id, color);
  }

  setHighlight(id: number): void {
    this.territory.setHighlight(id);
  }

  markChanged(tiles: ArrayLike<number>): void {
    this.territory.markChanged(tiles, this.clock());
  }

  markAllChanged(): void {
    this.territory.markAllChanged();
  }

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
    this.ships.setScale(1);
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
