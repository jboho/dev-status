# Contributing

Thanks for helping improve dev-status.

This project adheres to the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold it.

## Development setup

Use **Node 22+** (see `engines` in `package.json`). If you use [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm), run `nvm use` / `fnm use` in the repo root; [`.nvmrc`](.nvmrc) pins the major version.

```bash
pnpm install
pnpm dev          # web UI at http://localhost:5173
pnpm tauri:dev    # desktop shell + Vite
```

Before opening a PR, run:

```bash
pnpm preflight    # format, lint, unit tests
```

Or individually: `pnpm format:check`, `pnpm lint`, `pnpm test:run`, `pnpm build`.

**Coverage (optional):** `pnpm test:coverage` writes an HTML report under `coverage/` (gitignored). Use it to find gaps; low overall % is expected until more component and hook tests exist.

## Versioning (CalVer)

This project uses **Calendar Versioning**. The public version string is **`YYYY.M.MICRO`**:

| Segment   | Meaning                                           |
| --------- | ------------------------------------------------- |
| **YYYY**  | Calendar year                                     |
| **M**     | Calendar month (1–12, no leading zero)            |
| **MICRO** | Release counter within that month (starts at `0`) |

Examples:

- First release in April 2026: `2026.4.0`
- Another release the same month: `2026.4.1`, then `2026.4.2`, …
- First release in May 2026: `2026.5.0`

**Source of truth:** [`package.json`](package.json) `version`.

After you change `version` there, sync native bundles:

```bash
pnpm version:sync
```

That updates [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json) and [`src-tauri/Cargo.toml`](src-tauri/Cargo.toml) so Tauri installers match npm tooling.

Commit the three files together on release bumps.

## Changelog

Notable user-visible or workflow changes should be recorded in [`CHANGELOG.md`](CHANGELOG.md) under **`[Unreleased]`** as you work, then moved under the new version heading when you cut a release (Keep a Changelog style — **Added** / **Changed** / **Fixed** / **Removed** as appropriate).

## Releasing

Push a `v`-prefixed tag matching the version in `package.json`:

```bash
git tag v2026.6.8
git push origin v2026.6.8
```

That triggers [`.github/workflows/release.yml`](.github/workflows/release.yml), which builds on `macos-latest` and `windows-latest` and attaches the installers to a **draft** GitHub Release for you to review and publish. The macOS leg builds a universal binary (`--target universal-apple-darwin`), so one bundle serves both Apple Silicon and Intel.

### macOS signing and notarization

The macOS leg signs with a **Developer ID Application** certificate and notarizes with Apple, so downloaded builds open without Gatekeeper warnings. It needs these repository secrets:

| Secret                       | Value                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| `APPLE_CERTIFICATE`          | Developer ID Application cert exported as `.p12`, base64-encoded (single line)           |
| `APPLE_CERTIFICATE_PASSWORD` | Password set when exporting that `.p12`                                                  |
| `APPLE_ID`                   | Apple account email                                                                      |
| `APPLE_PASSWORD`             | [App-specific password](https://support.apple.com/en-us/102654) for that account         |
| `APPLE_TEAM_ID`              | Team ID from your [Apple Developer membership page](https://developer.apple.com/account) |

To produce `APPLE_CERTIFICATE`: export the certificate from Keychain Access (right-click → Export, `.p12` format, set a password), then

```bash
openssl base64 -A -in certificate.p12 | pbcopy
```

The Tauri bundler imports the certificate into a temporary keychain it deletes afterwards, derives the signing identity from the certificate itself, then notarizes and staples the ticket. Hardened runtime is on by default, which notarization requires.

**All five secrets or none.** The workflow fails fast on a partial set, and with none configured it logs a warning and produces the same ad-hoc-signed bundle as a local `pnpm tauri build` — fine for local use, but downloaders see _"DevStatus is damaged and can't be opened"_ because of the quarantine flag.

Windows installers are **not** signed yet, so SmartScreen will warn on first run.

## Pull requests

- Keep changes focused on one topic when possible.
- Match existing patterns (TypeScript strictness, Prettier, oxlint).
- Add or update tests when behavior changes.
