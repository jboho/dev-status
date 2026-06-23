import type { StatuspageResponse } from "./types";

type AwsEventLogEntry = {
  summary?: string;
  message?: string;
  status?: number | string;
  timestamp?: number | string;
};

type AwsHealthEvent = {
  arn?: string;
  date?: string;
  region_name?: string;
  status?: string;
  service_name?: string;
  summary?: string;
  event_log?: AwsEventLogEntry[];
};

function isAwsHealthRow(raw: unknown): raw is AwsHealthEvent {
  if (typeof raw !== "object" || raw === null) return false;
  const arn = (raw as { arn?: unknown }).arn;
  return typeof arn === "string" && arn.includes("arn:aws:health");
}

/** Decode AWS Health `data.json` (UTF-8, UTF-8 BOM, or UTF-16 BE/LE). */
export function parseAwsHealthDataBuffer(buffer: ArrayBuffer): unknown {
  const u8 = new Uint8Array(buffer);
  if (u8.length === 0) return [];
  if (u8.length < 2) {
    return JSON.parse(new TextDecoder("utf-8").decode(buffer));
  }
  if (u8[0] === 0xfe && u8[1] === 0xff) {
    return JSON.parse(new TextDecoder("utf-16be").decode(buffer.slice(2)));
  }
  if (u8[0] === 0xff && u8[1] === 0xfe) {
    return JSON.parse(new TextDecoder("utf-16le").decode(buffer.slice(2)));
  }
  let text = new TextDecoder("utf-8").decode(buffer);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return JSON.parse(text);
}

function eventLogEntryToStatus(entry: AwsEventLogEntry | undefined): string {
  if (!entry) return "degraded_performance";
  const st = entry.status;
  if (st === 0 || st === "0") return "operational";
  return "degraded_performance";
}

function truncateLine(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/** One row per region/service event, plus up to 5 timeline lines from `event_log` (public feed detail). */
function buildAwsComponentsFromEvents(events: AwsHealthEvent[]): Array<{
  id: string;
  name: string;
  status: string;
}> {
  const out: Array<{ id: string; name: string; status: string }> = [];
  let salt = 0;
  for (let ei = 0; ei < events.length; ei++) {
    const e = events[ei];
    const summary = e.summary ?? "Event";
    const mainName =
      [e.region_name, e.service_name].filter(Boolean).join(" · ") ||
      summary.slice(0, 80);
    const baseId = e.arn ?? `aws-event-${ei}`;
    out.push({
      id: baseId,
      name: mainName,
      status: summaryToComponentStatus(summary),
    });

    const log = e.event_log;
    if (!Array.isArray(log) || log.length === 0) continue;
    const take = Math.min(5, log.length);
    for (let li = 0; li < take; li++) {
      const entry = log[li];
      const rawLine =
        entry?.summary?.trim() ||
        entry?.message?.trim()?.split("\n")[0] ||
        "Update";
      const short = truncateLine(rawLine, 100);
      out.push({
        id: `${baseId}-log-${li}-${salt++}`,
        name: `↳ ${short}`,
        status: eventLogEntryToStatus(entry),
      });
    }
  }
  return out;
}

function summaryToComponentStatus(summary: string): string {
  const s = summary.toLowerCase();
  if (s.includes("full") && s.includes("outage")) return "major_outage";
  if (s.includes("outage") || s.includes("unavailable")) return "major_outage";
  if (s.includes("partial")) return "partial_outage";
  if (
    s.includes("degraded") ||
    s.includes("error") ||
    s.includes("issue") ||
    s.includes("latency") ||
    s.includes("connectivity")
  ) {
    return "degraded_performance";
  }
  return "operational";
}

function worstComponentStatus(statuses: string[]): string {
  const rank: Record<string, number> = {
    operational: 0,
    under_maintenance: 1,
    degraded_performance: 2,
    partial_outage: 3,
    major_outage: 4,
  };
  let worst = "operational";
  let r = 0;
  for (const s of statuses) {
    const n = rank[s] ?? 0;
    if (n > r) {
      r = n;
      worst = s;
    }
  }
  return worst;
}

function overallIndicatorFromComponents(components: { status: string }[]): {
  indicator: string;
  description: string;
} {
  const worst = worstComponentStatus(components.map((c) => c.status));
  if (worst === "operational") {
    return { indicator: "none", description: "All systems operational" };
  }
  if (worst === "major_outage" || worst === "partial_outage") {
    return {
      indicator: "major",
      description: "Service disruptions reported",
    };
  }
  if (worst === "degraded_performance") {
    return {
      indicator: "minor",
      description: "Performance issues reported",
    };
  }
  return {
    indicator: "maintenance",
    description: "Maintenance or limited availability",
  };
}

/** Map AWS Health `data.json` array to Statuspage-shaped payload for the UI. */
export function normalizeAwsDataJson(raw: unknown): StatuspageResponse {
  if (!Array.isArray(raw)) {
    return {
      page: {
        id: "aws",
        name: "AWS",
        url: "https://status.aws.amazon.com",
      },
      status: {
        indicator: "none",
        description: "Unable to parse AWS Health data",
      },
      components: [],
    };
  }

  if (raw.length === 0) {
    return {
      page: {
        id: "aws",
        name: "AWS",
        url: "https://status.aws.amazon.com",
      },
      status: {
        indicator: "none",
        description: "No open events on the public AWS Health feed",
      },
      components: [
        {
          id: "aws-feed-empty",
          name: "Public feed: no active events (see status.aws.amazon.com for history)",
          status: "operational",
        },
      ],
    };
  }

  if (!isAwsHealthRow(raw[0])) {
    return {
      page: {
        id: "aws",
        name: "AWS",
        url: "https://status.aws.amazon.com",
      },
      status: {
        indicator: "none",
        description: "Unexpected AWS Health data shape",
      },
      components: [],
    };
  }

  const events = raw as AwsHealthEvent[];
  const components = buildAwsComponentsFromEvents(events);

  const { indicator, description } =
    components.length === 0
      ? { indicator: "none", description: "All systems operational" }
      : overallIndicatorFromComponents(components);

  let updatedAt: string | undefined;
  let maxMs = 0;
  for (const e of events) {
    if (e.date) {
      const ms = Number(e.date) * 1000;
      if (!Number.isNaN(ms)) maxMs = Math.max(maxMs, ms);
    }
    if (Array.isArray(e.event_log)) {
      for (const entry of e.event_log) {
        if (entry?.timestamp == null) continue;
        const t = Number(entry.timestamp) * 1000;
        if (!Number.isNaN(t)) maxMs = Math.max(maxMs, t);
      }
    }
  }
  if (maxMs > 0) updatedAt = new Date(maxMs).toISOString();

  return {
    page: {
      id: "aws",
      name: "AWS",
      url: "https://status.aws.amazon.com",
      updated_at: updatedAt,
    },
    status: {
      indicator,
      description,
    },
    components,
  };
}

export function isAwsHealthDataUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.hostname === "status.aws.amazon.com" &&
      u.pathname.replace(/\/$/, "") === "/data.json"
    );
  } catch {
    return false;
  }
}
