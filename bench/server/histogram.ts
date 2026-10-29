import type { Summary } from "../engine/stats.ts";

/** A histogram as plain JSON, to send it from one process to another. */
export interface HistogramData {
  /** [bucket index, count] of the non-empty buckets. */
  buckets: [number, number][];
  count: number;
  total: number;
  /** 0 when empty: JSON has no -Infinity. */
  largest: number;
}

/**
 * Durations in buckets of 0.1 ms, up to 10 s. A 30-minute run with 320
 * clients records millions of turn intervals; a histogram keeps that in
 * constant memory at a resolution far below the 100 ms being measured.
 */
export class Histogram {
  private static readonly RESOLUTION_MS = 0.1;
  private readonly buckets = new Uint32Array(100_001);
  private count = 0;
  private total = 0;
  private largest = -Infinity;

  record(ms: number): void {
    const index = Math.min(
      this.buckets.length - 1,
      Math.max(0, Math.round(ms / Histogram.RESOLUTION_MS)),
    );
    this.buckets[index] = (this.buckets[index] ?? 0) + 1;
    this.count++;
    this.total += ms;
    this.largest = Math.max(this.largest, ms);
  }

  add(other: Histogram): void {
    for (let index = 0; index < this.buckets.length; index++) {
      this.buckets[index] = (this.buckets[index] ?? 0) + (other.buckets[index] ?? 0);
    }
    this.count += other.count;
    this.total += other.total;
    this.largest = Math.max(this.largest, other.largest);
  }

  reset(): void {
    this.buckets.fill(0);
    this.count = 0;
    this.total = 0;
    this.largest = -Infinity;
  }

  toData(): HistogramData {
    const buckets: [number, number][] = [];
    this.buckets.forEach((count, index) => {
      if (count > 0) buckets.push([index, count]);
    });
    return {
      buckets,
      count: this.count,
      total: this.total,
      largest: this.count > 0 ? this.largest : 0,
    };
  }

  static fromData(data: HistogramData): Histogram {
    const histogram = new Histogram();
    for (const [index, count] of data.buckets) histogram.buckets[index] = count;
    histogram.count = data.count;
    histogram.total = data.total;
    histogram.largest = data.count > 0 ? data.largest : -Infinity;
    return histogram;
  }

  get samples(): number {
    return this.count;
  }

  /** Nearest-rank percentiles, to the bucket; the maximum is exact. */
  summary(): Summary {
    if (this.count === 0) throw new RangeError("no samples to summarize");
    const rank = (p: number): number => {
      const target = Math.max(1, Math.ceil(p * this.count));
      let seen = 0;
      for (let index = 0; index < this.buckets.length; index++) {
        seen += this.buckets[index] ?? 0;
        if (seen >= target) return Math.min(index * Histogram.RESOLUTION_MS, this.largest);
      }
      return this.largest;
    };
    return {
      samples: this.count,
      mean: this.total / this.count,
      p50: rank(0.5),
      p95: rank(0.95),
      p99: rank(0.99),
      max: this.largest,
    };
  }
}
