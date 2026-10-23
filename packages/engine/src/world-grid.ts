/**
 * Tile grid of the world. The map wraps east-west like a cylinder, so there is
 * no left or right edge; north and south are hard boundaries. Rendering it on a
 * globe later only changes the projection, not the simulation.
 */
export class WorldGrid {
  readonly size: number;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new RangeError(`invalid grid size ${String(width)}x${String(height)}`);
    }
    this.size = width * height;
  }

  /** Brings any column back into [0, width). */
  wrapX(x: number): number {
    return ((x % this.width) + this.width) % this.width;
  }

  index(x: number, y: number): number {
    if (y < 0 || y >= this.height) {
      throw new RangeError(`row ${String(y)} is outside the map`);
    }
    return y * this.width + this.wrapX(x);
  }

  x(index: number): number {
    return index % this.width;
  }

  y(index: number): number {
    return Math.floor(index / this.width);
  }

  /** Orthogonal neighbours, crossing the east-west seam but never the poles. */
  neighbors(index: number): number[] {
    const x = this.x(index);
    const y = this.y(index);
    const result: number[] = [];
    if (y > 0) result.push(this.index(x, y - 1));
    if (this.width > 1) {
      result.push(this.index(x + 1, y));
      if (this.width > 2) result.push(this.index(x - 1, y));
    }
    if (y < this.height - 1) result.push(this.index(x, y + 1));
    return result;
  }

  /** Manhattan distance, taking the shorter way around the world. */
  distance(a: number, b: number): number {
    const dx = Math.abs(this.x(a) - this.x(b));
    return Math.min(dx, this.width - dx) + Math.abs(this.y(a) - this.y(b));
  }
}
