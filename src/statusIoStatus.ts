import type { StatuspageResponse } from "./types";

type StatusIoComponent = {
  id?: string;
  name?: string;
  status?: string;
  status_code?: number;
  updated?: string;
};

type StatusIoResult = {
  status_overall?: {
    updated?: string;
    status?: string;
    status_code?: number;
  };
  status?: StatusIoComponent[];
};

/** Public pages for status.io page IDs; the API response doesn't carry the page URL. */
const KNOWN_PAGES: Record<string, { name: string; url: string }> = {
  "5b36dc6502d06804c08349f7": {
    name: "GitLab",
    url: "https://status.gitlab.com",
  },
};

const STATUS_IO_PATH = /^\/1\.0\/status\/([0-9a-f]{24})\/?$/i;

export function statusIoPageId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname !== "api.status.io") return null;
    return STATUS_IO_PATH.exec(u.pathname)?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

export function isStatusIoUrl(url: string): boolean {
  return statusIoPageId(url) !== null;
}

/**
 * status.io codes (kb.status.io/developers/status-codes): 100 operational,
 * 200 maintenance, 300 degraded, 400 partial disruption, 500 disruption,
 * 600 security event. An unknown code is shown as degraded, not operational.
 */
function componentStatus(code: number | undefined): string {
  switch (code) {
    case 100:
      return "operational";
    case 200:
      return "under_maintenance";
    case 400:
      return "partial_outage";
    case 500:
    case 600:
      return "major_outage";
    default:
      return "degraded_performance";
  }
}

function overallIndicator(code: number | undefined): string {
  switch (code) {
    case 100:
      return "none";
    case 200:
      return "maintenance";
    case 400:
      return "major";
    case 500:
    case 600:
      return "critical";
    default:
      return "minor";
  }
}

/** Map a status.io `/1.0/status/{id}` payload to the Statuspage shape the UI renders. */
export function normalizeStatusIoJson(
  raw: unknown,
  pageId: string,
): StatuspageResponse {
  const known = KNOWN_PAGES[pageId];
  const page = {
    id: pageId,
    name: known?.name ?? "status.io",
    url: known?.url ?? `https://status.io/pages/${pageId}`,
  };
  const result = (raw as { result?: StatusIoResult } | null)?.result;
  const overall = result?.status_overall;
  if (!overall || !Array.isArray(result.status)) {
    throw new Error("Unexpected status.io data shape");
  }

  const components = result.status.map((c, i) => ({
    id: c.id ?? `${pageId}-${i}`,
    name: c.name ?? "Component",
    status: componentStatus(c.status_code),
  }));

  return {
    page: { ...page, updated_at: overall.updated },
    status: {
      indicator: overallIndicator(overall.status_code),
      description: overall.status ?? "Unknown",
    },
    components,
  };
}
