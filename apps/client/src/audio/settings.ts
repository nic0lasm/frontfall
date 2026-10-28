/** What the player chose for the sound effects, kept between visits. */
export interface SoundSettings {
  /** 0 to 100. */
  volume: number;
  muted: boolean;
}

export const STORAGE_KEY = "frontfall.sound";
export const DEFAULT_VOLUME = 60;

/** What was stored, with anything unreadable or out of range put back to the default. */
export function parseSound(raw: string | null | undefined): SoundSettings {
  const settings: SoundSettings = { volume: DEFAULT_VOLUME, muted: false };
  if (!raw) return settings;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return settings;
    const stored = value as Record<string, unknown>;
    const volume = stored["volume"];
    if (typeof volume === "number" && Number.isFinite(volume)) {
      settings.volume = Math.min(100, Math.max(0, Math.round(volume)));
    }
    settings.muted = stored["muted"] === true;
  } catch {
    // Not JSON: the defaults stand.
  }
  return settings;
}

function read(): string | null {
  try {
    return globalThis.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

let current: SoundSettings | undefined;

export function soundSettings(): Readonly<SoundSettings> {
  current ??= parseSound(read());
  return current;
}

export function updateSound(change: Partial<SoundSettings>): void {
  current = { ...soundSettings(), ...change };
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // The choice then lasts until the page is closed.
  }
}
