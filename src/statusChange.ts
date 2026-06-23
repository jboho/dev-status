import type { StatuspageResponse } from "./types";

export type IndicatorChange = {
  name: string;
  from: string;
  to: string;
};

/** Compares page-level `status.indicator` per service. Omits when prev is null/empty (no baseline). */
export function diffOverallIndicators(
  prev: Record<string, StatuspageResponse> | null,
  next: Record<string, StatuspageResponse>,
): IndicatorChange[] {
  if (prev == null || Object.keys(prev).length === 0) {
    return [];
  }

  const out: IndicatorChange[] = [];
  for (const name of Object.keys(next)) {
    const p = prev[name];
    const n = next[name];
    if (p == null || n == null) continue;
    const from = p.status.indicator.toLowerCase();
    const to = n.status.indicator.toLowerCase();
    if (from !== to) {
      out.push({ name, from, to });
    }
  }
  return out;
}

export const STATUS_POLL_INTERVAL_MS = 300 * 1000;

export function formatPollIntervalLabel(): string {
  const m = Math.round(STATUS_POLL_INTERVAL_MS / 60_000);
  if (m <= 1) {
    return "1 minute";
  }
  return `${m} minutes`;
}
