/**
 * The only way the client reaches browser storage. Merely touching
 * `localStorage` throws in some browsers (blocked cookies, some private
 * modes), so every access goes through here and gets `undefined` instead.
 * A caller treats that as "not remembered".
 */

/** localStorage, or undefined where merely touching it throws. */
export function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** sessionStorage, or undefined where merely touching it throws. */
export function safeSession(): Storage | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}
