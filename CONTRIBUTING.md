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

## Pull requests

- Keep changes focused on one topic when possible.
- Match existing patterns (TypeScript strictness, Prettier, oxlint).
- Add or update tests when behavior changes.
