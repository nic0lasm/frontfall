import { describe, expect, it, vi } from "vitest";
import { type ContextSource, hasWebGL2 } from "../src/webgl-support.ts";

describe("hasWebGL2", () => {
  it("accepts a browser that creates a context, and releases it", () => {
    const loseContext = vi.fn();
    const canvas: ContextSource = {
      getContext: () => ({ getExtension: () => ({ loseContext }) }),
    };
    expect(hasWebGL2(() => canvas)).toBe(true);
    expect(loseContext).toHaveBeenCalledOnce();
  });

  it("accepts a context that cannot be released early", () => {
    expect(hasWebGL2(() => ({ getContext: () => ({ getExtension: () => null }) }))).toBe(true);
  });

  it("refuses when there is no context or creating one throws", () => {
    expect(hasWebGL2(() => ({ getContext: () => null }))).toBe(false);
    expect(
      hasWebGL2(() => ({
        getContext: () => {
          throw new Error("blocked");
        },
      })),
    ).toBe(false);
  });

  it("refuses outside a browser", () => {
    expect(hasWebGL2()).toBe(false);
  });
});
