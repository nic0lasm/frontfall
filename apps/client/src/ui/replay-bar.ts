import type { ReplayView } from "../game/game-runner.ts";
import { applyTranslations, t } from "../i18n/index.ts";
import { h } from "../dom.ts";
import { formatDuration } from "./format.ts";

/**
 * The strip shown while watching a recorded game: how far it has got, how
 * fast it runs, and once at its end whether it reached the recorded hash.
 */
export class ReplayBar {
  readonly element: HTMLElement;
  private readonly time = h("span", { class: "replay-time" });
  private readonly progress = h("progress", {
    class: "replay-progress",
    max: 1,
    value: 0,
    "data-i18n-attr": "aria-label:replay.progress",
  });
  private readonly result = h("span", { class: "replay-result", role: "status" });
  private readonly speeds: HTMLButtonElement[];

  /** `speeds`: the paces offered (REPLAY_SPEEDS), passed in so this module needs nothing of the game's. */
  constructor(speeds: readonly number[], onSpeed: (speed: number) => void) {
    this.speeds = speeds.map((speed) => {
      const button = h(
        "button",
        {
          type: "button",
          class: "replay-speed",
          "aria-pressed": speed === 1 ? "true" : "false",
          "data-speed": speed,
        },
        t("replay.speed", { speed: String(speed) }),
      );
      button.addEventListener("click", () => {
        for (const other of this.speeds)
          other.setAttribute("aria-pressed", String(other === button));
        onSpeed(speed);
      });
      return button;
    });
    this.element = h(
      "section",
      { class: "panel replay-bar", id: "replay-bar", "data-i18n-attr": "aria-label:replay.title" },
      h("strong", { class: "replay-title", "data-i18n": "replay.title" }),
      this.progress,
      this.time,
      h(
        "span",
        { class: "replay-speeds", role: "group", "data-i18n-attr": "aria-label:replay.pace" },
        ...this.speeds,
      ),
      this.result,
    );
    applyTranslations(this.element);
  }

  update(tick: number, replay: ReplayView, ticksPerSecond: number): void {
    this.progress.value = replay.ticks > 0 ? tick / replay.ticks : 1;
    this.time.textContent = t("replay.time", {
      now: formatDuration(tick / ticksPerSecond),
      total: formatDuration(replay.ticks / ticksPerSecond),
    });
    this.progress.setAttribute("aria-valuetext", this.time.textContent);
    if (replay.hash === undefined) return;
    const same = replay.hash === replay.expected;
    this.result.dataset.i18n = same ? "replay.same" : "replay.different";
    this.result.className = `replay-result ${same ? "same" : "different"}`;
    this.result.textContent = t(same ? "replay.same" : "replay.different");
  }
}
