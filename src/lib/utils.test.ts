import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("merges tailwind classes with last-wins behavior", () => {
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
  });

  it("omits classes when a condition is false", () => {
    const showBadge = false;
    expect(cn("base", showBadge && "ring-2", "block")).toBe("base block");
  });
});
