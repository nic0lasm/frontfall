type Attributes = Record<string, string | number | boolean | undefined>;
type Child = Node | string;

/** Zero or one child, for elements that may be left out. */
export function present<T>(value: T | undefined): T[] {
  return value === undefined ? [] : [value];
}

/**
 * Sets the text of an element unless it already reads so. Writing the same
 * text again still replaces it, and the page is laid out again for it: the
 * HUD's numbers change far less often than updates come.
 */
export function setText(element: Node, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

/** Creates an element; attributes set to false or undefined are left out. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) continue;
    element.setAttribute(name, value === true ? "" : String(value));
  }
  element.append(...children);
  return element;
}

/**
 * A square of a player's colour. The colour is set through the style
 * property, not a style attribute, which a `style-src 'self'` policy blocks.
 */
export function swatch(color: string): HTMLSpanElement {
  const element = h("span", { class: "swatch" });
  element.style.background = color;
  return element;
}
