/** The part of a canvas this check needs, so it can be faked in tests. */
export interface ContextSource {
  getContext(type: "webgl2"): {
    getExtension(name: "WEBGL_lose_context"): { loseContext(): void } | null;
  } | null;
}

/**
 * Whether the browser can create a WebGL 2 context. Checked on a throwaway
 * canvas before the renderer exists: three.js throws when it cannot get one,
 * and the player would be left on a blank page.
 */
export function hasWebGL2(
  createCanvas: () => ContextSource = () => document.createElement("canvas"),
): boolean {
  try {
    const gl = createCanvas().getContext("webgl2");
    if (!gl) return false;
    // Browsers cap live contexts; give this one back at once.
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}
