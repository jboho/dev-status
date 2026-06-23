import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  isAwsHealthDataUrl,
  normalizeAwsDataJson,
  parseAwsHealthDataBuffer,
} from "./awsHealthStatus";
import type { ServiceConfig, StatuspageResponse } from "./types";

/** In Vite dev (browser only), AWS Health JSON has no CORS — proxy avoids a silent fetch failure. */
export function resolveAwsProxyUrlForBrowser(configUrl: string): string {
  if (
    typeof import.meta !== "undefined" &&
    import.meta.env.DEV &&
    !isTauri() &&
    isAwsHealthDataUrl(configUrl)
  ) {
    return "/api/aws-health";
  }
  return configUrl;
}

export function utf8JsonParse(buffer: ArrayBuffer): unknown {
  const u8 = new Uint8Array(buffer);
  let text = new TextDecoder("utf-8").decode(u8);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return JSON.parse(text);
}

/** Load URL bytes: Rust in Tauri (no CORS), fetch in browser. */
export async function fetchUrlBytes(url: string): Promise<ArrayBuffer> {
  if (isTauri()) {
    const bytes = await invoke<number[]>("fetch_status_body", { url });
    return new Uint8Array(bytes).buffer;
  }
  // Only CORS-safelisted headers here: Cache-Control/Pragma would force an OPTIONS
  // preflight, which statuspage feeds answer with a redirect (CORS-illegal). `cache:
  // "no-store"` busts the HTTP cache without adding a header.
  const res = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`HTTP error! status: ${res.status}`);
  }
  return res.arrayBuffer();
}

/** Fetch + parse one service into a StatuspageResponse. Throws on HTTP/parse failure. */
export async function fetchOneService(
  service: ServiceConfig,
): Promise<StatuspageResponse> {
  if (isAwsHealthDataUrl(service.url)) {
    const urlToFetch = resolveAwsProxyUrlForBrowser(service.url);
    const buf = await fetchUrlBytes(urlToFetch);
    return normalizeAwsDataJson(parseAwsHealthDataBuffer(buf));
  }
  if (isTauri()) {
    const buf = await fetchUrlBytes(service.url);
    return utf8JsonParse(buf) as StatuspageResponse;
  }
  // Safelisted headers only — see fetchUrlBytes: avoid a CORS preflight the
  // statuspage feeds reject with a redirect.
  const response = await fetch(service.url, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return (await response.json()) as StatuspageResponse;
}
