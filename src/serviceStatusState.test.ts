import { describe, expect, it } from "vitest";
import {
  applyFetchResult,
  deriveServiceState,
  emptyFetchState,
  type ServiceFetchState,
} from "./serviceStatusState";
import type { StatuspageResponse } from "./types";

const resp = (indicator: string): StatuspageResponse => ({
  page: { id: "p", name: "Demo" },
  status: { indicator, description: indicator },
  components: [],
});

describe("applyFetchResult", () => {
  it("success sets data + lastSuccessAt and clears any prior error", () => {
    const prev: ServiceFetchState = {
      statuses: {},
      errors: { GitHub: "HTTP error! status: 500" },
      lastSuccessAt: {},
    };
    const next = applyFetchResult(prev, "GitHub", {
      ok: true,
      data: resp("none"),
      at: 1000,
    });
    expect(next.statuses.GitHub).toEqual(resp("none"));
    expect(next.lastSuccessAt.GitHub).toBe(1000);
    expect(next.errors.GitHub).toBeUndefined();
  });

  it("failure with prior data keeps the data and records the error (stale)", () => {
    const prev: ServiceFetchState = {
      statuses: { GitHub: resp("none") },
      errors: {},
      lastSuccessAt: { GitHub: 500 },
    };
    const next = applyFetchResult(prev, "GitHub", {
      ok: false,
      message: "timeout",
    });
    expect(next.statuses.GitHub).toEqual(resp("none"));
    expect(next.lastSuccessAt.GitHub).toBe(500);
    expect(next.errors.GitHub).toBe("timeout");
  });

  it("failure with no prior data records the error and leaves no data (failed)", () => {
    const next = applyFetchResult(emptyFetchState, "Stripe", {
      ok: false,
      message: "HTTP error! status: 404",
    });
    expect(next.statuses.Stripe).toBeUndefined();
    expect(next.errors.Stripe).toBe("HTTP error! status: 404");
  });

  it("does not mutate the previous state", () => {
    const prev = emptyFetchState;
    applyFetchResult(prev, "X", { ok: false, message: "e" });
    expect(prev.errors.X).toBeUndefined();
  });
});

describe("deriveServiceState", () => {
  it("returns ok with data and no error", () => {
    expect(deriveServiceState("A", { A: resp("none") }, {})).toBe("ok");
  });
  it("returns stale with data and an error", () => {
    expect(deriveServiceState("A", { A: resp("none") }, { A: "e" })).toBe(
      "stale",
    );
  });
  it("returns failed with an error and no data", () => {
    expect(deriveServiceState("A", {}, { A: "e" })).toBe("failed");
  });
  it("returns pending with neither", () => {
    expect(deriveServiceState("A", {}, {})).toBe("pending");
  });
});
