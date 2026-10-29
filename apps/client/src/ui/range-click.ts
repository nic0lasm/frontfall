/** Width of the thumb of a range input, in px: the track the value runs along is that much shorter. */
const THUMB = 16;

/**
 * Makes a press anywhere on a range input set its value there, then follow the pointer until
 * it is let go, the same for a mouse, a finger and a pen. The browser's own handling only
 * takes the thumb or a slightly off-centre press, and a press that starts a scroll or a drag
 * can be lost. The keyboard keeps working as it does natively. `input` fires as the value
 * moves, `change` once the pointer is let go on a different value.
 */
export function pressToSet(input: HTMLInputElement): void {
  let start: string | undefined;

  const move = (event: PointerEvent): void => {
    const rect = input.getBoundingClientRect();
    const run = Math.max(1, rect.width - THUMB);
    const share = Math.max(0, Math.min(1, (event.clientX - rect.left - THUMB / 2) / run));
    const min = Number(input.min || 0);
    const max = Number(input.max || 100);
    const before = input.value;
    // The scale starts at zero, so the middle of a 5-100 % slider reads 50 %, not 52.5 %.
    input.value = String(Math.max(min, share * max));
    if (input.value !== before) input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  input.addEventListener("pointerdown", (event) => {
    if (input.disabled || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    input.setPointerCapture(event.pointerId);
    input.focus({ preventScroll: true });
    start = input.value;
    move(event);
  });
  input.addEventListener("pointermove", (event) => {
    if (start !== undefined) move(event);
  });
  const end = (): void => {
    if (start === undefined) return;
    const moved = input.value !== start;
    start = undefined;
    if (moved) input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  input.addEventListener("pointerup", end);
  input.addEventListener("pointercancel", end);
  input.addEventListener("lostpointercapture", end);
}
