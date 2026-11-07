/**
 * Where the time of a frame goes, for `?perf` only: each named phase keeps its
 * last 120 timings. Off, `time` runs its work and nothing else.
 */
const SIZE = 120;
const rings = new Map<string, number[]>();

export const probe = {
  on: false,
  /** Runs `work` and, when the probe is on, keeps how long it took under `name`. */
  time<T>(name: string, work: () => T): T {
    if (!probe.on) return work();
    const start = performance.now();
    const result = work();
    probe.add(name, performance.now() - start);
    return result;
  },
  /** The start of a phase: the clock when the probe is on, 0 when off (no closure to build each frame). */
  mark(): number {
    return probe.on ? performance.now() : 0;
  },
  /** Keeps how long a phase begun at `mark()` took; nothing when the probe is off. */
  since(name: string, started: number): void {
    if (probe.on) probe.add(name, performance.now() - started);
  },
  add(name: string, ms: number): void {
    let ring = rings.get(name);
    if (!ring) {
      ring = [];
      rings.set(name, ring);
    }
    ring.push(ms);
    if (ring.length > SIZE) ring.shift();
  },
  /** One line a phase: mean, 90th percentile and worst of the last timings, in milliseconds. */
  lines(): string[] {
    return [...rings].map(([name, ring]) => {
      const sorted = [...ring].sort((a, b) => a - b);
      const mean = ring.reduce((sum, v) => sum + v, 0) / ring.length;
      const p90 = sorted[Math.floor(0.9 * (sorted.length - 1))] ?? 0;
      return `${name} n${String(ring.length)} mean ${mean.toFixed(1)} p90 ${p90.toFixed(1)} max ${(sorted.at(-1) ?? 0).toFixed(1)} ms`;
    });
  },
};
