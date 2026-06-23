import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AppConfig } from "./types";

/** Mirrors `default_config` in `src-tauri/src/lib.rs` */
export const DEFAULT_APP_CONFIG: AppConfig = {
  services: [
    {
      name: "GitHub",
      url: "https://www.githubstatus.com/api/v2/summary.json",
    },
    {
      name: "Vercel",
      url: "https://www.vercel-status.com/api/v2/summary.json",
    },
    {
      name: "Claude",
      url: "https://status.claude.com/api/v2/summary.json",
    },
    {
      name: "Cursor",
      url: "https://status.cursor.com/api/v2/summary.json",
    },
    {
      name: "OpenAI",
      url: "https://status.openai.com/api/v2/summary.json",
    },
    {
      name: "AWS",
      url: "https://status.aws.amazon.com/data.json",
    },
    {
      name: "Netlify",
      url: "https://www.netlifystatus.com/api/v2/summary.json",
    },
    {
      name: "npm",
      url: "https://status.npmjs.org/api/v2/summary.json",
    },
    {
      name: "Figma",
      url: "https://status.figma.com/api/v2/summary.json",
    },
    {
      name: "Cloudflare",
      url: "https://www.cloudflarestatus.com/api/v2/summary.json",
    },
    {
      name: "Stripe",
      url: "https://www.stripestatus.com/api/v2/summary.json",
    },
    {
      name: "Supabase",
      url: "https://status.supabase.com/api/v2/summary.json",
    },
    {
      name: "Twilio",
      url: "https://status.twilio.com/api/v2/summary.json",
    },
    {
      name: "MongoDB Atlas",
      url: "https://status.mongodb.com/api/v2/summary.json",
    },
    {
      name: "Datadog",
      url: "https://status.datadoghq.com/api/v2/summary.json",
    },
    {
      name: "Linear",
      url: "https://linearstatus.com/api/v2/summary.json",
    },
    {
      name: "Notion",
      url: "https://www.notion-status.com/api/v2/summary.json",
    },
  ],
};

const BROWSER_STORAGE_KEY = "dev-status.config.v1";

/**
 * URL migrations for feeds that moved. Stripe switched from apex to www;
 * Linear moved from status.linear.app to linearstatus.com; Notion moved off
 * status.notion.so — all old URLs redirect to HTML and break JSON.parse.
 */
const LEGACY_URL_FIXES: Record<string, string> = {
  "https://status.notion.so/api/v2/summary.json":
    "https://www.notion-status.com/api/v2/summary.json",
  "https://stripestatus.com/api/v2/summary.json":
    "https://www.stripestatus.com/api/v2/summary.json",
  "https://status.linear.app/api/v2/summary.json":
    "https://linearstatus.com/api/v2/summary.json",
};

function applyLegacyUrlFixes(config: AppConfig): AppConfig {
  const services = config.services.map((s) => {
    const nextUrl = LEGACY_URL_FIXES[s.url];
    return nextUrl ? { ...s, url: nextUrl } : s;
  });
  return { ...config, services };
}

/** Services whose status feeds have been retired or consolidated. */
const LEGACY_REMOVED_NAMES = new Set(["Anthropic", "Redis"]);

function removeLegacyServices(config: AppConfig): AppConfig {
  return {
    ...config,
    services: config.services.filter((s) => !LEGACY_REMOVED_NAMES.has(s.name)),
  };
}

/** Append any default services missing from saved config (by name), preserving order. */
function mergeMissingDefaultServices(config: AppConfig): AppConfig {
  const seen = new Set(config.services.map((s) => s.name));
  const merged = [...config.services];
  for (const def of DEFAULT_APP_CONFIG.services) {
    if (!seen.has(def.name)) {
      merged.push({ ...def });
      seen.add(def.name);
    }
  }
  return { ...config, services: merged };
}

export async function loadAppConfig(): Promise<AppConfig> {
  let loaded: AppConfig;

  if (isTauri()) {
    const json = await invoke<string>("get_config");
    loaded = JSON.parse(json) as AppConfig;
  } else {
    try {
      const raw = localStorage.getItem(BROWSER_STORAGE_KEY);
      if (raw) {
        loaded = JSON.parse(raw) as AppConfig;
      } else {
        return structuredClone(DEFAULT_APP_CONFIG);
      }
    } catch {
      return structuredClone(DEFAULT_APP_CONFIG);
    }
  }

  const merged = mergeMissingDefaultServices(
    applyLegacyUrlFixes(removeLegacyServices(loaded)),
  );
  if (JSON.stringify(merged) !== JSON.stringify(loaded)) {
    await persistAppConfig(merged);
  }
  return merged;
}

/** Synchronous write for browser (e.g. beforeunload flush). */
export function persistBrowserConfigSync(next: AppConfig): void {
  try {
    localStorage.setItem(BROWSER_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
}

export async function persistAppConfig(next: AppConfig): Promise<void> {
  if (isTauri()) {
    await invoke("save_config", { config: JSON.stringify(next) });
    return;
  }
  persistBrowserConfigSync(next);
}
