import { getLanguage } from "../i18n/index.ts";

/**
 * Number formats by language and options, made once: the HUD formats dozens
 * of numbers ten times a second, and making a format takes far longer than
 * using one.
 */
const formats = new Map<string, Intl.NumberFormat>();

function numberFormat(key: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const language = getLanguage();
  const id = `${language}:${key}`;
  let format = formats.get(id);
  if (!format) {
    format = new Intl.NumberFormat(language, options);
    formats.set(id, format);
  }
  return format;
}

/**
 * 950, 12.4K, 124K, 1.24M: short enough for the HUD, in the reader's language,
 * and never more than three digits, so a figure takes about the same room
 * whatever its size and the panels around it stay put.
 */
export function formatCount(value: number): string {
  const compact = value >= 10_000;
  return numberFormat(compact ? "compact" : "standard", {
    notation: compact ? "compact" : "standard",
    ...(compact ? { maximumSignificantDigits: 3 } : { maximumFractionDigits: 1 }),
  }).format(value);
}

export function formatPercent(share: number): string {
  const digits = share < 0.1 ? 1 : 0;
  return numberFormat(`percent${String(digits)}`, {
    style: "percent",
    maximumFractionDigits: digits,
  }).format(share);
}

/** A pace of the game (R-MODE-07) without its ×: 0.5, 0,5 in French. */
export function formatSpeed(speed: number): string {
  return numberFormat("speed", { maximumFractionDigits: 1 }).format(speed);
}

/** Game time as m:ss, or h:mm:ss past an hour. */
export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = String(whole % 60).padStart(2, "0");
  return h > 0 ? `${String(h)}:${String(m).padStart(2, "0")}:${s}` : `${String(m)}:${s}`;
}
