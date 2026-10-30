/**
 * The pictograms of the interface (docs/art-direction.md): one sprite of 24-unit glyphs,
 * drawn in a single colour (`currentColor`) with their details cut out, so one drawing
 * serves the HUD, the help and the menus. Accent parts take `--icon-accent` where a
 * context sets it and the text colour elsewhere.
 */
export const ICON_NAMES = [
  "city",
  "fort",
  "port",
  "palace",
  "silo",
  "airDefense",
  "mosque",
  "warship",
  "trade",
  "missile",
  "heavyMissile",
  "demolish",
  "pause",
  "help",
  "leave",
  "close",
  "build",
  "trophy",
  "profile",
  "settings",
  "language",
  "account",
  "gift",
  "message",
  "alliance",
  "requests",
  "attack",
  "workers",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

const SPRITE = `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" focusable="false" aria-hidden="true" class="icon-sprite">
  <symbol id="i-city" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M2.5 21V11h5.5v10zM9 21V3h6.5v18zM16.5 21V8h5v13zM11 6h1.2v1.8H11zM13.3 6h1.2v1.8h-1.2zM11 10h1.2v1.8H11zM13.3 10h1.2v1.8h-1.2zM11 14h1.2v1.8H11zM13.3 14h1.2v1.8h-1.2zM4 13.5h1.3v1.6H4zM4 17h1.3v1.6H4zM18 11h1.3v1.6H18zM18 14.5h1.3v1.6H18zM18 18h1.3v1.6H18z"/></symbol>
  <symbol id="i-fort" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M4 21V4.5h3.6V7h2.2V4.5h4.4V7h2.2V4.5H20V21zM9.8 21v-4.4a2.2 2.2 0 0 1 4.4 0V21zM11.4 10h1.2v3.4h-1.2z"/></symbol>
  <symbol id="i-port" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5.2" r="2.3"/><path d="M12 7.5V20M8 11h8M4 14.5c.6 4 4 6 8 6s7.4-2 8-6"/><path d="M2.4 15.6l1.6-2 2 1.6M18 15.2l2-1.7 1.6 2.1"/></g></symbol>
  <symbol id="i-palace" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M5 21v-7h2.2C7.4 9.5 9.4 6.8 12 5.4c2.6 1.4 4.6 4.1 4.8 8.6H19v7zM2.5 21V11.5L4 8.5l1.5 3V21zM18.5 21V11.5L20 8.5l1.5 3V21zM11.5 1.5h1V5.4h-1zM7.6 16h1.5v5H7.6zM11.25 16h1.5v5h-1.5zM14.9 16h1.5v5h-1.5z"/><path class="ac" d="M12.5 1.5 16.2 2.9 12.5 4.3z"/></symbol>
  <symbol id="i-silo" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M5.5 21V11L8 8.5h8l2.5 2.5v10zM12 2l2.4 6.1H9.6zM7.5 13h9v1.5h-9zM7.5 17h9v1.5h-9z"/></symbol>
  <symbol id="i-airDefense" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M12 2.5 20 5.5v6c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10v-6zM12 7 16.6 12.5h-3.1V17h-3V12.5H7.4z"/></symbol>
  <symbol id="i-mosque" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M5 21v-6h2.5c0-3.2 2-5.4 4.5-6.4 2.5 1 4.5 3.2 4.5 6.4H19v6zM2.5 21V8.5L3.5 3l1 5.5V21zM19.5 21V8.5l1-5.5 1 5.5V21zM11.6 4.4h.8V8.7h-.8zM10.5 21v-3.5a1.5 1.5 0 0 1 3 0V21z"/></symbol>
  <symbol id="i-warship" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M2.5 15.5h17L22 17.5 19 20.8H6zM8 11.5h8v4H8zM10.4 8.5h3.2v3h-3.2zM5.8 17.3h1.4v1.4H5.8zM8.8 17.3h1.4v1.4H8.8zM11.8 17.3h1.4v1.4h-1.4zM14.8 17.3h1.4v1.4h-1.4z"/><g fill="none" stroke="currentColor" stroke-linecap="round"><path d="M12 8.5V4" stroke-width="1.3"/><path d="M13.5 9.8 20 8.4" stroke-width="1.8"/></g></symbol>
  <symbol id="i-trade" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M2.5 17h19L19 21H5zM5 12.4h4.2v4H5zM9.8 12.4H14v4H9.8zM14.6 12.4h4.2v4h-4.2zM7.4 8h4.2v4H7.4zM12.2 8h4.2v4h-4.2z"/></symbol>
  <symbol id="i-missile" viewBox="0 0 24 24"><g transform="rotate(45 12 12)"><path fill-rule="evenodd" d="M12 1.8C14.6 5 15.2 9 15.2 13v4H8.8v-4C8.8 9 9.4 5 12 1.8zM8.8 13.5 5.2 18.5l3.6-1zM15.2 13.5l3.6 5-3.6-1zM12 6.8a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4z"/><path class="ac" d="M10.4 17.4h3.2L12 22.4z"/></g></symbol>
  <symbol id="i-heavyMissile" viewBox="0 0 24 24"><g transform="rotate(45 12 12)"><path fill-rule="evenodd" d="M12 1C15.2 4.5 16.6 8.5 16.6 13v4.6H7.4V13C7.4 8.5 8.8 4.5 12 1zM7.4 13.5 3.8 19.5l3.6-1.5zM16.6 13.5l3.6 6-3.6-1.5zM7.7 11h8.6v1.4H7.7zM7.7 14h8.6v1.4H7.7z"/><path class="ac" d="M9.6 17.8h4.8L12 23z"/></g></symbol>
  <symbol id="i-demolish" viewBox="0 0 24 24"><path d="M5.6 3.8 12 10.2l6.4-6.4 1.8 1.8-6.4 6.4 6.4 6.4-1.8 1.8-6.4-6.4-6.4 6.4-1.8-1.8 6.4-6.4-6.4-6.4z"/></symbol>
  <symbol id="i-pause" viewBox="0 0 24 24"><path d="M6.5 4h4v16h-4zM13.5 4h4v16h-4z"/></symbol>
  <symbol id="i-help" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.2"/><path d="M9.3 9.4a2.8 2.8 0 1 1 4.3 2.3c-1 .6-1.6 1.2-1.6 2.3"/></g><circle cx="12" cy="17.3" r="1.3"/></symbol>
  <symbol id="i-leave" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.5H5.5a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1H10M15.5 7.5 20 12l-4.5 4.5M20 12H9.5"/></g></symbol>
  <symbol id="i-close" viewBox="0 0 24 24"><path d="M5.8 4 12 10.2 18.2 4 20 5.8 13.8 12 20 18.2 18.2 20 12 13.8 5.8 20 4 18.2 10.2 12 4 5.8z"/></symbol>
  <symbol id="i-build" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M12 2.8 22 11.5h-2.8V21H4.8v-9.5H2zM11 11.6v2.4H8.6v2H11v2.4h2V16h2.4v-2H13v-2.4z"/></symbol>
  <symbol id="i-trophy" viewBox="0 0 24 24"><path d="M6.5 2.5h11V9a5.5 5.5 0 0 1-11 0zM10.8 14.2h2.4v3.3h-2.4zM7 18.5h10v2.5H7z"/><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M6.5 4.8H3.8V7a3.2 3.2 0 0 0 3.2 3.2M17.5 4.8h2.7V7a3.2 3.2 0 0 1-3.2 3.2"/></symbol>
  <symbol id="i-profile" viewBox="0 0 24 24"><path d="M12 3.5a4.4 4.4 0 1 1 0 8.8 4.4 4.4 0 0 1 0-8.8zM3.8 21c0-4.4 3.6-7 8.2-7s8.2 2.6 8.2 7z"/></symbol>
  <symbol id="i-settings" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M12 5.4a6.6 6.6 0 1 0 0 13.2 6.6 6.6 0 0 0 0-13.2zm0 4a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2z"/><g id="teeth"><rect x="10.2" y="1.8" width="3.6" height="4.6" rx="1"/><rect x="10.2" y="1.8" width="3.6" height="4.6" rx="1" transform="rotate(45 12 12)"/><rect x="10.2" y="1.8" width="3.6" height="4.6" rx="1" transform="rotate(90 12 12)"/><rect x="10.2" y="1.8" width="3.6" height="4.6" rx="1" transform="rotate(135 12 12)"/><rect x="10.2" y="1.8" width="3.6" height="4.6" rx="1" transform="rotate(180 12 12)"/><rect x="10.2" y="1.8" width="3.6" height="4.6" rx="1" transform="rotate(225 12 12)"/><rect x="10.2" y="1.8" width="3.6" height="4.6" rx="1" transform="rotate(270 12 12)"/><rect x="10.2" y="1.8" width="3.6" height="4.6" rx="1" transform="rotate(315 12 12)"/></g></symbol>
  <symbol id="i-language" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.2"/><path d="M2.8 12h18.4M12 2.8c2.6 2.5 3.9 5.6 3.9 9.2s-1.3 6.7-3.9 9.2c-2.6-2.5-3.9-5.6-3.9-9.2S9.4 5.3 12 2.8z"/></g></symbol>
  <symbol id="i-account" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.8" cy="12" r="4.3"/><path d="M12.1 12H21M18 12v3.6M15.2 12v2.6"/></g></symbol>
  <symbol id="i-gift" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M4 11h16v10H4zM2.8 7.8h18.4V11H2.8zM11 7.8h2V21h-2z"/><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M12 7.8C10.8 4.2 7 3.8 7.4 6c.3 1.5 3 1.8 4.6 1.8zM12 7.8c1.2-3.6 5-4 4.6-1.8-.3 1.5-3 1.8-4.6 1.8z"/></symbol>
  <symbol id="i-message" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M4 3.8h16a1.2 1.2 0 0 1 1.2 1.2v10.2a1.2 1.2 0 0 1-1.2 1.2h-8l-5 4.6v-4.6H4a1.2 1.2 0 0 1-1.2-1.2V5A1.2 1.2 0 0 1 4 3.8zM8 8.6a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6zM12 8.6a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6zM16 8.6a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6z"/></symbol>
  <symbol id="i-alliance" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8.6" cy="12" r="5.2"/><circle cx="15.4" cy="12" r="5.2"/></g></symbol>
  <symbol id="i-requests" viewBox="0 0 24 24"><path d="M12 2.8a6 6 0 0 0-6 6v4.2l-2.2 3.8h16.4L18 13V8.8a6 6 0 0 0-6-6zM9.8 19h4.4a2.2 2.2 0 0 1-4.4 0z"/></symbol>
  <symbol id="i-attack" viewBox="0 0 24 24"><path d="M20.5 3.5v5.4l-9 9-5.4-5.4zM5 13.6l5.4 5.4-1.7 1.7-5.4-5.4zM3.3 17.4l3.3 3.3-2.4.6a1 1 0 0 1-1.1-1.1z"/></symbol>
  <symbol id="i-workers" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M15.8 2.8a5.6 5.6 0 0 1 4.9 7.7l-3.2-3.2-2.2.6-.6 2.2 3.2 3.2A5.6 5.6 0 0 1 10 9.3a5.6 5.6 0 0 1 5.8-6.5zM9.6 11.9l2.5 2.5-7 7a1.8 1.8 0 0 1-2.5-2.5z"/></symbol>
</svg>`;

const NS = "http://www.w3.org/2000/svg";

/** Puts the sprite in the page once; `icon` does it too. */
export function installSprite(): void {
  if (document.getElementById("i-city") !== null) return;
  document.body.insertAdjacentHTML("afterbegin", SPRITE);
}

/** An icon of the sprite, sized by the stylesheet (`.icon`). */
export function icon(name: IconName): SVGSVGElement {
  installSprite();
  const root = document.createElementNS(NS, "svg");
  root.setAttribute("class", "icon");
  root.setAttribute("viewBox", "0 0 24 24");
  root.setAttribute("aria-hidden", "true");
  root.setAttribute("focusable", "false");
  const use = document.createElementNS(NS, "use");
  use.setAttribute("href", `#i-${name}`);
  root.append(use);
  return root;
}
