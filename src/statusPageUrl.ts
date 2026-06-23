import type { StatuspageResponse } from "./types";

/** Human-readable status page URL; falls back when API omits or returns a bad `page.url`. */
export function resolveStatusPageHref(
  data: StatuspageResponse,
  apiUrl: string,
): string {
  const raw = data.page?.url?.trim();
  if (raw && /^https?:\/\//i.test(raw)) {
    return raw;
  }
  try {
    const u = new URL(apiUrl);
    if (u.pathname.includes("/api/v2/summary.json")) {
      return u.href.replace(/\/api\/v2\/summary\.json.*$/i, "");
    }
    if (
      u.hostname === "status.aws.amazon.com" &&
      u.pathname.replace(/\/$/, "") === "/data.json"
    ) {
      return "https://status.aws.amazon.com/";
    }
    return `${u.origin}/`;
  } catch {
    return "https://status.aws.amazon.com/";
  }
}
