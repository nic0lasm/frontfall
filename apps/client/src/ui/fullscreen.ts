import { onLanguageChange, t } from "../i18n/index.ts";
import { h } from "../dom.ts";
import { icon } from "./icons.ts";

/** The part of the document the full-screen button reads and drives. */
export interface FullscreenHost {
  readonly fullscreenEnabled?: boolean;
  readonly fullscreenElement: Element | null;
  readonly documentElement: { requestFullscreen(): Promise<void> };
  exitFullscreen(): Promise<void>;
  addEventListener(type: "fullscreenchange", listener: () => void): void;
  removeEventListener(type: "fullscreenchange", listener: () => void): void;
}

/** Whether the browser offers full screen: iPhone Safari does not, so the button stays hidden there. */
export function fullscreenAvailable(host: Pick<FullscreenHost, "fullscreenEnabled">): boolean {
  return host.fullscreenEnabled === true;
}

/** The label of the button: what the next press does. */
export function fullscreenLabelKey(on: boolean): "fullscreen.enter" | "fullscreen.exit" {
  return on ? "fullscreen.exit" : "fullscreen.enter";
}

/** Enters full screen, or leaves it when the page is in it. A refusal leaves the page as it was. */
export async function toggleFullscreen(host: FullscreenHost): Promise<void> {
  try {
    if (host.fullscreenElement) await host.exitFullscreen();
    else await host.documentElement.requestFullscreen();
  } catch {
    // The browser refused (no gesture, or a policy): nothing changes.
  }
}

/**
 * A full-screen button, or nothing where the browser has no Fullscreen API.
 * It shows the current state and follows Esc and the browser leaving full
 * screen through `fullscreenchange`.
 */
export function fullscreenButton(
  className: string,
  options: { text?: boolean; host?: FullscreenHost } = {},
): HTMLButtonElement | undefined {
  const host = options.host ?? document;
  if (!fullscreenAvailable(host)) return undefined;
  const button = h("button", { type: "button", class: className });
  let stopLanguage = (): void => undefined;
  let attached = false;
  const show = (): void => {
    // A screen that was left takes its button along: stop listening for it.
    if (button.isConnected) attached = true;
    else if (attached) {
      host.removeEventListener("fullscreenchange", show);
      stopLanguage();
      return;
    }
    const on = host.fullscreenElement !== null;
    const label = t(fullscreenLabelKey(on));
    button.setAttribute("aria-label", label);
    button.title = label;
    button.setAttribute("aria-pressed", String(on));
    button.replaceChildren(
      icon(on ? "fullscreenExit" : "fullscreen"),
      ...(options.text ? [h("span", {}, label)] : []),
    );
  };
  button.addEventListener("click", () => {
    void toggleFullscreen(host);
  });
  host.addEventListener("fullscreenchange", show);
  stopLanguage = onLanguageChange(show);
  show();
  return button;
}
