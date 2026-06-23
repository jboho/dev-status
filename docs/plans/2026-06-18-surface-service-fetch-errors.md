# Surface Per-Service Fetch Errors — Implementation Plan

> **Execution:** hand off to the `run-plan` skill to implement this task-by-task (fresh subagent per task + spec/quality review). Steps use `- [ ]` checkboxes for tracking.

**Goal:** Capture each service's fetch error instead of discarding it, and surface failures in a top banner (with per-service retry) while keeping last-known-good data for services that fail a refresh.

**Architecture:** A new pure module (`serviceStatusState.ts`) owns the per-service state model (`ok` / `stale` / `failed` / `pending`) and a reducer that merges fetch results instead of rebuilding from scratch. The per-service fetch body is extracted from the `useStatusData` loop into `fetchOneService` in `statusFetch.ts`. `useStatusData` folds results through the reducer and exposes `errors`, `lastSuccessAt`, and `retryService`. `App.tsx` renders a `FailureBanner` for failed services and a `⚠ stale Nm` marker + Retry on stale cards.

**Tech stack:** React + TypeScript, Vite, Vitest (jsdom) + @testing-library/react, Tauri (Rust `fetch_status_body` unchanged).

---

## File structure

- **Create** `src/serviceStatusState.ts` — types (`ServiceFetchState`, `FetchResult`, `ServiceDisplayState`), `emptyFetchState`, pure `applyFetchResult`, pure `deriveServiceState`.
- **Create** `src/serviceStatusState.test.ts` — unit tests for the reducer + derivation.
- **Create** `src/FailureBanner.tsx` — collapsible banner listing failed services with Retry.
- **Create** `src/FailureBanner.test.tsx` — RTL tests for the banner.
- **Modify** `src/statusFetch.ts` — add `fetchOneService(service)`; reuse existing primitives.
- **Modify** `src/statusFetch.test.ts` — add `fetchOneService` tests (browser success + HTTP-error throw).
- **Modify** `src/useStatusData.ts` — use `fetchOneService` + `applyFetchResult`; add `errors`, `lastSuccessAt`, `retryService`; merge instead of rebuild.
- **Modify** `src/App.tsx` — render `FailureBanner`; stale marker + Retry on `ServiceCard`; render only `ok`/`stale` services as cards.

---

### Task 1: Per-service state model (`serviceStatusState.ts`)

**Files:**

- Create: `src/serviceStatusState.ts`
- Test: `src/serviceStatusState.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm test:run src/serviceStatusState.test.ts`
Expected: FAIL — `Failed to resolve import "./serviceStatusState"`.

- [ ] **Step 3: Write the minimal implementation**

```ts
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
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm test:run src/serviceStatusState.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/serviceStatusState.ts src/serviceStatusState.test.ts
git commit -m "feat: per-service fetch state model and reducer"
```

---

### Task 2: Extract `fetchOneService` (`statusFetch.ts`)

Pulls the per-service fetch/parse branches (currently inlined in `useStatusData.ts:66-88`) into one reusable, throwing function.

**Files:**

- Modify: `src/statusFetch.ts`
- Test: `src/statusFetch.test.ts`

- [ ] **Step 1: Write the failing test** (append to the existing `statusFetch.test.ts`)

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchOneService } from "./statusFetch";
import type { ServiceConfig } from "./types";

describe("fetchOneService (browser path)", () => {
  afterEach(() => vi.unstubAllGlobals());

  const svc: ServiceConfig = {
    name: "GitHub",
    url: "https://www.githubstatus.com/api/v2/summary.json",
  };

  it("returns parsed JSON on a 200 response", async () => {
    const body = {
      page: { id: "p", name: "GitHub" },
      status: { indicator: "none", description: "All Systems Operational" },
      components: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
    );
    await expect(fetchOneService(svc)).resolves.toEqual(body);
  });

  it("throws with the HTTP status on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 })),
    );
    await expect(fetchOneService(svc)).rejects.toThrow(
      "HTTP error! status: 404",
    );
  });
});
```

> Note: in jsdom `isTauri()` is false and the GitHub URL is not an AWS-health URL, so the test exercises the browser `fetch` branch. `Response` is available in jsdom.

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm test:run src/statusFetch.test.ts`
Expected: FAIL — `fetchOneService is not exported`.

- [ ] **Step 3: Write the minimal implementation**

Update the imports at the top of `src/statusFetch.ts`:

```ts
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  isAwsHealthDataUrl,
  normalizeAwsDataJson,
  parseAwsHealthDataBuffer,
} from "./awsHealthStatus";
import type { ServiceConfig, StatuspageResponse } from "./types";
```

> `isAwsHealthDataUrl` is already imported — replace that single-name import with the grouped import above. Verify no circular import: `awsHealthStatus.ts` must not import from `statusFetch.ts` (it does not as of this writing).

Append to `src/statusFetch.ts`:

```ts
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
  const response = await fetch(service.url, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return (await response.json()) as StatuspageResponse;
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm test:run src/statusFetch.test.ts`
Expected: PASS (existing `utf8JsonParse` tests + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/statusFetch.ts src/statusFetch.test.ts
git commit -m "feat: extract fetchOneService for reuse"
```

---

### Task 3: Wire `useStatusData` to capture errors + retry

Integration task — the hook is not unit-tested in this repo. Verify via typecheck/build and existing tests. Do **not** invent a hook unit test.

**Files:**

- Modify: `src/useStatusData.ts`

- [ ] **Step 1: Update imports**

Remove the now-unused `parseAwsHealthDataBuffer` / `normalizeAwsDataJson` / `isAwsHealthDataUrl` imports and the inline `fetchUrlBytes`/`resolveAwsProxyUrlForBrowser`/`utf8JsonParse` usage from the loop. Replace the `./statusFetch` import and add the state-model import:

```ts
import { fetchOneService } from "./statusFetch";
import {
  applyFetchResult,
  emptyFetchState,
  type FetchResult,
  type ServiceFetchState,
} from "./serviceStatusState";
```

Also remove the now-unused imports: `isAwsHealthDataUrl`, `normalizeAwsDataJson`, `parseAwsHealthDataBuffer` (from `./awsHealthStatus`) and `resolveAwsProxyUrlForBrowser`, `utf8JsonParse` (from `./statusFetch`). Keep `diffOverallIndicators` and `notifyIndicatorChanges`.

- [ ] **Step 2: Replace the `statuses` state + `prevSnapshotRef` with `fetchState`**

Replace:

```ts
const [statuses, setStatuses] = useState<Record<string, StatuspageResponse>>(
  {},
);
```

and

```ts
const prevSnapshotRef = useRef<Record<string, StatuspageResponse> | null>(null);
```

with:

```ts
const [fetchState, setFetchState] =
  useState<ServiceFetchState>(emptyFetchState);
const fetchStateRef = useRef<ServiceFetchState>(emptyFetchState);
```

> The `StatuspageResponse` import in this file may become unused — remove it if so (still used in `types` import only if referenced elsewhere; check after edits).

- [ ] **Step 3: Replace `fetchStatuses` with the merge implementation**

```ts
const fetchStatuses = useCallback(async (currentConfig: AppConfig) => {
  const active = currentConfig.services.filter(isServiceEnabled);
  const results = await Promise.all(
    active.map(async (service) => {
      try {
        const data = await fetchOneService(service);
        const result: FetchResult = { ok: true, data, at: Date.now() };
        return { name: service.name, result };
      } catch (err) {
        console.error(`Failed to fetch status for ${service.name}`, err);
        const message = err instanceof Error ? err.message : String(err);
        const result: FetchResult = { ok: false, message };
        return { name: service.name, result };
      }
    }),
  );

  const base = fetchStateRef.current;
  let next = base;
  for (const { name, result } of results) {
    next = applyFetchResult(next, name, result);
  }

  const changes = diffOverallIndicators(base.statuses, next.statuses);
  fetchStateRef.current = next;
  setFetchState(next);
  setLastFetchedAt(new Date());
  setLoading(false);
  void notifyIndicatorChanges(changes);
}, []);
```

> The per-service `try/catch` means no map callback rejects, so `Promise.all` never rejects — the old outer `try/catch` that set `setError("Failed to fetch status data")` is removed. `error` state stays for config-load failure only. `diffOverallIndicators` returns `[]` when `base.statuses` is empty (first load), preserving current no-notify-on-first-load behavior; stale services keep identical data so they never produce a false change.

- [ ] **Step 4: Add `retryService`** (place after `fetchStatuses`)

```ts
const retryService = useCallback(async (name: string) => {
  const service = configRef.current?.services.find((s) => s.name === name);
  if (!service) return;
  let result: FetchResult;
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
  const next = applyFetchResult(fetchStateRef.current, name, result);
  fetchStateRef.current = next;
  setFetchState(next);
}, []);
```

- [ ] **Step 5: Update the hook return value**

```ts
return {
  config,
  saveConfig,
  reorderServices,
  statuses: fetchState.statuses,
  errors: fetchState.errors,
  lastSuccessAt: fetchState.lastSuccessAt,
  retryService,
  loading,
  error,
  lastFetchedAt,
  refresh,
  refreshing,
};
```

- [ ] **Step 6: Verify typecheck + existing tests pass**

Run: `pnpm test:run && pnpm build`
Expected: all existing tests PASS; `tsc -b` reports no errors (App.tsx is updated in Task 5, so if `build` fails only on App.tsx's not-yet-added props, that's expected — run `pnpm test:run` for the gate here and complete the build check in Task 5).

- [ ] **Step 7: Commit**

```bash
git add src/useStatusData.ts
git commit -m "feat: capture per-service fetch errors and add retryService"
```

---

### Task 4: `FailureBanner` component

**Files:**

- Create: `src/FailureBanner.tsx`
- Test: `src/FailureBanner.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FailureBanner } from "./FailureBanner";

describe("FailureBanner", () => {
  it("renders nothing when there are no failures", () => {
    const { container } = render(
      <FailureBanner failures={[]} total={5} onRetry={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the failed count out of total, collapsed by default", () => {
    render(
      <FailureBanner
        failures={[{ name: "Stripe", message: "HTTP error! status: 404" }]}
        total={16}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText(/1 of 16 services failed/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/HTTP error! status: 404/),
    ).not.toBeInTheDocument();
  });

  it("expands to show messages and fires onRetry with the service name", async () => {
    const onRetry = vi.fn();
    render(
      <FailureBanner
        failures={[{ name: "Stripe", message: "HTTP error! status: 404" }]}
        total={16}
        onRetry={onRetry}
      />,
    );
    await userEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText(/HTTP error! status: 404/)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: /retry stripe/i }),
    );
    expect(onRetry).toHaveBeenCalledWith("Stripe");
  });
});
```

> `@testing-library/react` and `@testing-library/jest-dom` are already configured via `src/test/setup.ts`. `userEvent` ships with `@testing-library/user-event`; if it is not installed, add it: `pnpm add -D @testing-library/user-event`.

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm test:run src/FailureBanner.test.tsx`
Expected: FAIL — cannot resolve `./FailureBanner`.

- [ ] **Step 3: Write the minimal implementation**

```tsx
import { useState } from "react";

export type ServiceFailure = { name: string; message: string };

type FailureBannerProps = {
  failures: ServiceFailure[];
  total: number;
  onRetry: (name: string) => void;
};

export function FailureBanner({
  failures,
  total,
  onRetry,
}: FailureBannerProps) {
  const [open, setOpen] = useState(false);
  if (failures.length === 0) return null;

  return (
    <section
      className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 dark:border-amber-400/30 dark:bg-amber-400/10"
      aria-label="Service fetch failures"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="text-app-caption font-medium text-amber-700 dark:text-amber-400">
          ⚠ {failures.length} of {total} services failed to load
        </span>
        <span aria-hidden className="text-amber-700 dark:text-amber-400">
          {open ? "▴" : "▾"}
        </span>
      </button>

      {open && (
        <ul className="mt-2 space-y-1.5">
          {failures.map((f) => (
            <li
              key={f.name}
              className="flex items-center justify-between gap-3"
            >
              <span className="min-w-0 truncate text-app-caption text-[var(--app-subtitle)]">
                <span className="font-medium text-[var(--app-title)]">
                  {f.name}
                </span>{" "}
                — {f.message}
              </span>
              <button
                type="button"
                onClick={() => onRetry(f.name)}
                aria-label={`Retry ${f.name}`}
                className="shrink-0 rounded-md border border-[var(--app-border)] bg-[var(--app-card)] px-2 py-0.5 text-app-caption text-[var(--app-title)] transition hover:bg-[var(--app-card-hover)]"
              >
                Retry
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm test:run src/FailureBanner.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/FailureBanner.tsx src/FailureBanner.test.tsx
git commit -m "feat: FailureBanner component for failed services"
```

---

### Task 5: Integrate banner + stale marker into `App.tsx`

Integration task — `ServiceCard` uses `useSortable` and can't render standalone without `DndContext`, so verify via build + manual run, not RTL. Do **not** invent a `ServiceCard` unit test.

**Files:**

- Modify: `src/App.tsx`

- [ ] **Step 1: Add imports**

```ts
import { FailureBanner, type ServiceFailure } from "./FailureBanner";
import { deriveServiceState } from "./serviceStatusState";
```

- [ ] **Step 2: Add a stale-label helper** (top-level function near `formatTime`)

```ts
function formatStaleLabel(sinceMs: number | undefined, now: Date): string {
  if (sinceMs == null) return "stale";
  const mins = Math.floor((now.getTime() - sinceMs) / 60_000);
  return mins < 1 ? "stale <1m" : `stale ${mins}m`;
}
```

- [ ] **Step 3: Extend `ServiceCardProps` and `ServiceCard`**

Update the type:

```ts
type ServiceCardProps = {
  service: { name: string; url: string };
  data: StatuspageResponse;
  lastFetchedAt: Date | null;
  isStale?: boolean;
  staleLabel?: string;
  onRetry?: () => void;
};
```

In `ServiceCard`, destructure the new props:

```ts
function ServiceCard({
  service,
  data,
  lastFetchedAt,
  isStale,
  staleLabel,
  onRetry,
}: ServiceCardProps) {
```

Add a stale badge in the trigger's right-hand cluster — change the existing block at `App.tsx:184-188`:

```tsx
<div className="flex shrink-0 items-center gap-1.5 pl-1">
  {isStale && (
    <span className="text-app-caption font-medium text-amber-600 dark:text-amber-400">
      ⚠ {staleLabel}
    </span>
  )}
  <span className="text-app-caption text-[var(--app-muted)]">
    {componentCount} components
  </span>
</div>
```

Add a Retry button in the content footer row — inside the `<div className="mt-2 flex flex-row ...">` block at `App.tsx:215`, after the `View status page` anchor and before the `Updated` `<p>`, insert:

```tsx
{
  isStale && onRetry && (
    <button
      type="button"
      onClick={onRetry}
      aria-label={`Retry ${service.name}`}
      className="shrink-0 rounded-md border border-[var(--app-border)] bg-[var(--app-card)] px-2 py-0.5 text-app-caption text-[var(--app-title)] transition hover:bg-[var(--app-card-hover)]"
    >
      Retry
    </button>
  );
}
```

> The Retry button lives in the (collapsible) content footer, not the trigger, to avoid nesting a `<button>` inside the `AccordionTrigger` button. The stale badge is a `<span>`, so it's safe inside the trigger.

- [ ] **Step 4: Consume the new hook fields + derive visible/failed sets**

Update the destructure at `App.tsx:245-255` to add `errors`, `lastSuccessAt`, `retryService`:

```ts
const {
  config,
  saveConfig,
  reorderServices,
  statuses,
  errors,
  lastSuccessAt,
  retryService,
  loading,
  error,
  lastFetchedAt,
  refresh,
  refreshing,
} = useStatusData();
```

Replace the `servicesWithData` memo (`App.tsx:289-294`) with `visibleServices` (rendered as cards) and add a `failures` memo:

```ts
const visibleServices = useMemo(() => {
  if (!config) return [];
  return config.services.filter((s) => {
    if (!isServiceEnabled(s)) return false;
    const st = deriveServiceState(s.name, statuses, errors);
    return st === "ok" || st === "stale";
  });
}, [config, statuses, errors]);

const failures = useMemo<ServiceFailure[]>(() => {
  return enabledServices
    .filter((s) => deriveServiceState(s.name, statuses, errors) === "failed")
    .map((s) => ({ name: s.name, message: errors[s.name]! }));
}, [enabledServices, statuses, errors]);
```

Update `healthyCount` and `totalTracked` to use `visibleServices` (they referenced `servicesWithData`):

```ts
const healthyCount = useMemo(() => {
  return visibleServices.filter(
    (s) => statuses[s.name]!.status.indicator.toLowerCase() === "none",
  ).length;
}, [visibleServices, statuses]);

const totalTracked = visibleServices.length;
```

- [ ] **Step 5: Render the banner + update the list**

Immediately after the overall-status `<section>` closes (`App.tsx:432`) and before the `enabledServices.length === 0` check, add:

```tsx
<FailureBanner
  failures={failures}
  total={enabledServices.length}
  onRetry={(name) => void retryService(name)}
/>
```

Change the `SortableContext` items and the map to use `visibleServices` (replaces the `enabledServices.map` at `App.tsx:452-469`):

```tsx
<SortableContext
  items={visibleServices.map((s) => s.name)}
  strategy={verticalListSortingStrategy}
>
  <div className="flex flex-col gap-2">
    {visibleServices.map((service) => {
      const data = statuses[service.name]!;
      const isStale =
        deriveServiceState(service.name, statuses, errors) === "stale";
      return (
        <ServiceCard
          key={service.name}
          service={service}
          data={data}
          lastFetchedAt={lastFetchedAt}
          isStale={isStale}
          staleLabel={
            isStale
              ? formatStaleLabel(lastSuccessAt[service.name], now)
              : undefined
          }
          onRetry={() => void retryService(service.name)}
        />
      );
    })}
  </div>
</SortableContext>
```

> Keep the outer `enabledServices.length === 0` empty-state branch (`App.tsx:434-446`) as-is — it still correctly shows "No services enabled" only when nothing is enabled. When all enabled services fail, `visibleServices` is empty but the `FailureBanner` (rendered above this branch) surfaces every failure.

- [ ] **Step 6: Verify build, lint, and tests**

Run: `pnpm test:run && pnpm build && pnpm lint`
Expected: tests PASS, `tsc -b && vite build` succeeds with no type errors, lint clean.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx
git commit -m "feat: surface failed services in banner with stale markers and retry"
```

---

### Task 6: Full verification + manual smoke

**Files:** none (verification only).

- [ ] **Step 1: Run the full preflight gate**

Run: `pnpm preflight`
Expected: format clean, lint clean, all tests PASS (`vitest run`).

- [ ] **Step 2: Manual smoke in the real app**

Run: `pnpm tauri:dev`
Verify:

- With a working config, healthy services render as cards (unchanged).
- Temporarily add a bogus service (e.g. `{ "name": "Bogus", "url": "https://status.example.invalid/api/v2/summary.json" }`) → it appears in the `⚠ N of M services failed to load` banner; expanding shows the error message; clicking **Retry** re-attempts just that service.
- Disable network briefly and refresh a previously-loaded service → its card stays with last-known-good data and shows `⚠ stale Nm`; the in-card **Retry** recovers it when network returns.

> If `pnpm tauri:dev` is unavailable in the environment, fall back to `pnpm dev` (browser) and note that the Tauri-specific fetch path isn't exercised there.

- [ ] **Step 3: No commit** (verification task).

---

## Self-review

**Spec coverage:**

- "Capture error instead of discarding" → Task 1 (`applyFetchResult` failure branch) + Task 3 (catch sets `FetchResult.message`).
- "Three states ok/stale/failed" → Task 1 (`deriveServiceState`) + Task 5 (consumed).
- "Top banner for failed (no prior data)" → Task 4 + Task 5 (`failures` memo from `failed` state).
- "Keep last-known-good + stale marker for refresh failures" → Task 1 (failure keeps `statuses[name]`) + Task 5 (stale badge + `formatStaleLabel`).
- "Per-service retry (banner + stale card)" → Task 3 (`retryService`) + Task 4 (banner Retry) + Task 5 (card Retry).
- "Raw error message, no prettifying" → Task 3 (`err.message`/`String(err)` verbatim).
- "Extracted pure helpers for testability" → Task 1 (`applyFetchResult`, `deriveServiceState`) + Task 2 (`fetchOneService`).
- "Tests: reducer transitions + fetchOneService success/HTTP-error" → Task 1 + Task 2.
- "Out of scope: auto-retry, categorization, URL fixing, persistence" → none added. ✓

**Placeholder scan:** none — every step contains concrete code/commands.

**Type consistency:** `ServiceFetchState`, `FetchResult`, `ServiceDisplayState`, `emptyFetchState`, `applyFetchResult`, `deriveServiceState` defined in Task 1 and used identically in Tasks 3 & 5. `fetchOneService(service: ServiceConfig): Promise<StatuspageResponse>` defined in Task 2, called in Task 3. `ServiceFailure` defined/exported in Task 4, imported in Task 5. Hook return fields (`errors`, `lastSuccessAt`, `retryService`) added in Task 3, consumed in Task 5. `formatStaleLabel(sinceMs, now)` defined and used in Task 5. ✓
