# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).  
Version numbers use [Calendar Versioning](https://calver.org/) (`YYYY.M.MICRO`) — see [CONTRIBUTING.md](CONTRIBUTING.md).

## [2026.10.0] — 2026-10-05

### Changed

- **Public repository:** The project now lives in a fresh-history repository. The previous history is archived privately.
- **Release workflow hardening:** Actions are pinned to commit SHAs, tokens use least privilege, and signing secrets are scoped to a `release` environment limited to version tags.

### Fixed

- **Dependency advisories:** Bumped `jsdom` to 30.1.2 to clear the `undici` audit failures.

### Documentation

- Refreshed the README screenshots.

## [2026.9.1] — 2026-09-12

### Fixed

- **Notarized macOS disk image:** The `.dmg` is now notarized and stapled, not just code-signed. Tauri's bundler notarizes the `.app` but only signs the disk image wrapped around it, so `2026.9.0`'s download assessed as `Unnotarized Developer ID` and Gatekeeper would block the `.dmg` on open even though the app inside it was fine. The release workflow now submits the disk image to Apple after the build, staples the ticket, asserts the Gatekeeper verdict, and replaces the uploaded asset.

## [2026.9.0] — 2026-09-12

### Added

- **Signed and notarized macOS releases:** The release workflow now signs the macOS bundle with a Developer ID Application certificate and submits it to Apple for notarization, stapling the ticket to the app. Downloaded builds open without the _"DevStatus is damaged and can't be opened"_ Gatekeeper error that ad-hoc-signed bundles produce. Requires the `APPLE_*` repository secrets documented in [CONTRIBUTING.md](CONTRIBUTING.md#macos-signing-and-notarization); with none set, the workflow warns and falls back to the previous ad-hoc bundle, and it fails fast on a partially configured set. Windows installers remain unsigned.
- **Universal macOS binary:** Release builds now target `universal-apple-darwin`, so one bundle runs natively on both Apple Silicon and Intel Macs. Previously the release shipped whatever architecture the runner happened to be (Apple Silicon), leaving Intel Macs with nothing to install.

### Fixed

- **Duplicate README section:** Removed a repeated Screenshots block that rendered the same image table and captions twice.

### Removed

- **`shadcn` dependency:** The shadcn/ui CLI is a one-shot scaffolding tool whose components are already vendored into `src/components/ui/`, but it sat in `dependencies` and pulled in 264 transitive packages — including `@modelcontextprotocol/sdk` — which accounted for nearly every `pnpm audit` finding. Removing it takes the audit from 25 findings (7 high) to 2 (both moderate) and leaves the production bundle byte-identical. Scaffold new components with `pnpm dlx shadcn@latest add <component>`; [`components.json`](components.json) still configures it. The now-unreachable `brace-expansion`, `fast-uri`, `ip-address`, and `js-yaml` overrides were dropped with it.

### Security

- Raised the `fast-uri` (→ 3.1.7) and `js-yaml` (→ 4.3.2) pnpm overrides and added one for `browserslist` (→ 4.28.9), clearing seven high-severity advisories in transitive dependencies: SSRF and host-confusion in `fast-uri` ([GHSA-f65p-4m7j-42xc](https://github.com/advisories/GHSA-f65p-4m7j-42xc), [GHSA-fph4-wmhf-6fwf](https://github.com/advisories/GHSA-fph4-wmhf-6fwf), [GHSA-jqff-g426-hqxp](https://github.com/advisories/GHSA-jqff-g426-hqxp)), CPU exhaustion in `js-yaml` ([GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh)), and unbounded memory growth plus a prototype-write crash in `browserslist`. All three stay within the major versions their dependents expect.

## [2026.6.7] — 2026-06-30

### Added

- **AWS US-region filter:** AWS Health events are now scoped to `us-*` and global/region-less events only (IAM, Route 53, CloudFront, billing). EU, AP, ME, and SA events are dropped, so the AWS card reflects what actually affects US-based users. When no US-region events are active the card shows "No active US-region events" instead of a blank feed.

### Fixed

- **Dead services never re-enter saved config:** `persistAppConfig` and `persistBrowserConfigSync` now sanitize the config before writing — retired feeds (Redis, Anthropic) are stripped and legacy URL fixes are applied at every save, not just on load. Previously a save cycle could re-add a dead service that had been removed on startup.
- **Dead services hidden at render time:** The dashboard, Services settings screen, and active-fetch loop now each guard against retired feed names, so even a stale config cannot surface a Redis or Anthropic card.

## [2026.6.6] — 2026-06-27

### Changed

- **HTTP User-Agent:** Outbound status fetches now identify as `DevStatus`, matching the product name.
- **Bundle identifier:** Set the application identifier to `com.credstudios.devstatus`, a stable reverse-DNS identity under a controlled domain. This fixes the app-data directory, macOS bundle ID, and Windows install registration in place ahead of public distribution.

### Fixed

- **Version consistency:** Aligned the Rust crate version (`Cargo.toml`/`Cargo.lock`) with `package.json` and `tauri.conf.json` so every release manifest reports the same version.

## [2026.6.3] — 2026-06-22

### Added

- **Inline URL editing:** Each service row in the Settings screen now has an inline edit mode — click to edit the status URL, then Save or Cancel without leaving the screen. URLs are validated to block SSRF before saving.
- **Status-aware tray icon:** The system tray icon reflects overall service health in real-time — green when all services are nominal, amber on minor/maintenance, red on major/critical outage.
- **Visible fetch failures:** Services whose status fetch fails are no longer silently dropped. Those with no prior data are listed in a collapsible banner (`⚠ N of M services failed to load`) showing each service's raw error message, with a per-service **Retry** button.
- **Stale data on failed refresh:** A service that fails a refresh but has last-known-good data keeps its card, marked with a `⚠ stale Nm` badge and a Retry button, instead of disappearing.

### Changed

- **Renamed to DevStatus:** Product name updated from "dev-status" to **DevStatus** across the app title, window title, desktop notifications, and README.
- **Refined header controls:** Services navigation moved from a text button in the title bar to a ⚙ gear icon in the toolbar; the "← Back" text button is replaced with an arrow-only button.
- **New app icon:** Default Tauri template icon replaced with the D+dot mark; all platform sizes regenerated (macOS, Windows, iOS, Android).
- **Resilient scanning:** Status fetching now merges per-service results instead of rebuilding from scratch each poll, so a transient failure never wipes a working service's data.

### Fixed

- **Desktop fetches behind a TLS-inspecting proxy:** Switched Rust fetch to `native-tls` (OS trust store) so it works on corporate networks that re-sign HTTPS with an internal CA — previously every service failed with `error sending request`.
- **Stale status URLs auto-migrated:** Linear URL corrected to `linearstatus.com`; Redis removed from defaults (moved to FireHydrant, no public JSON API). Existing configs are repaired automatically on startup.
- **Browser dev-mode CORS preflight:** Removed the `Cache-Control`/`Pragma` request headers that forced an `OPTIONS` preflight; statuspage feeds reject preflight redirects. `cache: "no-store"` still prevents stale reads.
- **Retry spinner:** Per-service Retry button now shows a spinning indicator while the refetch is in-flight.
- **Windows MSI build:** Added WiX version override so MSI builds (which cap at 255.255.65535.0) no longer reject calendar-versioned build numbers.

## [2026.6.0] — 2026-06-05

### Added

- **Desktop notifications:** On each poll, diffs the page-level `status.indicator` for every enabled service against the previous result and fires a single bundled OS notification listing each change as `ServiceName: from → to` (e.g. `Claude: none → minor`). No notification on first load (no baseline). Tauri-only; requests OS permission on first trigger.
- **Reliable refresh:** `cache: "no-store"` and no-cache request headers on browser `fetch` and Rust `fetch_status_body` so status data is never served from a stale HTTP cache.

### Changed

- **README:** screenshots of dashboard and services screen, expanded feature descriptions.

### Security

- Bumped `vite` 8.0.3 → 8.0.16, resolving two high CVEs ([GHSA-v2wj-q39q-566r](https://github.com/advisories/GHSA-v2wj-q39q-566r), [GHSA-p9ff-h696-f583](https://github.com/advisories/GHSA-p9ff-h696-f583)).
- Bumped `shadcn` 4.1.1 → 4.10.0, resolving two high CVEs in transitive `fast-uri` dep ([GHSA-q3j6-qgpj-74h6](https://github.com/advisories/GHSA-q3j6-qgpj-74h6), [GHSA-v39h-62p7-jpjc](https://github.com/advisories/GHSA-v39h-62p7-jpjc)).
- Full npm and Cargo dependency refresh (`tauri` 2.10.3 → 2.11.2, `typescript` 5.9.3 → 6.0.3, `tailwindcss` 4.2.2 → 4.3.0, and many more).

## [2026.4.2] — 2026-04-28

### Added

- **MIT** [`LICENSE`](LICENSE) and `license` field in `package.json`.
- [`SECURITY.md`](SECURITY.md) for coordinated vulnerability reporting.
- [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) (Contributor Covenant 2.1).
- [`.editorconfig`](.editorconfig) for consistent formatting across editors.
- [`.nvmrc`](.nvmrc) (Node 22) and `engines` in `package.json`.
- [`.github/dependabot.yml`](.github/dependabot.yml) for npm, Cargo, and GitHub Actions updates.
- Issue forms ([bug report](.github/ISSUE_TEMPLATE/bug_report.yml), [feature request](.github/ISSUE_TEMPLATE/feature_request.yml)), [issue template config](.github/ISSUE_TEMPLATE/config.yml), and [pull request template](.github/pull_request_template.md).
- [`scripts/sync-version.mjs`](scripts/sync-version.mjs) and `pnpm version:sync` to align Tauri + Cargo with `package.json` after bumps.
- [`src-tauri/rust-toolchain.toml`](src-tauri/rust-toolchain.toml) pinning the **stable** Rust channel.
- **Vitest coverage** (`pnpm test:coverage`, `@vitest/coverage-v8`); CI uploads **HTML coverage** as workflow artifact `coverage-report`.
- **Pro README:** badges, tables, security/license links, and expanded contributing guidance.

## [2026.4.1] — 2026-04-28

### Added

- **Reliable refresh:** `cache: "no-store"` and no-cache request headers on browser `fetch` and Rust `fetch_status_body` so status data is not served from a stale HTTP cache.
- **Interval clarity:** Single source for poll interval in code; header shows “Auto refresh every … · Last updated …”.
- **Desktop notifications (Tauri):** When an enabled service’s overall `status.indicator` changes after a fetch, show a consolidated native notification (after OS permission).
- **`diffOverallIndicators`** helper (`src/statusChange.ts`) and tests.
