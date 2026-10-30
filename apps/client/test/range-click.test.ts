import { describe, expect, it } from "vitest";
import { paintFill } from "../src/ui/range-click.ts";

/** Just what `paintFill` touches of a range input. */
function slider(min: string, max: string, value: string) {
  const set = new Map<string, string>();
  const input = {
    min,
    max,
    value,
    style: {
      setProperty: (name: string, text: string): void => {
        set.set(name, text);
      },
    },
  };
  return { input: input as unknown as HTMLInputElement, set };
}

describe("paintFill", () => {
  it("tells the styles how far along the track the value is", () => {
    const { input, set } = slider("5", "100", "52.5");
    paintFill(input);
    expect(set.get("--fill")).toBe("0.5");
  });

  it("starts at zero and ends at one", () => {
    const low = slider("0", "80", "0");
    paintFill(low.input);
    expect(low.set.get("--fill")).toBe("0");
    const high = slider("0", "80", "80");
    paintFill(high.input);
    expect(high.set.get("--fill")).toBe("1");
  });

  it("falls back to zero on a track with no length", () => {
    const { input, set } = slider("5", "5", "5");
    paintFill(input);
    expect(set.get("--fill")).toBe("0");
  });
});
