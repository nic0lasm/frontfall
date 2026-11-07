/** What the player chose for the sound, kept between visits. */
export interface SoundSettings {
  /** Level of the sound effects, 0 to 100. */
  volume: number;
  /** Level of the music, 0 to 100; 0 leaves it off. */
  music: number;
  /** Silences everything: effects and music. */
  muted: boolean;
}

export const STORAGE_KEY = "frontfall.sound";
export const DEFAULT_VOLUME = 60;
export const DEFAULT_MUSIC = 35;

/** What was stored, with anything unreadable or out of range put back to the default. */
export function parseSound(raw: string | null | undefined): SoundSettings {
  const settings: SoundSettings = { volume: DEFAULT_VOLUME, music: DEFAULT_MUSIC, muted: false };
  if (!raw) return settings;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return settings;
    const stored = value as Record<string, unknown>;
    const volume = stored["volume"];
    if (typeof volume === "number" && Number.isFinite(volume)) {
      settings.volume = Math.min(100, Math.max(0, Math.round(volume)));
    }
    const music = stored["music"];
    if (typeof music === "number" && Number.isFinite(music)) {
      settings.music = Math.min(100, Math.max(0, Math.round(music)));
    }
    settings.muted = stored["muted"] === true;
  } catch {
    // Not JSON: the defaults stand.
  }
  return settings;
}

// localStorage directly, not through storage.ts: imported from this module, the bundler would split
// storage.ts into a chunk of its own that the first visit loads too. The try blocks do its work.
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
