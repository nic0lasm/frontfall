import { FEATURE_LABELS, missingFeatures } from "../compat.ts";
import { h } from "../dom.ts";
import { onLanguageChange, plural, t, type MessageKey } from "../i18n/index.ts";
import type { ConnectionStatus } from "../net/online.ts";
import { usage } from "../usage.ts";

/**
 * The messages the page shows over its screens: one notice at a time at the
 * bottom (a failure, the connection, a game to take back), and the band of
 * an announced restart at the top.
 */
export class Notices {
  /** When the announced restart of the server is due, by the page's clock. */
  private maintenanceTimer: ReturnType<typeof setInterval> | undefined;

  /** Removes the notice shown, if any. */
  clear(): void {
    document.querySelector(".notice")?.remove();
  }

  /** A message over the menu, translated again if the language changes. */
  show(key: MessageKey): HTMLElement {
    this.clear();
    const notice = h("p", { class: "notice", role: "alert", "data-i18n": key });
    notice.textContent = t(key);
    document.body.append(notice);
    return notice;
  }

  /**
   * Over the menu: a game this browser left behind, online while the server
   * keeps the seat, or solo, to take back or to drop.
   */
  offerResume(kind: "online" | "solo", onResume: () => void, onDrop: () => void): void {
    this.clear();
    const notice = h("div", { class: "notice", id: "resume", role: "status" });
    const text = h("p", { "data-i18n": `resume.${kind}` });
    text.textContent = t(`resume.${kind}`);
    const back = h("button", { type: "button", class: "primary", "data-i18n": "resume.back" });
    back.textContent = t("resume.back");
    const drop = h("button", { type: "button", class: "secondary", "data-i18n": "resume.drop" });
    drop.textContent = t("resume.drop");
    back.addEventListener("click", () => {
      notice.remove();
      onResume();
    });
    drop.addEventListener("click", () => {
      notice.remove();
      onDrop();
    });
    const actions = h("p", { class: "resume-actions" });
    actions.append(back, drop);
    notice.append(text, actions);
    document.body.append(notice);
    back.focus({ preventScroll: true });
  }

  /** Whether a notice shows. */
  get showing(): boolean {
    return document.querySelector(".notice") !== null;
  }

  /**
   * The connection of an online game dropped: its turns stop until it is back,
   * and the notice says so, with the time to the next attempt. Gone once online.
   */
  connection(state: ConnectionStatus, retryInMs?: number): void {
    const current = document.querySelector("#connection-status");
    if (state !== "offline" && state !== "full" && state !== "connecting") {
      current?.remove();
      return;
    }
    // A notice that matters more, such as the end of the game, stays.
    if (!current && this.showing) return;
    const notice = current ?? h("p", { class: "notice", id: "connection-status", role: "status" });
    const seconds = Math.ceil((retryInMs ?? 0) / 1000);
    notice.textContent =
      state === "offline"
        ? t("status.disconnected", { seconds })
        : state === "full"
          ? t("status.full", { seconds })
          : t("status.connecting");
    if (!current) document.body.append(notice);
  }

  /**
   * The game no longer matches the other players': say so, and offer the
   * report that lets a developer replay it (`bun run sim -- --replay`).
   */
  desync(tick: number, report: () => Promise<unknown>): void {
    const notice = this.show("online.desync");
    const button = h("button", {
      type: "button",
      class: "secondary",
      id: "desync-report",
      "data-i18n": "online.desyncReport",
    });
    button.textContent = t("online.desyncReport");
    button.addEventListener("click", () => {
      void report().then((taken) => {
        if (!taken) return;
        const blob = new Blob([JSON.stringify(taken)], { type: "application/json" });
        download(blob, `frontfall-desync-${String(tick)}.json`, 0);
      });
    });
    notice.append(" ", button);
  }

  /**
   * A band at the top of the page, over the lobby and the game alike, that
   * counts the minutes to an announced restart; `null` takes it away.
   */
  maintenance(inMs: number | null): void {
    clearInterval(this.maintenanceTimer);
    this.maintenanceTimer = undefined;
    document.querySelector(".maintenance")?.remove();
    if (inMs === null) return;
    const due = Date.now() + inMs;
    const band = h("p", { class: "maintenance", role: "status" });
    const update = (): void => {
      band.textContent = plural(
        "online.maintenance",
        Math.max(1, Math.ceil((due - Date.now()) / 60_000)),
      );
    };
    update();
    this.maintenanceTimer = setInterval(update, 15_000);
    document.body.append(band);
  }

  /**
   * Says at once, in the player's language, what a browser lacks to run the game,
   * rather than leaving them to find out on a blank map. The menu stays: a replay
   * file or a setting can still be looked at.
   */
  warnIfUnsupported(): void {
    const missing = missingFeatures();
    if (missing.length === 0) return;
    usage().error("webgl");
    const show = (): void => {
      this.clear();
      const notice = h("p", { class: "notice", id: "compat-notice", role: "alert" });
      notice.textContent = t("compat.missing", {
        features: missing.map((feature) => t(FEATURE_LABELS[feature])).join(", "),
      });
      document.body.append(notice);
    };
    show();
    onLanguageChange(show);
  }
}

/** Hands a file to the browser to save, and frees it once the browser had time to read it. */
export function download(file: Blob, name: string, keepMs = 30_000): void {
  const link = h("a", { href: URL.createObjectURL(file), download: name, hidden: true });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => {
    URL.revokeObjectURL(link.href);
  }, keepMs);
}
