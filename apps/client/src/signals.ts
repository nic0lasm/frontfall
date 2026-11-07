import {
  computed,
  effect,
  signal,
  untracked,
  type ReadonlySignal,
  type Signal,
} from "@preact/signals-core";

export { signal, type ReadonlySignal, type Signal };

/**
 * The part of `source` that one panel shows. The result changes only when
 * `equals` finds the new pick different from the one before, so a panel
 * that watches it runs only when what it draws has changed, not on every
 * update of the game.
 */
export function select<T, S>(
  source: ReadonlySignal<T>,
  pick: (value: T) => S,
  equals: (a: S, b: S) => boolean = Object.is,
): ReadonlySignal<S> {
  let held: { value: S } | undefined;
  return computed(() => {
    const next = pick(source.value);
    // The same object as before tells the signals that nothing changed.
    if (held !== undefined && equals(held.value, next)) return held.value;
    held = { value: next };
    return next;
  });
}

/** Whether two records have the same keys and the same values under each, compared with `Object.is`. */
export function shallowEqual<T extends object>(a: T, b: T): boolean {
  if (a === b) return true;
  const keys = Object.keys(a) as (keyof T)[];
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => Object.is(a[key], b[key]));
}

/** Whether two maps hold the same values under the same keys. */
export function sameEntries<K, V>(a: ReadonlyMap<K, V>, b: ReadonlyMap<K, V>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    if (!b.has(key) || !Object.is(b.get(key), value)) return false;
  }
  return true;
}

/**
 * The watchers of one owner, such as a game screen, stopped together when
 * it goes. Each runs once at once, then each time its signal changes.
 */
export class Effects {
  private readonly stops: (() => void)[] = [];

  /**
   * Calls `run` with the value of `source`, now and after each change. Only
   * `source` is followed: signals that `run` reads do not run it again.
   */
  watch<T>(source: ReadonlySignal<T>, run: (value: T) => void): void {
    this.stops.push(
      effect(() => {
        const value = source.value;
        untracked(() => {
          run(value);
        });
      }),
    );
  }

  dispose(): void {
    for (const stop of this.stops.splice(0)) stop();
  }
}
