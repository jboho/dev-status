import { describe, expect, it } from "vitest";
import { isServiceEnabled } from "./types";

describe("isServiceEnabled", () => {
  it("treats omitted enabled as true", () => {
    expect(isServiceEnabled({ name: "a", url: "u" })).toBe(true);
  });

  it("treats enabled true as true", () => {
    expect(isServiceEnabled({ name: "a", url: "u", enabled: true })).toBe(true);
  });

  it("treats enabled false as false", () => {
    expect(isServiceEnabled({ name: "a", url: "u", enabled: false })).toBe(
      false,
    );
  });
});
