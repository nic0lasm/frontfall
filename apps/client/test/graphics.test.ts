import { describe, expect, it } from "vitest";
import {
  BALANCED,
  QUALITY,
  SAVER,
  chooseProfile,
  isLowEnd,
  isPhone,
  learnedSaver,
  rememberSaver,
} from "../src/ui/graphics.ts";

const laptop = { touch: false, shortSide: 900, memoryGb: 8, cores: 10 };
const phone = { touch: true, shortSide: 390, memoryGb: undefined, cores: 6 };
const weakPhone = { touch: true, shortSide: 360, memoryGb: 2, cores: 8 };
const tablet = { touch: true, shortSide: 820, memoryGb: undefined, cores: 8 };

describe("graphics profile", () => {
  it("keeps a mode the player chose, whatever the device", () => {
    expect(chooseProfile("quality", weakPhone, true)).toBe(QUALITY);
    expect(chooseProfile("saver", laptop, false)).toBe(SAVER);
  });

  it("gives auto the full picture to a laptop or a tablet, a lighter one to a phone", () => {
    expect(chooseProfile("auto", laptop, false)).toBe(QUALITY);
    expect(chooseProfile("auto", tablet, false)).toBe(QUALITY);
    expect(chooseProfile("auto", phone, false)).toBe(BALANCED);
  });

  it("gives auto the light picture to a weak device or one that proved too slow", () => {
    expect(chooseProfile("auto", weakPhone, false)).toBe(SAVER);
    expect(chooseProfile("auto", laptop, true)).toBe(SAVER);
  });

  it("tells phones and weak devices apart", () => {
    expect(isPhone(phone)).toBe(true);
    expect(isPhone(tablet)).toBe(false);
    expect(isPhone({ ...laptop, shortSide: 500 })).toBe(false);
    expect(isLowEnd({ ...laptop, cores: 2 })).toBe(true);
    expect(isLowEnd({ ...laptop, cores: 4 })).toBe(false);
    expect(isLowEnd({ ...phone, cores: 4 })).toBe(true);
    expect(isLowEnd(phone)).toBe(false);
  });

  it("remembers a slow device, and copes with storage that refuses", () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    };
    expect(learnedSaver(storage)).toBe(false);
    rememberSaver(storage);
    expect(learnedSaver(storage)).toBe(true);
    const refusing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(learnedSaver(refusing)).toBe(false);
    expect(() => {
      rememberSaver(refusing);
    }).not.toThrow();
    expect(learnedSaver(undefined)).toBe(false);
  });
});
