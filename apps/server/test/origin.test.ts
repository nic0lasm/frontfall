import { describe, expect, it } from "vitest";
import { isAllowedOrigin } from "../src/origin.ts";

describe("isAllowedOrigin", () => {
  it("accepts everything when no origin is configured", () => {
    expect(isAllowedOrigin(undefined, undefined)).toBe(true);
    expect(isAllowedOrigin("https://example.com", "")).toBe(true);
  });

  it("accepts only the configured origin", () => {
    expect(isAllowedOrigin("https://nclsmgr.com", "https://nclsmgr.com")).toBe(true);
    expect(isAllowedOrigin("https://evil.example", "https://nclsmgr.com")).toBe(false);
    expect(isAllowedOrigin(undefined, "https://nclsmgr.com")).toBe(false);
  });
});
