import type { StatuspageResponse } from "./types";

export type ServiceFetchState = {
  statuses: Record<string, StatuspageResponse>;
  errors: Record<string, string>;
  lastSuccessAt: Record<string, number>;
};

export type FetchResult =
  | { ok: true; data: StatuspageResponse; at: number }
  | { ok: false; message: string };

export type ServiceDisplayState = "ok" | "stale" | "failed" | "pending";

export const emptyFetchState: ServiceFetchState = {
  statuses: {},
  errors: {},
  lastSuccessAt: {},
};

/** Merge one fetch result into prev. Success clears the error; failure keeps prior data (stale). Pure. */
export function applyFetchResult(
  prev: ServiceFetchState,
  name: string,
  result: FetchResult,
): ServiceFetchState {
  if (result.ok) {
    const errors = { ...prev.errors };
    delete errors[name];
    return {
      statuses: { ...prev.statuses, [name]: result.data },
      errors,
      lastSuccessAt: { ...prev.lastSuccessAt, [name]: result.at },
    };
  }
  return {
    statuses: prev.statuses,
    errors: { ...prev.errors, [name]: result.message },
    lastSuccessAt: prev.lastSuccessAt,
  };
}

export function deriveServiceState(
  name: string,
  statuses: Record<string, StatuspageResponse>,
  errors: Record<string, string>,
): ServiceDisplayState {
  const hasData = statuses[name] != null;
  const hasError = errors[name] != null;
  if (hasData && hasError) return "stale";
  if (hasData) return "ok";
  if (hasError) return "failed";
  return "pending";
}
