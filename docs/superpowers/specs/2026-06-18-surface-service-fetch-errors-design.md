# Surface per-service fetch errors

**Date:** 2026-06-18
**Status:** Approved

## Problem

When the dashboard scans services, a service whose fetch fails silently
disappears: the error is `console.error`'d and discarded, and the service is
simply omitted from the rendered list. A user with ~16 enabled services who sees
only 1 has no way to know the other 15 failed, why they failed, or how to retry.

This was misdiagnosed at first as "we stop scanning after one error." The code
does **not** stop — `fetchStatuses` (`src/useStatusData.ts`) runs every enabled
service in parallel via `Promise.all`, and each has its own inner `try/catch`.
A failure in one cannot abort the others. The real defects are:

1. **Errors are swallowed.** The per-service `catch` only calls `console.error`
   (`src/useStatusData.ts:91`); the message never reaches the UI.
2. **Failed services vanish.** `App.tsx` does `if (!data) return null`
   (`App.tsx:458-459`), so a service with no fetched data renders nothing —
   no error, no retry, no trace.

## Goal

Capture each service's fetch error instead of discarding it, and surface
failures in the UI with a way to retry — while still loading every service that
succeeds (already the behavior).

## Per-service state model

Replace the binary "has data / doesn't" with three states, derived from the
existing `statuses` map plus two new maps:

| State      | Condition                           | Render                                                    |
| ---------- | ----------------------------------- | --------------------------------------------------------- |
| **OK**     | latest fetch succeeded              | normal card (unchanged)                                   |
| **Stale**  | has prior data, latest fetch failed | normal card + `⚠ stale Nm` marker + Retry                 |
| **Failed** | no prior data, latest fetch failed  | listed in the top banner with its error + Retry (no card) |

The user's reported bug (services that never load) is the **Failed** case → all
go to the banner. A previously-working service that blips on one poll is the
**Stale** case → keeps its last-known-good card.

## Components

### `useStatusData` (`src/useStatusData.ts`)

New state alongside `statuses`:

- `errors: Record<string, string>` — last error message per service name; set on
  failure, cleared on success.
- `lastSuccessAt: Record<string, number>` — epoch ms of last successful fetch per
  service name; drives the stale-age marker.

Behavior changes:

- The fetch loop **merges** results instead of rebuilding `newStatuses` from
  `{}`. On success: set `statuses[name]`, set `lastSuccessAt[name]`, clear
  `errors[name]`. On failure: set `errors[name]` to the caught message and
  **leave `statuses[name]` intact** (this is what produces the Stale state).
- New `retryService(name)`: re-fetch a single service and merge its result.
- The catch block at `src/useStatusData.ts:91` becomes the capture point for the
  error message (keep the `console.error` for the dev log).

Hook return value gains: `errors`, `lastSuccessAt`, `retryService`.

### Extracted pure helpers (for testability — the hook itself isn't unit-tested)

- `fetchOneService(service): Promise<StatuspageResponse>` — the per-service fetch
  - parse body currently inlined in the loop (AWS-health branch, Tauri branch,
    browser-fetch branch). Throws on failure.
- `applyFetchResult(prev, name, result)` — pure reducer returning the next
  `{ statuses, errors, lastSuccessAt }`. `result` is either `{ ok: true, data }`
  or `{ ok: false, message }`. Used by both the batch loop and `retryService`.

### `App.tsx`

- New **FailureBanner** component, rendered above the service list only when ≥1
  service is in the Failed state. Collapsed by default showing
  `⚠ N of M services failed to load`; expands to per-service rows
  (`name — message  [Retry]`). Retry calls `retryService(name)`.
- Service list: a Stale service still renders its `ServiceCard`, with a
  `⚠ stale Nm` marker and a Retry affordance. A Failed service renders no card
  (it's in the banner). OK services render as today.
- Derive the three states from `statuses` / `errors` for each enabled service.

## Error message

Surface the raw thrown message verbatim — `HTTP error! status: 404` from the
browser/Tauri path, or the reqwest error string bubbled up from
`fetch_status_body` (`src-tauri/src/lib.rs`). No categorization or prettifying in
v1; the raw string is the diagnostic the user currently lacks.

## Testing

- Unit-test `applyFetchResult`:
  - success sets `data` + `lastSuccessAt`, clears any prior error;
  - failure with prior data keeps the data and sets the error (Stale);
  - failure with no prior data sets the error and leaves no data (Failed);
  - failure-then-success clears the error and refreshes `lastSuccessAt`.
- Test `fetchOneService` alongside existing `src/statusFetch.test.ts` patterns
  (success parse, HTTP-error throw).

## Out of scope (YAGNI)

- Auto-retry / backoff scheduling.
- Error categorization or user-friendly message mapping.
- Validating or fixing the actual status-page URLs in config.
- Persisting errors across app restarts.
