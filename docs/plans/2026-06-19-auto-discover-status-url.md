# Auto-Discover Canonical Status URL on Retry — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user retries a failed/stale service, attempt to discover a working canonical status URL (primarily by resolving redirects), validate it returns real Statuspage JSON, persist it to config, and surface a dismissible notice — so feeds that move hosts self-heal instead of requiring a hardcoded `LEGACY_URL_FIXES` entry.

**Architecture:** A new pure-ish module `statusUrlDiscovery.ts` owns candidate generation, response-shape validation, and the platform-aware `discoverWorkingUrl(service)` orchestration. On Tauri it calls a new Rust command `resolve_status_url` (reqwest follows redirects and reports the final URL); in the browser it probes the original URL plus `www`-toggled candidates (browsers cannot read cross-origin redirect targets). `useStatusData.retryService` runs discovery first: on success it applies the data and, if the resolved URL differs, persists it via a new `updateServiceUrl` and records a `urlUpdates` entry; `App.tsx` renders a small dismissible toast for those updates.

**Tech Stack:** React + TypeScript, Vite, Vitest (jsdom) + @testing-library/react, Tauri (Rust `reqwest`).

---

## Design decisions (defaults chosen; change before/while executing if desired)

- **Trigger = explicit Retry only.** Discovery does NOT run during normal polling, to avoid surprise config mutations. (Polling keeps using the stored URL.)
- **Auto-apply with a visible, undoable notice** (recommended) rather than a confirm dialog. Changing a status URL is non-destructive and reversible from the Services screen; a dismissible toast keeps it transparent. If you prefer confirm-first, swap the toast for a confirm prompt in Task 5.
- **Platform reality:**
  - **Tauri (shipped app):** backend follows redirects and returns the final URL → full discovery + canonicalization. This is the primary value.
  - **Browser (dev):** cannot read cross-origin redirect `Location` (opaque redirects). Discovery is best-effort: try the original URL, then `www`-toggled hosts. Cross-domain moves (e.g. `status.linear.app` → `linearstatus.com`) are NOT browser-discoverable and remain covered by the static `LEGACY_URL_FIXES` map.
- **AWS is excluded** from generic discovery (`isAwsHealthDataUrl`) — it has its own parser/proxy path.
- **`LEGACY_URL_FIXES` / `LEGACY_REMOVED_URLS` stay** as a fast bootstrap on load. Discovery generalizes them; retiring those maps is out of scope.

---

## File structure

- **Create** `src/statusUrlDiscovery.ts` — `isStatuspageResponse` (validator), `generateCandidateUrls` (host transforms), `discoverWorkingUrl(service)` (platform-aware orchestration), `DiscoveredUrl` type.
- **Create** `src/statusUrlDiscovery.test.ts` — unit tests for the validator, candidate generation, and `discoverWorkingUrl` (browser path with mocked `fetch`).
- **Modify** `src/statusFetch.ts` — export a small reusable `tryParseStatuspageBytes` is NOT needed; reuse existing `utf8JsonParse`. (No code change expected; listed only if an export is missing — verify `utf8JsonParse` is exported.)
- **Modify** `src-tauri/src/lib.rs` — add `resolve_status_url` command (+ `ResolvedStatus` struct) and register it in `generate_handler!`.
- **Modify** `src/useStatusData.ts` — `retryService` runs `discoverWorkingUrl`; add `updateServiceUrl`, `urlUpdates` state + `dismissUrlUpdate`; return them.
- **Create** `src/UrlUpdateToast.tsx` — dismissible notice listing `{name → newHost}` updates.
- **Create** `src/UrlUpdateToast.test.tsx` — RTL tests for the toast.
- **Modify** `src/App.tsx` — consume `urlUpdates`/`dismissUrlUpdate`; render `<UrlUpdateToast>`.
- **Modify** `CHANGELOG.md` — Added entry.

---

### Task 1: Discovery primitives — validator + candidate generation

**Files:**

- Create: `src/statusUrlDiscovery.ts`
- Test: `src/statusUrlDiscovery.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  generateCandidateUrls,
  isStatuspageResponse,
} from "./statusUrlDiscovery";

describe("isStatuspageResponse", () => {
  it("accepts a well-formed Statuspage payload", () => {
    expect(
      isStatuspageResponse({
        page: { id: "p", name: "Demo" },
        status: { indicator: "none", description: "ok" },
        components: [],
      }),
    ).toBe(true);
  });

  it("rejects HTML/string bodies", () => {
    expect(isStatuspageResponse("<!doctype html>")).toBe(false);
  });

  it("rejects objects missing required fields", () => {
    expect(isStatuspageResponse({ page: { id: "p" } })).toBe(false);
    expect(isStatuspageResponse({ status: { indicator: "none" } })).toBe(false);
    expect(isStatuspageResponse(null)).toBe(false);
    expect(isStatuspageResponse([])).toBe(false);
  });
});

describe("generateCandidateUrls", () => {
  it("adds the www host for an apex URL", () => {
    expect(
      generateCandidateUrls("https://stripestatus.com/api/v2/summary.json"),
    ).toEqual(["https://www.stripestatus.com/api/v2/summary.json"]);
  });

  it("strips www for a www URL", () => {
    expect(
      generateCandidateUrls("https://www.stripestatus.com/api/v2/summary.json"),
    ).toEqual(["https://stripestatus.com/api/v2/summary.json"]);
  });

  it("preserves path and query, returns [] for invalid input", () => {
    expect(
      generateCandidateUrls("https://status.foo.com/api/v2/summary.json?x=1"),
    ).toEqual(["https://www.status.foo.com/api/v2/summary.json?x=1"]);
    expect(generateCandidateUrls("not a url")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm test:run src/statusUrlDiscovery.test.ts`
Expected: FAIL — `Failed to resolve import "./statusUrlDiscovery"`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/statusUrlDiscovery.ts` with the pure helpers (orchestration added in Task 3):

```ts
import type { StatuspageResponse } from "./types";

export type DiscoveredUrl = { url: string; data: StatuspageResponse };

/** True only for a parsed object shaped like a Statuspage summary feed (rejects HTML/strings/arrays). */
export function isStatuspageResponse(v: unknown): v is StatuspageResponse {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  const page = o.page as Record<string, unknown> | undefined;
  const status = o.status as Record<string, unknown> | undefined;
  return (
    typeof page === "object" &&
    page !== null &&
    typeof status === "object" &&
    status !== null &&
    typeof status.indicator === "string" &&
    Array.isArray(o.components)
  );
}

/** Conservative host transforms (apex <-> www). Same protocol/path/query. Excludes the input. */
export function generateCandidateUrls(rawUrl: string): string[] {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return [];
  }
  const candidates = new Set<string>();
  const toggled = u.host.startsWith("www.") ? u.host.slice(4) : `www.${u.host}`;
  const alt = new URL(u.toString());
  alt.host = toggled;
  candidates.add(alt.toString());
  candidates.delete(u.toString());
  return [...candidates];
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm test:run src/statusUrlDiscovery.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/statusUrlDiscovery.ts src/statusUrlDiscovery.test.ts
git commit -m "feat: status URL discovery primitives (validator + candidates)"
```

---

### Task 2: Rust `resolve_status_url` command (redirect-following resolver)

Tauri-only. Returns the final URL after following redirects plus the body bytes, so the frontend can adopt the canonical URL. Mirrors the existing `fetch_status_body` client config.

**Files:**

- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the command + return struct**

Add near `fetch_status_body` (after it, before `get_config_path`):

```rust
#[derive(serde::Serialize)]
struct ResolvedStatus {
    url: String,
    body: Vec<u8>,
}

/// Follow redirects and report the final URL + body. Used to canonicalize status URLs that 30x.
#[tauri::command]
async fn resolve_status_url(url: String) -> Result<ResolvedStatus, String> {
    if !url.starts_with("https://") {
        return Err("refusing non-https status URL".into());
    }
    let resp = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?
        .get(&url)
        .header("User-Agent", "dev-status/1.0")
        .header("Accept", "application/json")
        .header("Cache-Control", "no-cache")
        .header("Pragma", "no-cache")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let final_url = resp.url().to_string();
    let body = resp
        .bytes()
        .await
        .map_err(|e| e.to_string())?
        .to_vec();
    Ok(ResolvedStatus {
        url: final_url,
        body,
    })
}
```

- [ ] **Step 2: Register the command**

Update the handler list (currently `tauri::generate_handler![get_config, save_config, fetch_status_body]`):

```rust
.invoke_handler(tauri::generate_handler![
    get_config,
    save_config,
    fetch_status_body,
    resolve_status_url
])
```

- [ ] **Step 3: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: `Finished` with no errors. (`serde` is already a transitive/dev dep via Tauri; if `cargo check` complains that `serde` isn't a direct dependency for the derive, add it: `cargo add serde --features derive`.)

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat: resolve_status_url Tauri command for redirect canonicalization"
```

---

### Task 3: `discoverWorkingUrl` orchestration

Adds the platform-aware orchestration to `statusUrlDiscovery.ts`. Tauri resolves via the backend (follows redirects in one call, then tries `www` candidates); browser probes the original URL then candidates with `fetch` (can't read cross-origin redirects). AWS-health URLs are skipped.

**Files:**

- Modify: `src/statusUrlDiscovery.ts`
- Test: `src/statusUrlDiscovery.test.ts`
- Verify: `src/statusFetch.ts` exports `utf8JsonParse` (it does as of this writing — used here).

- [ ] **Step 1: Write the failing test** (append to `src/statusUrlDiscovery.test.ts`)

```ts
import { afterEach, vi } from "vitest";
import { discoverWorkingUrl } from "./statusUrlDiscovery";
import type { ServiceConfig } from "./types";

const ok = {
  page: { id: "p", name: "Stripe" },
  status: { indicator: "none", description: "ok" },
  components: [],
};

describe("discoverWorkingUrl (browser path)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("adopts the www candidate when the apex fails and www returns valid JSON", async () => {
    const svc: ServiceConfig = {
      name: "Stripe",
      url: "https://stripestatus.com/api/v2/summary.json",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (input.includes("www."))
          return new Response(JSON.stringify(ok), {
            status: 200,
            url: "https://www.stripestatus.com/api/v2/summary.json",
          });
        return Promise.reject(new TypeError("Failed to fetch"));
      }),
    );
    const found = await discoverWorkingUrl(svc);
    expect(found?.url).toContain("www.stripestatus.com");
    expect(found?.data).toEqual(ok);
  });

  it("returns null when every candidate returns HTML (not Statuspage JSON)", async () => {
    const svc: ServiceConfig = {
      name: "Redis",
      url: "https://status.redis.com/api/v2/summary.json",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<!doctype html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
      ),
    );
    expect(await discoverWorkingUrl(svc)).toBeNull();
  });

  it("skips AWS-health URLs", async () => {
    const svc: ServiceConfig = {
      name: "AWS",
      url: "https://status.aws.amazon.com/data.json",
    };
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await discoverWorkingUrl(svc)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});
```

> Note: in jsdom `isTauri()` is `false`, so these exercise the browser branch. `new Response(body, { url })` — jsdom's `Response` ignores the `url` init option, so `discoverWorkingUrl` falls back to the requested candidate URL; the assertion uses `toContain("www.")` which holds either way.

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm test:run src/statusUrlDiscovery.test.ts`
Expected: FAIL — `discoverWorkingUrl is not exported`.

- [ ] **Step 3: Write the implementation** (append to `src/statusUrlDiscovery.ts`)

Add imports at the top of the file:

```ts
import { invoke, isTauri } from "@tauri-apps/api/core";
import { isAwsHealthDataUrl } from "./awsHealthStatus";
import { utf8JsonParse } from "./statusFetch";
import type { ServiceConfig, StatuspageResponse } from "./types";
```

> `StatuspageResponse` is already imported in Task 1 — merge the type imports into the single `./types` import line (`import type { ServiceConfig, StatuspageResponse } from "./types";`). Verify no circular import: `statusFetch.ts` must not import from `statusUrlDiscovery.ts` (it does not).

Append:

```ts
async function tryResolveTauri(url: string): Promise<DiscoveredUrl | null> {
  try {
    const r = await invoke<{ url: string; body: number[] }>(
      "resolve_status_url",
      { url },
    );
    const parsed = utf8JsonParse(new Uint8Array(r.body).buffer);
    if (isStatuspageResponse(parsed)) return { url: r.url, data: parsed };
  } catch {
    /* unreachable host / non-2xx / parse error — treat as no match */
  }
  return null;
}

async function tryFetchBrowser(url: string): Promise<DiscoveredUrl | null> {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const parsed = (await res.json()) as unknown;
    if (isStatuspageResponse(parsed)) {
      return { url: res.url || url, data: parsed };
    }
  } catch {
    /* CORS-blocked redirect / network error / non-JSON — treat as no match */
  }
  return null;
}

/**
 * Find a working canonical URL for a service.
 * Tauri: backend follows redirects in one call, then tries www-toggled candidates.
 * Browser: probes the original URL then candidates (cannot read cross-origin redirects).
 * AWS-health URLs are skipped (dedicated path). Returns null if nothing valid is found.
 */
export async function discoverWorkingUrl(
  service: ServiceConfig,
): Promise<DiscoveredUrl | null> {
  if (isAwsHealthDataUrl(service.url)) return null;

  if (isTauri()) {
    const direct = await tryResolveTauri(service.url);
    if (direct) return direct;
    for (const candidate of generateCandidateUrls(service.url)) {
      const found = await tryResolveTauri(candidate);
      if (found) return found;
    }
    return null;
  }

  for (const candidate of [
    service.url,
    ...generateCandidateUrls(service.url),
  ]) {
    const found = await tryFetchBrowser(candidate);
    if (found) return found;
  }
  return null;
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm test:run src/statusUrlDiscovery.test.ts`
Expected: PASS (10 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/statusUrlDiscovery.ts src/statusUrlDiscovery.test.ts
git commit -m "feat: discoverWorkingUrl orchestration (tauri + browser)"
```

---

### Task 4: Wire discovery into `useStatusData.retryService`

Integration task — the hook is not unit-tested in this repo (see the surface-service-fetch-errors plan). Verify via typecheck/build and existing tests. Do **not** invent a hook unit test.

**Files:**

- Modify: `src/useStatusData.ts`

- [ ] **Step 1: Add imports**

Add to the existing imports:

```ts
import { discoverWorkingUrl } from "./statusUrlDiscovery";
```

`persistAppConfig` is already imported from `./configStorage`. `AppConfig` is already imported from `./types`.

- [ ] **Step 2: Add `urlUpdates` state** (next to the existing `retrying` state)

```ts
const [urlUpdates, setUrlUpdates] = useState<{ name: string; url: string }[]>(
  [],
);
```

- [ ] **Step 3: Add `updateServiceUrl`** (place near `saveConfig`)

```ts
const updateServiceUrl = useCallback(async (name: string, url: string) => {
  const c = configRef.current;
  if (!c) return;
  const next: AppConfig = {
    ...c,
    services: c.services.map((s) => (s.name === name ? { ...s, url } : s)),
  };
  await persistAppConfig(next);
  configRef.current = next;
  setConfig(next);
}, []);
```

- [ ] **Step 4: Replace `retryService`** with the discovery-first implementation

```ts
const retryService = useCallback(
  async (name: string) => {
    const service = configRef.current?.services.find((s) => s.name === name);
    if (!service) return;
    setRetrying((r) => ({ ...r, [name]: true }));
    let result: FetchResult;
    try {
      const found = await discoverWorkingUrl(service);
      if (found) {
        result = { ok: true, data: found.data, at: Date.now() };
        if (found.url !== service.url) {
          await updateServiceUrl(name, found.url);
          setUrlUpdates((u) => [
            ...u.filter((x) => x.name !== name),
            { name, url: found.url },
          ]);
        }
      } else {
        // Nothing discoverable — do a plain fetch to surface the real error message.
        try {
          const data = await fetchOneService(service);
          result = { ok: true, data, at: Date.now() };
        } catch (err) {
          console.error(`Failed to fetch status for ${service.name}`, err);
          result = {
            ok: false,
            message: err instanceof Error ? err.message : String(err),
          };
        }
      }
    } finally {
      setRetrying((r) => ({ ...r, [name]: false }));
    }
    const next = applyFetchResult(fetchStateRef.current, name, result);
    fetchStateRef.current = next;
    setFetchState(next);
  },
  [updateServiceUrl],
);
```

- [ ] **Step 5: Add `dismissUrlUpdate` and extend the return value**

```ts
const dismissUrlUpdate = useCallback((name: string) => {
  setUrlUpdates((u) => u.filter((x) => x.name !== name));
}, []);
```

Add `urlUpdates` and `dismissUrlUpdate` to the hook's returned object (alongside `retrying`, `retryService`).

- [ ] **Step 6: Verify typecheck + existing tests pass**

Run: `pnpm test:run`
Expected: all existing tests PASS. (App.tsx consumes the new fields in Task 6; a `tsc` build error there is expected until then — gate on `pnpm test:run` here.)

- [ ] **Step 7: Commit**

```bash
git add src/useStatusData.ts
git commit -m "feat: retryService discovers and persists canonical status URLs"
```

---

### Task 5: `UrlUpdateToast` component

**Files:**

- Create: `src/UrlUpdateToast.tsx`
- Test: `src/UrlUpdateToast.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { UrlUpdateToast } from "./UrlUpdateToast";

describe("UrlUpdateToast", () => {
  it("renders nothing when there are no updates", () => {
    const { container } = render(
      <UrlUpdateToast updates={[]} onDismiss={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the service name and new host, and fires onDismiss", () => {
    const onDismiss = vi.fn();
    render(
      <UrlUpdateToast
        updates={[
          {
            name: "Stripe",
            url: "https://www.stripestatus.com/api/v2/summary.json",
          },
        ]}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByText(/Stripe/)).toBeInTheDocument();
    expect(screen.getByText(/www\.stripestatus\.com/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /dismiss stripe/i }));
    expect(onDismiss).toHaveBeenCalledWith("Stripe");
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm test:run src/UrlUpdateToast.test.tsx`
Expected: FAIL — cannot resolve `./UrlUpdateToast`.

- [ ] **Step 3: Write the minimal implementation**

```tsx
export type UrlUpdate = { name: string; url: string };

type UrlUpdateToastProps = {
  updates: UrlUpdate[];
  onDismiss: (name: string) => void;
};

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function UrlUpdateToast({ updates, onDismiss }: UrlUpdateToastProps) {
  if (updates.length === 0) return null;

  return (
    <section
      className="mb-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 dark:border-emerald-400/30 dark:bg-emerald-400/10"
      aria-label="Status URL updates"
    >
      <ul className="space-y-1.5">
        {updates.map((u) => (
          <li key={u.name} className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-app-caption text-[var(--app-subtitle)]">
              Updated{" "}
              <span className="font-medium text-[var(--app-title)]">
                {u.name}
              </span>{" "}
              URL → {hostOf(u.url)}
            </span>
            <button
              type="button"
              onClick={() => onDismiss(u.name)}
              aria-label={`Dismiss ${u.name} URL update`}
              className="shrink-0 rounded-md border border-[var(--app-border)] bg-[var(--app-card)] px-2 py-0.5 text-app-caption text-[var(--app-title)] transition hover:bg-[var(--app-card-hover)]"
            >
              Dismiss
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm test:run src/UrlUpdateToast.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/UrlUpdateToast.tsx src/UrlUpdateToast.test.tsx
git commit -m "feat: UrlUpdateToast for self-healed status URLs"
```

---

### Task 6: Render the toast in `App.tsx`

Integration task — verify via build + manual run.

**Files:**

- Modify: `src/App.tsx`

- [ ] **Step 1: Add the import**

```ts
import { UrlUpdateToast } from "./UrlUpdateToast";
```

- [ ] **Step 2: Consume the new hook fields**

Add `urlUpdates` and `dismissUrlUpdate` to the `useStatusData()` destructure (next to `retrying`, `retryService`).

- [ ] **Step 3: Render the toast**

Immediately above the existing `<FailureBanner ... />` render, add:

```tsx
<UrlUpdateToast updates={urlUpdates} onDismiss={dismissUrlUpdate} />
```

- [ ] **Step 4: Verify build, lint, and tests**

Run: `pnpm test:run && pnpm build && pnpm lint`
Expected: tests PASS, `tsc -b && vite build` succeeds, lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat: surface self-healed status URLs in the dashboard"
```

---

### Task 7: Changelog + full verification + manual smoke

**Files:**

- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add a changelog entry** under `## [Unreleased]` → `### Added`

```markdown
- **Self-healing status URLs:** Retrying a failed/stale service now tries to discover a working canonical URL (resolving redirects on desktop; `www`-host fallback in the browser), validates it returns real Statuspage JSON, updates the saved config, and shows a dismissible notice. Feeds that move hosts recover without a code change.
```

- [ ] **Step 2: Full preflight gate**

Run: `pnpm preflight`
Expected: format clean, lint clean, all tests PASS.

- [ ] **Step 3: Manual smoke (desktop — primary path)**

Run: `pnpm tauri:dev`

- Edit the saved config (Services screen or config.json) to point a known service at a redirecting host, e.g. set Stripe to `https://stripestatus.com/api/v2/summary.json` (apex → 301 www).
- It first appears failed/stale. Click **Retry** → the card recovers AND a green toast shows `Updated Stripe URL → www.stripestatus.com`. Confirm the Services screen now shows the canonical URL (persisted).
- Point a service at a feed with no valid JSON anywhere (e.g. `https://status.redis.com/...`) → Retry leaves it failed with its error message and shows no toast (discovery correctly declines).

- [ ] **Step 4: Manual smoke (browser — best-effort path)**

Run: `pnpm dev`

- Apex→www case (Stripe) self-heals on Retry. Cross-domain moves (Linear) do NOT self-heal in the browser (documented limitation) — they remain handled by `LEGACY_URL_FIXES`.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for self-healing status URLs"
```

---

## Self-review

**Spec coverage:**

- "On retry, search for the correct URL" → Task 3 (`discoverWorkingUrl`) + Task 4 (called from `retryService`).
- "Change it" (persist) → Task 4 (`updateServiceUrl` + `persistAppConfig`).
- "Resolve redirects reliably" → Task 2 (`resolve_status_url`, reqwest follows redirects, returns final URL).
- "Don't adopt junk" → Task 1 (`isStatuspageResponse`) gates every candidate; Redis-style HTML correctly rejected.
- "Tell the user" → Task 5 + Task 6 (`UrlUpdateToast`, dismissible).
- "Browser limitation acknowledged" → Design decisions + Task 3 (browser branch) + Task 7 smoke notes.
- "AWS untouched" → Task 3 (`isAwsHealthDataUrl` early return).

**Placeholder scan:** none — every code step contains concrete code/commands.

**Type consistency:** `DiscoveredUrl` defined in Task 1, used in Task 3. `isStatuspageResponse` / `generateCandidateUrls` defined Task 1, used Task 3. `discoverWorkingUrl(service: ServiceConfig): Promise<DiscoveredUrl | null>` defined Task 3, called Task 4. `resolve_status_url` returns `{ url, body }` (Rust `ResolvedStatus`) consumed as `{ url: string; body: number[] }` in Task 3. `updateServiceUrl(name, url)`, `urlUpdates: {name,url}[]`, `dismissUrlUpdate(name)` defined Task 4, consumed Task 6. `UrlUpdate` / `UrlUpdateToast` props defined Task 5, used Task 6.

**Open risks:**

- jsdom `Response` ignores the `url` init option — Task 3 test asserts with `toContain` to stay robust; the browser fallback `res.url || url` covers it at runtime.
- If `serde`'s derive isn't directly available, Task 2 Step 3 notes the `cargo add serde --features derive` fallback.
- Browser cannot discover cross-domain moves; this is by design and covered by the static `LEGACY_URL_FIXES` map (kept).
