export interface ServiceConfig {
  name: string;
  url: string;
  /** Omitted or `true` = shown on dashboard; `false` = hidden (still in list for settings). */
  enabled?: boolean;
}

export function isServiceEnabled(s: ServiceConfig): boolean {
  return s.enabled !== false;
}

export interface AppConfig {
  services: ServiceConfig[];
}

export interface StatuspageComponent {
  id: string;
  name: string;
  status: string; // "operational", "degraded_performance", "partial_outage", "major_outage", "under_maintenance"
  description?: string;
}

export interface StatuspageStatus {
  indicator: string; // "none", "minor", "major", "critical", "maintenance"
  description: string;
}

export interface StatuspageResponse {
  page: {
    id: string;
    name: string;
    /** May be missing on some feeds; use `resolveStatusPageHref` + config URL. */
    url?: string;
    /** ISO 8601 from Statuspage summary API when present */
    updated_at?: string;
  };
  status: StatuspageStatus;
  components: StatuspageComponent[];
}
