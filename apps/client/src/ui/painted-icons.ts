/**
 * The painted miniatures of the build bar and the help (docs/art-direction.md, "Table de campagne"):
 * eleven pieces seen from a slight angle, drawn in three tones (light top, mid front, dark side)
 * plus the owner's paint. The tones are custom properties (styles.css) so a context can repaint
 * them; `--own` is the player's colour, set on the game screen. The other icons stay in the
 * one-colour sprite of `icons.ts`, which the achievement badges tint by tier.
 */
import { icon, type IconName } from "./icons.ts";

export const PAINTED_NAMES = [
  "city",
  "palace",
  "fort",
  "port",
  "silo",
  "airDefense",
  "warship",
  "trade",
  "missile",
  "heavyMissile",
  "demolish",
] as const satisfies readonly IconName[];

export type PaintedName = (typeof PAINTED_NAMES)[number];

const SPRITE = `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" focusable="false" aria-hidden="true" class="icon-sprite">
  <symbol id="p-city" viewBox="0 0 32 32"><polygon class="pd" points="10,28 12.4,26.5 12.4,15.5 10,17"/><polygon class="pm" points="3,28 10,28 10,17 3,17"/><polygon class="po" points="3,17 5.4,15.5 12.4,15.5 10,17"/><polygon class="pd" points="20,28 22.4,26.5 22.4,5.5 20,7"/><polygon class="pm" points="11,28 20,28 20,7 11,7"/><polygon class="po" points="11,7 13.4,5.5 22.4,5.5 20,7"/><polygon class="pd" points="28,28 30.4,26.5 30.4,12.5 28,14"/><polygon class="pm" points="21,28 28,28 28,14 21,14"/><polygon class="po" points="21,14 23.4,12.5 30.4,12.5 28,14"/><rect class="pk" x="5" y="19" width="1.4" height="1.8" rx=".3"/><rect class="pk" x="7.4" y="19" width="1.4" height="1.8" rx=".3"/><rect class="pk" x="5" y="23" width="1.4" height="1.8" rx=".3"/><rect class="pk" x="7.4" y="23" width="1.4" height="1.8" rx=".3"/><rect class="pk" x="13" y="9" width="1.4" height="1.8" rx=".3"/><rect class="pk" x="16" y="9" width="1.4" height="1.8" rx=".3"/><rect class="pk" x="13" y="13" width="1.4" height="1.8" rx=".3"/><rect class="pk" x="16" y="13" width="1.4" height="1.8" rx=".3"/><rect class="pk" x="13" y="17" width="1.4" height="1.8" rx=".3"/><rect class="pk" x="16" y="17" width="1.4" height="1.8" rx=".3"/><rect class="pk" x="23" y="17" width="1.4" height="1.8" rx=".3"/><rect class="pk" x="25.4" y="17" width="1.4" height="1.8" rx=".3"/><rect class="pk" x="23" y="21" width="1.4" height="1.8" rx=".3"/></symbol>
  <symbol id="p-palace" viewBox="0 0 32 32"><polygon class="pd" points="9,28 10.6,27 10.6,14 9,15"/><polygon class="pm" points="4,28 9,28 9,15 4,15"/><polygon class="pl" points="4,15 5.6,14 10.6,14 9,15"/><polygon class="pd" points="28,28 29.6,27 29.6,14 28,15"/><polygon class="pm" points="23,28 28,28 28,15 23,15"/><polygon class="pl" points="23,15 24.6,14 29.6,14 28,15"/><polygon class="pd" points="23,28 25.4,26.5 25.4,16.5 23,18"/><polygon class="pm" points="9,28 23,28 23,18 9,18"/><polygon class="pl" points="9,18 11.4,16.5 25.4,16.5 23,18"/><path class="pm" d="M9.6 18a6.4 7.6 0 0 1 12.8 0z"/><path class="pl" d="M9.6 18a6.4 7.6 0 0 1 6.4-7.6V18z" opacity=".55"/><rect class="pd" x="15.5" y="4.5" width="1" height="6"/><polygon class="po" points="16.5,4.6 21,6.2 16.5,7.8"/><rect class="pk" x="11.5" y="22" width="1.6" height="4.5" rx=".3"/><rect class="pk" x="15.2" y="22" width="1.6" height="4.5" rx=".3"/><rect class="pk" x="18.9" y="22" width="1.6" height="4.5" rx=".3"/></symbol>
  <symbol id="p-fort" viewBox="0 0 32 32"><polygon class="pd" points="27,28 29.4,26.5 29.4,13.5 27,15"/><polygon class="pm" points="5,28 27,28 27,15 5,15"/><polygon class="pl" points="5,15 7.4,13.5 29.4,13.5 27,15"/><polygon class="pd" points="8.6,15 10.2,14 10.2,11 8.6,12"/><polygon class="pm" points="5,15 8.6,15 8.6,12 5,12"/><polygon class="pl" points="5,12 6.6,11 10.2,11 8.6,12"/><polygon class="pd" points="13.6,15 15.2,14 15.2,11 13.6,12"/><polygon class="pm" points="10,15 13.6,15 13.6,12 10,12"/><polygon class="pl" points="10,12 11.6,11 15.2,11 13.6,12"/><polygon class="pd" points="19.1,15 20.7,14 20.7,11 19.1,12"/><polygon class="pm" points="15.5,15 19.1,15 19.1,12 15.5,12"/><polygon class="pl" points="15.5,12 17.1,11 20.7,11 19.1,12"/><polygon class="pd" points="24.6,15 26.2,14 26.2,11 24.6,12"/><polygon class="pm" points="21,15 24.6,15 24.6,12 21,12"/><polygon class="pl" points="21,12 22.6,11 26.2,11 24.6,12"/><path class="pk" d="M12.5 28v-5a3.5 3.5 0 0 1 7 0v5z"/><rect class="pd" x="15.7" y="3" width=".9" height="7"/><polygon class="po" points="16.6,3.2 21,4.8 16.6,6.4"/></symbol>
  <symbol id="p-port" viewBox="0 0 32 32"><g fill="none" stroke-linecap="round" stroke-linejoin="round"><g class="psd" stroke-width="3.2"><circle cx="16" cy="7" r="2.4"/><path d="M16 9.6V25M11 14h10M6.5 18c.6 5 4.5 8 9.5 8s8.9-3 9.5-8"/></g><g class="psl" stroke-width="1.4" transform="translate(-.5 -.6)"><circle cx="16" cy="7" r="2.4"/><path d="M16 9.6V25M11 14h10M6.5 18c.6 5 4.5 8 9.5 8s8.9-3 9.5-8"/></g></g><path class="po" d="M3.6 19.5 6 16.5l3 2.4zM25.6 18.9l3-2.4 2.4 3z"/></symbol>
  <symbol id="p-silo" viewBox="0 0 32 32"><path class="pd" d="M6 27V13.5l3-3h14l3 3V27z"/><path class="pm" d="M6 27V13.5l3-3h7V27z"/><rect class="pl" x="6" y="13.2" width="20" height="1.6" opacity=".7"/><ellipse class="pk" cx="16" cy="11" rx="6" ry="2.2"/><path class="pl" d="M16 1.5c2.2 2.6 2.8 5.2 2.8 8.6h-5.6c0-3.4.6-6 2.8-8.6z"/><path class="po" d="M16 1.5c1 1.2 1.7 2.4 2.1 3.8h-4.2c.4-1.4 1.1-2.6 2.1-3.8z"/><rect class="pl" x="8" y="19" width="16" height="1.4" opacity=".6"/><rect class="pl" x="8" y="23" width="16" height="1.4" opacity=".6"/></symbol>
  <symbol id="p-airDefense" viewBox="0 0 32 32"><polygon class="pd" points="25,28 27.4,26.5 27.4,20.5 25,22"/><polygon class="pm" points="7,28 25,28 25,22 7,22"/><polygon class="pl" points="7,22 9.4,20.5 27.4,20.5 25,22"/><ellipse class="pk" cx="17" cy="18" rx="7.5" ry="2.4"/><path class="pm" d="M9.5 18a7.5 7.5 0 0 1 15 0z"/><path class="pl" d="M9.5 18a7.5 7.5 0 0 1 7.5-7.5V18z" opacity=".5"/><g class="pd"><polygon points="12.5,11.5 9.2,3.2 11.4,2.4 14.4,10.4"/><polygon points="18,10.4 21,2.4 23.2,3.2 20.2,11.5"/></g><polygon class="po" points="9.2,3.2 11.4,2.4 11.9,3.8 9.7,4.6"/><polygon class="po" points="21,2.4 23.2,3.2 22.7,4.6 20.5,3.8"/></symbol>
  <symbol id="p-warship" viewBox="0 0 32 32"><path class="pd" d="M2 20.5h26l-3.5 6.5H7z"/><path class="pm" d="M2 20.5h26l-.9 1.8H3.3z"/><path class="po" d="M4.2 22.8h22.6l-.9 1.8H5.2z"/><polygon class="pd" points="21,20.5 22.76,19.4 22.76,15.4 21,16.5"/><polygon class="pm" points="9,20.5 21,20.5 21,16.5 9,16.5"/><polygon class="pl" points="9,16.5 10.76,15.4 22.76,15.4 21,16.5"/><polygon class="pd" points="18,16.5 19.6,15.5 19.6,12 18,13"/><polygon class="pm" points="12,16.5 18,16.5 18,13 12,13"/><polygon class="pl" points="12,13 13.6,12 19.6,12 18,13"/><ellipse class="pm" cx="23.5" cy="17.7" rx="3" ry="1.6"/><path class="pd" d="M24.6 16.3 31 14.3l.5 1.2-6.1 2z"/><rect class="pd" x="14.7" y="8" width=".9" height="5"/><polygon class="po" points="15.6,8.2 19,9.3 15.6,10.4"/><path class="pw" d="M1 28.5q2-1.4 4 0t4 0 4 0 4 0 4 0 4 0 4 0" fill="none" stroke-width="1.2"/></symbol>
  <symbol id="p-trade" viewBox="0 0 32 32"><path class="pd" d="M2 21h26l-3.5 6H6z"/><path class="pm" d="M2 21h26l-.8 1.6H2.9z"/><polygon class="pd" points="11,21 12.76,19.9 12.76,14.9 11,16"/><polygon class="po" points="5,21 11,21 11,16 5,16"/><polygon class="pl" points="5,16 6.76,14.9 12.76,14.9 11,16"/><polygon class="pd" points="17.5,21 19.26,19.9 19.26,14.9 17.5,16"/><polygon class="pm" points="11.5,21 17.5,21 17.5,16 11.5,16"/><polygon class="pl" points="11.5,16 13.26,14.9 19.26,14.9 17.5,16"/><polygon class="pd" points="24,21 25.76,19.9 25.76,14.9 24,16"/><polygon class="po" points="18,21 24,21 24,16 18,16"/><polygon class="pl" points="18,16 19.76,14.9 25.76,14.9 24,16"/><polygon class="pd" points="14,16 15.76,14.9 15.76,9.9 14,11"/><polygon class="pm" points="8,16 14,16 14,11 8,11"/><polygon class="pl" points="8,11 9.76,9.9 15.76,9.9 14,11"/><polygon class="pd" points="20.5,16 22.26,14.9 22.26,9.9 20.5,11"/><polygon class="po" points="14.5,16 20.5,16 20.5,11 14.5,11"/><polygon class="pl" points="14.5,11 16.26,9.9 22.26,9.9 20.5,11"/><polygon class="pd" points="26.5,21 27.94,20.1 27.94,13.1 26.5,14"/><polygon class="pm" points="23,21 26.5,21 26.5,14 23,14"/><polygon class="pl" points="23,14 24.44,13.1 27.94,13.1 26.5,14"/><path class="pw" d="M1 29q2-1.4 4 0t4 0 4 0 4 0 4 0 4 0 4 0" fill="none" stroke-width="1.2"/></symbol>
  <symbol id="p-missile" viewBox="0 0 32 32"><g transform="rotate(45 16 16)"><path class="pf" d="M16 22.5q-2 3.5 0 7q2-3.5 0-7z"/><polygon class="pd" points="11.2,19 6.4,25.4 11.2,24.6"/><polygon class="pd" points="20.8,19 25.6,25.4 20.8,24.6"/><path class="pm" d="M16 2c2.6 3 3.6 7 3.6 11v10.5h-7.2V13c0-4 1-8 3.6-11z"/><path class="pl" d="M16 2c-2.6 3-3.6 7-3.6 11v10.5H16z" opacity=".7"/><path class="po" d="M16 2c1.2 1.4 2.1 3 2.7 4.8h-5.4c.6-1.8 1.5-3.4 2.7-4.8z"/><rect class="pd" x="12.4" y="16" width="7.2" height="1.4"/><circle class="pk" cx="16" cy="11.6" r="1.6"/></g></symbol>
  <symbol id="p-heavyMissile" viewBox="0 0 32 32"><g transform="rotate(45 16 16)"><path class="pf" d="M16 21.5q-3 4.5 0 8.5q3-4 0-8.5z"/><polygon class="pd" points="10.8,16.5 5,24.5 10.8,23.2"/><polygon class="pd" points="21.2,16.5 27,24.5 21.2,23.2"/><path class="pm" d="M16 .8c3.4 3.4 4.8 8 4.8 12.4v9.5h-9.6v-9.5c0-4.4 1.4-9 4.8-12.4z"/><path class="pl" d="M16 .8c-3.4 3.4-4.8 8-4.8 12.4v9.5H16z" opacity=".7"/><path class="po" d="M16 .8c1.5 1.5 2.7 3.3 3.4 5.3h-6.8c.7-2 1.9-3.8 3.4-5.3z"/><rect class="pd" x="11.2" y="12.5" width="9.6" height="1.6"/><rect class="pd" x="11.2" y="16.5" width="9.6" height="1.6"/></g></symbol>
  <symbol id="p-demolish" viewBox="0 0 32 32"><g fill="none" stroke-linecap="round"><path class="psd" stroke-width="5" d="M7 7l18 18M25 7L7 25"/><path class="psl" stroke-width="2" transform="translate(-.6 -.7)" d="M7 7l18 18M25 7L7 25"/></g></symbol>
</svg>`;

const NS = "http://www.w3.org/2000/svg";

/** True for the names that have a painted miniature. */
export function isPainted(name: string): name is PaintedName {
  return (PAINTED_NAMES as readonly string[]).includes(name);
}

/** A painted miniature, sized by the stylesheet (`.icon`). */
export function paintedIcon(name: PaintedName): SVGSVGElement {
  if (document.getElementById("p-city") === null) {
    document.body.insertAdjacentHTML("afterbegin", SPRITE);
  }
  const root = document.createElementNS(NS, "svg");
  root.setAttribute("class", "icon painted");
  root.setAttribute("viewBox", "0 0 32 32");
  root.setAttribute("aria-hidden", "true");
  root.setAttribute("focusable", "false");
  const use = document.createElementNS(NS, "use");
  use.setAttribute("href", `#p-${name}`);
  root.append(use);
  return root;
}

/** The icon of a building or weapon: its painted miniature, or the plain glyph where it has none. */
export function pieceIcon(name: IconName): SVGSVGElement {
  return isPainted(name) ? paintedIcon(name) : icon(name);
}
