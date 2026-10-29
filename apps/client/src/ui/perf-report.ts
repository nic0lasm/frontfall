import { RELEASE } from "../release.ts";
import { t } from "../i18n/index.ts";
import { h } from "./dom.ts";
import type { GraphicsProfile } from "./graphics.ts";

/** What a game reports of its smoothness: the device, the profile and how frames fare. */
export interface PerfSource {
  report(): { profile: GraphicsProfile; ratio: number; frameMs: number; flat: boolean };
}

/** The graphics chip the browser admits to, or why not. */
function gpuName(): string {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    if (!gl) return "no webgl2";
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "hidden";
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return name;
  } catch {
    return "unknown";
  }
}

/**
 * The little panel `?perf` adds to a game, for measuring a real phone: it
 * shows the frame time of the map and copies a report to paste back. Loaded
 * only when asked for, so it weighs nothing on a normal visit.
 */
export function mountPerfReport(host: HTMLElement, source: PerfSource): () => void {
  const gpu = gpuName();
  const nav = navigator as Navigator & { deviceMemory?: number };
  const lines = (): string[] => {
    const now = source.report();
    return [
      `release ${RELEASE}`,
      `gpu ${gpu}`,
      `screen ${String(screen.width)}x${String(screen.height)} dpr ${String(window.devicePixelRatio)} viewport ${String(innerWidth)}x${String(innerHeight)}`,
      `cores ${String(navigator.hardwareConcurrency)} memory ${String(nav.deviceMemory ?? "?")} GB touch ${String(matchMedia("(pointer: coarse)").matches)}`,
      `profile ${now.profile.saver ? "saver" : `cap ${String(now.profile.maxPixelRatio)}`} flat ${String(now.flat)} ratio ${now.ratio.toFixed(2)}`,
      `frame ${now.frameMs > 0 ? now.frameMs.toFixed(1) : "?"} ms (${now.frameMs > 0 ? (1000 / now.frameMs).toFixed(0) : "?"} fps)`,
    ];
  };
  const text = h("pre", { class: "perf-report-text" });
  const status = h("span", {});
  const copy = h("button", { type: "button", class: "perf-report-copy" }, t("perf.copy"));
  const panel = h("div", { class: "perf-report", "aria-live": "off" }, text, copy, status);
  // Styled here: the panel is for measuring, not for the stylesheet every visit pays for.
  panel.style.cssText =
    "position:fixed;left:8px;bottom:8px;z-index:50;max-width:calc(100vw - 16px);padding:8px;border-radius:8px;" +
    "background:rgba(0,0,0,.78);color:#fff;font:11px/1.35 ui-monospace,monospace;pointer-events:auto";
  text.style.cssText = "margin:0 0 6px;white-space:pre-wrap;word-break:break-all";
  copy.style.cssText = "min-height:44px;padding:0 14px";
  const samples: number[] = [];
  const refresh = (): void => {
    const frame = source.report().frameMs;
    if (frame > 0 && samples.at(-1) !== frame) samples.push(frame);
    text.textContent = lines().join("\n");
  };
  copy.addEventListener("click", () => {
    const sorted = [...samples].sort((a, b) => a - b);
    const pick = (q: number): string =>
      (sorted[Math.floor(q * (sorted.length - 1))] ?? 0).toFixed(1);
    const report = [
      ...lines(),
      `windows ${String(sorted.length)} p50 ${pick(0.5)} ms p90 ${pick(0.9)} ms worst ${pick(1)} ms`,
      `agent ${navigator.userAgent}`,
    ].join("\n");
    navigator.clipboard.writeText(report).then(
      () => {
        status.textContent = t("perf.copied");
      },
      () => {
        status.textContent = t("perf.failed");
      },
    );
  });
  const timer = setInterval(refresh, 1000);
  refresh();
  host.append(panel);
  return () => {
    clearInterval(timer);
    panel.remove();
  };
}
