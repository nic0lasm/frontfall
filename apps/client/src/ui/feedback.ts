import { getLanguage, type MessageKey } from "../i18n/index.ts";
import { RELEASE } from "../release.ts";
import { h } from "../dom.ts";

const REPOSITORY = "https://github.com/nic0lasm/frontfall";

/**
 * Where players share ideas: the "Frontfall Ideas" category of the
 * Discussions. Should it go away, GitHub asks for another category instead.
 */
export const IDEAS_URL = `${REPOSITORY}/discussions/new?category=frontfall-ideas`;

/** The bug form, with the release and what the game was already filled in. */
export function bugUrl(details = ""): string {
  const query = new URLSearchParams({
    template: "bug.yml",
    version: details ? `${RELEASE} (${details})` : RELEASE,
  });
  return `${REPOSITORY}/issues/new?${query.toString()}`;
}

/** The legal notice in the language shown now, read again as the link is reached. */
function legalHref(): string {
  return getLanguage() === "fr" ? "legal.fr.html" : "legal.html";
}

/** The two links, to GitHub, in a new tab; with `legal`, a third to the legal notice. */
export function feedbackLinks(details = "", legal = false): HTMLElement {
  const link = (key: MessageKey, href: string): HTMLAnchorElement =>
    h("a", { href, target: "_blank", rel: "noopener", "data-i18n": key });
  return h(
    "p",
    { class: "feedback-links" },
    link("feedback.idea", IDEAS_URL),
    " · ",
    link("feedback.bug", bugUrl(details)),
    ...(legal ? [" · ", legalLink()] : []),
  );
}

function legalLink(): HTMLAnchorElement {
  const a = h("a", {
    href: legalHref(),
    target: "_blank",
    rel: "noopener",
    "data-i18n": "feedback.legal",
  });
  const refresh = (): void => {
    a.setAttribute("href", legalHref());
  };
  for (const type of ["pointerenter", "focus", "pointerdown"]) a.addEventListener(type, refresh);
  return a;
}
