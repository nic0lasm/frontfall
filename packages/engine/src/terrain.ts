import type { Landmark } from "./landmarks.ts";
import type { Topology } from "./topology.ts";

/** What a tile is made of (R-MAP-01, R-MAP-02). Stored as one byte per tile. */
export const TileKind = {
  Water: 0,
  Plains: 1,
  Hills: 2,
  Mountains: 3,
  Impassable: 4,
} as const;
export type TileKind = (typeof TileKind)[keyof typeof TileKind];

/** Kinds are numbered from 0 without gaps, so a range check validates them. */
const HIGHEST_KIND: number = TileKind.Impassable;

/** Kind of every tile of a map, indexed like its topology. */
export class Terrain {
  readonly topology: Topology;
  readonly kinds: Uint8Array;
  /** Landmarks of the map (R-LAND-01), in the order of its manifest; none on most maps. */
  readonly landmarks: readonly Landmark[];
  private landmasses: Int32Array | undefined;
  private ocean: Uint8Array | undefined;
  private ownable = -1;
  private readonly around = new Int32Array(4);

  constructor(topology: Topology, kinds: Uint8Array, landmarks: readonly Landmark[] = []) {
    this.topology = topology;
    this.kinds = kinds;
    this.landmarks = landmarks;
    if (kinds.length !== topology.size) {
      throw new RangeError(
        `terrain has ${String(kinds.length)} tiles, the map ${String(topology.size)}`,
      );
    }
    for (let i = 0; i < kinds.length; i++) {
      const kind = kinds[i] as number;
      if (kind > HIGHEST_KIND) throw new RangeError(`unknown tile kind ${String(kind)}`);
    }
  }

  kind(tile: number): TileKind {
    return this.kinds[tile] as TileKind;
  }

  /** Land a player can own: anything but water and impassable terrain. */
  isOwnable(tile: number): boolean {
    const kind = this.kinds[tile];
    return kind !== TileKind.Water && kind !== TileKind.Impassable;
  }

  /** Number of ownable tiles on the map, counted once, on first use. */
  get ownableCount(): number {
    if (this.ownable < 0) {
      let count = 0;
      for (let tile = 0; tile < this.kinds.length; tile++) if (this.isOwnable(tile)) count++;
      this.ownable = count;
    }
    return this.ownable;
  }

  /** Ownable land next to water: where transport ships land and leave (R-UNIT-02). */
  isCoast(tile: number): boolean {
    if (!this.isOwnable(tile)) return false;
    const count = this.topology.neighborsInto(tile, this.around);
    for (let i = 0; i < count; i++) {
      if (this.kinds[this.around[i] as number] === TileKind.Water) return true;
    }
    return false;
  }

  /**
   * Finds the land masses and the ocean now instead of on first use: on
   * World each takes tens of milliseconds, too long for a tick of play.
   */
  prepare(): void {
    this.landmasses ??= this.findLandmasses();
    this.ocean ??= this.findOcean();
  }

  /**
   * Ownable land next to the ocean, the largest body of water on the map
   * (R-MAP-05), and not only next to a lake.
   */
  isOceanCoast(tile: number): boolean {
    if (!this.isOwnable(tile)) return false;
    this.ocean ??= this.findOcean();
    const count = this.topology.neighborsInto(tile, this.around);
    for (let i = 0; i < count; i++) {
      if (this.ocean[this.around[i] as number] === 1) return true;
    }
    return false;
  }

  /**
   * Number of the land mass a tile belongs to: ownable tiles reachable from
   * one another over ownable land share a number, counted from 0 in tile
   * order. Water and impassable tiles give -1. Computed once, on first use.
   */
  landmassOf(tile: number): number {
    this.landmasses ??= this.findLandmasses();
    return this.landmasses[tile] as number;
  }

  /** 1 on every water tile of the largest body of water, 0 elsewhere. */
  private findOcean(): Uint8Array {
    const bodies = this.findBodies((tile) => this.kinds[tile] === TileKind.Water);
    const sizes: number[] = [];
    for (const body of bodies) if (body >= 0) sizes[body] = (sizes[body] ?? 0) + 1;
    let largest = -1;
    // The first body in tile order wins a tie, the same on every client.
    for (let body = 0; body < sizes.length; body++) {
      if (largest < 0 || (sizes[body] as number) > (sizes[largest] as number)) largest = body;
    }
    const ocean = new Uint8Array(bodies.length);
    for (let tile = 0; tile < bodies.length; tile++) if (bodies[tile] === largest) ocean[tile] = 1;
    return ocean;
  }

  private findLandmasses(): Int32Array {
    return this.findBodies((tile) => this.isOwnable(tile));
  }

  /** Numbers the regions of tiles that `inside` accepts, connected through each other, from 0 in tile order; -1 elsewhere. */
  private findBodies(inside: (tile: number) => boolean): Int32Array {
    const { topology } = this;
    const masses = new Int32Array(topology.size).fill(-1);
    const queue = new Int32Array(topology.size);
    const around = new Int32Array(4);
    let next = 0;
    for (let start = 0; start < topology.size; start++) {
      if (masses[start] !== -1 || !inside(start)) continue;
      masses[start] = next;
      queue[0] = start;
      let head = 0;
      let tail = 1;
      while (head < tail) {
        const count = topology.neighborsInto(queue[head++] as number, around);
        for (let i = 0; i < count; i++) {
          const tile = around[i] as number;
          if (masses[tile] !== -1 || !inside(tile)) continue;
          masses[tile] = next;
          queue[tail++] = tile;
        }
      }
      next++;
    }
    return masses;
  }
}
