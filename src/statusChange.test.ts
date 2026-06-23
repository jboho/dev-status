import { describe, expect, it } from "vitest";
import { diffOverallIndicators } from "./statusChange";
import type { StatuspageResponse } from "./types";

function sample(name: string, indicator: string): StatuspageResponse {
  return {
    page: { id: "1", name },
    status: { indicator, description: "" },
    components: [],
  };
}

describe("diffOverallIndicators", () => {
  it("returns empty when prev is null", () => {
    const next = { A: sample("A", "none") };
    expect(diffOverallIndicators(null, next)).toEqual([]);
  });

  it("returns empty when prev is empty object", () => {
    const next = { A: sample("A", "none") };
    expect(diffOverallIndicators({}, next)).toEqual([]);
  });

  it("returns empty when indicators unchanged", () => {
    const s = sample("A", "major");
    const prev = { A: s };
    const next = {
      A: { ...s, page: { ...s.page, name: "changed display only" } },
    };
    expect(diffOverallIndicators(prev, next)).toEqual([]);
  });

  it("detects case-only change as no diff (normalized)", () => {
    const prev = { A: sample("A", "NONE") };
    const next = { A: sample("A", "none") };
    expect(diffOverallIndicators(prev, next)).toEqual([]);
  });

  it("detects indicator change for a service", () => {
    const prev = { A: sample("A", "none") };
    const next = { A: sample("A", "major") };
    expect(diffOverallIndicators(prev, next)).toEqual([
      { name: "A", from: "none", to: "major" },
    ]);
  });

  it("ignores new service in next with no prev entry", () => {
    const prev = { A: sample("A", "none") };
    const next = {
      A: sample("A", "none"),
      B: sample("B", "major"),
    };
    expect(diffOverallIndicators(prev, next)).toEqual([]);
  });
});
