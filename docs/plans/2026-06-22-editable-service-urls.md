# Editable Service URLs in Settings Implementation Plan

> **Execution:** hand off to the `run-plan` skill to implement this task-by-task (fresh subagent per task + spec/quality review). Steps use `- [ ]` checkboxes for tracking.

**Goal:** Allow users to edit a service's feed URL inline from the Services screen so broken or migrated URLs can be fixed without editing config files.

**Architecture:** Extend the existing `ToggleRow` component in `ServicesScreen.tsx` to support an inline edit mode for the URL field. Clicking the URL text swaps it for a controlled `<input>`; `Enter`/blur commits a validated URL back through the existing `onSave(AppConfig)` pipeline; `Escape` cancels. Validation is format-only (must start with `https://` and be a parseable URL) — no network probe. The `ServiceConfig` and `AppConfig` types are unchanged; saving goes through `persistAppConfig` exactly as the enable/disable toggle does today.

**Tech stack:** React 19, TypeScript, Tailwind CSS 4, Vitest + Testing Library (`@testing-library/react`)

---

## File map

| File                          | Action | Responsibility                                                                  |
| ----------------------------- | ------ | ------------------------------------------------------------------------------- |
| `src/ServicesScreen.tsx`      | Modify | Add inline URL edit mode to `ToggleRow`; wire `onUrlChange` in `ServicesScreen` |
| `src/ServicesScreen.test.tsx` | Create | Full coverage of inline edit: happy path, validation, cancel, toggle regression |

No other files need to change — `ServiceConfig.url` already persists through `persistAppConfig`.

---

### Task 1: Create `ServicesScreen.test.tsx` with a failing test for edit-mode activation

**Files:**

- Create: `src/ServicesScreen.test.tsx`

This task establishes the test file and asserts that clicking the URL text renders an `<input>` prefilled with the current URL. At the end of this task the test will **fail** because no edit mode exists yet — that is intentional.

- [ ] **Step 1: Write the failing test**

```tsx
// src/ServicesScreen.test.tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ServicesScreen } from "./ServicesScreen";
import type { AppConfig } from "./types";

const baseConfig: AppConfig = {
  services: [
    { name: "GitHub", url: "https://www.githubstatus.com/api/v2/summary.json" },
    {
      name: "Vercel",
      url: "https://www.vercel-status.com/api/v2/summary.json",
    },
  ],
};

describe("ServicesScreen – URL editing", () => {
  it("clicking the URL text reveals a prefilled input", () => {
    render(
      <ServicesScreen
        config={baseConfig}
        onBack={vi.fn()}
        onSave={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    const urlText = screen.getByText(
      "https://www.githubstatus.com/api/v2/summary.json",
    );
    fireEvent.click(urlText);
    const input = screen.getByRole("textbox", { name: /github url/i });
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue(
      "https://www.githubstatus.com/api/v2/summary.json",
    );
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
pnpm test run src/ServicesScreen.test.tsx
```

Expected: **FAIL** — `Unable to find an element with the text: https://www.githubstatus.com...` (the URL is rendered in a `<p>`, which is not a role=button and does not activate an input).

- [ ] **Step 3: Commit the failing test**

```bash
git add src/ServicesScreen.test.tsx
git commit -m "test: failing test for inline URL edit mode in ServicesScreen"
```

---

### Task 2: Implement inline edit mode in `ToggleRow`

**Files:**

- Modify: `src/ServicesScreen.tsx`

Add `editing: boolean` and `draft: string` local state to `ToggleRow`. When `editing` is false the URL renders as a `<button>` (so it is keyboard-accessible). When true an `<input>` replaces it. On `Enter`/blur call a new `onUrlSave(newUrl: string)` prop; on `Escape` reset `draft` and exit.

- [ ] **Step 1: Add `onUrlSave` prop and local state to `ToggleRow`**

Replace the existing `ToggleRow` function entirely with this:

```tsx
function ToggleRow({
  service,
  onToggle,
  onUrlSave,
}: {
  service: ServiceConfig;
  onToggle: () => void;
  onUrlSave: (newUrl: string) => void;
}) {
  const on = isServiceEnabled(service);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(service.url);

  const commit = () => {
    const trimmed = draft.trim();
    if (isValidUrl(trimmed)) {
      onUrlSave(trimmed);
      setEditing(false);
    }
  };

  const cancel = () => {
    setDraft(service.url);
    setEditing(false);
  };

  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--app-border)] py-2.5 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-app-body font-medium text-[var(--app-title)]">
          {service.name}
        </p>
        {editing ? (
          <input
            type="url"
            aria-label={`${service.name} URL`}
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") cancel();
            }}
            onBlur={commit}
            className={`mt-0.5 w-full rounded border px-1.5 py-0.5 font-mono text-app-caption outline-none focus:ring-1 ${
              isValidUrl(draft.trim())
                ? "border-[var(--app-border)] bg-[var(--app-card)] text-[var(--app-muted)] focus:border-emerald-500 focus:ring-emerald-500/30"
                : "border-red-500 bg-red-500/5 text-[var(--app-muted)] focus:ring-red-500/30"
            }`}
          />
        ) : (
          <button
            type="button"
            aria-label={`Edit URL for ${service.name}`}
            onClick={() => {
              setDraft(service.url);
              setEditing(true);
            }}
            className="mt-0.5 block truncate font-mono text-app-caption text-[var(--app-muted)] transition hover:text-[var(--app-title)] text-left w-full"
            title="Click to edit URL"
          >
            {service.url}
          </button>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`${on ? "Disable" : "Enable"} ${service.name}`}
        onClick={onToggle}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
          on
            ? "bg-emerald-600 dark:bg-emerald-700"
            : "bg-[var(--app-border)] dark:bg-zinc-600"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
            on ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}
```

Add the `isValidUrl` helper and the `React` import at the top of the file (add `import React, { useState } from "react"` — or just `import { useState } from "react"` and replace `React.useState` with `useState`). Add `isValidUrl` as a module-level function:

```ts
function isValidUrl(value: string): boolean {
  if (!value.startsWith("https://")) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Wire `onUrlSave` into `ServicesScreen`**

In the `ServicesScreen` function, replace the existing `toggle` helper and the `ToggleRow` render call:

```tsx
const saveUrl = async (name: string, newUrl: string) => {
  const next: AppConfig = {
    ...config,
    services: config.services.map((s) =>
      s.name === name ? { ...s, url: newUrl } : s,
    ),
  };
  await onSave(next);
};
```

Update the `ToggleRow` render to pass the new prop:

```tsx
<ToggleRow
  key={s.name}
  service={s}
  onToggle={() => void toggle(s.name)}
  onUrlSave={(newUrl) => void saveUrl(s.name, newUrl)}
/>
```

- [ ] **Step 3: Run the previously-failing test, verify it passes**

```bash
pnpm test run src/ServicesScreen.test.tsx
```

Expected: **PASS** — clicking the URL text now renders a prefilled `<input>`.

- [ ] **Step 4: Run the full suite to check for regressions**

```bash
pnpm test run
```

Expected: all 37+ tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/ServicesScreen.tsx
git commit -m "feat: inline URL editing in ServicesScreen ToggleRow"
```

---

### Task 3: Add remaining tests — commit, cancel, validation, toggle regression

**Files:**

- Modify: `src/ServicesScreen.test.tsx`

- [ ] **Step 1: Add tests for commit via Enter, commit via blur, Escape cancel, invalid URL blocked, and toggle regression**

Append these `describe` blocks to the existing test file:

```tsx
describe("ServicesScreen – URL editing (commit and cancel)", () => {
  it("pressing Enter with a valid URL calls onSave with the updated URL", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <ServicesScreen config={baseConfig} onBack={vi.fn()} onSave={onSave} />,
    );
    fireEvent.click(
      screen.getByText("https://www.githubstatus.com/api/v2/summary.json"),
    );
    const input = screen.getByRole("textbox", { name: /github url/i });
    fireEvent.change(input, {
      target: { value: "https://newurl.example.com/api/v2/summary.json" },
    });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSave).toHaveBeenCalledWith({
      services: [
        {
          name: "GitHub",
          url: "https://newurl.example.com/api/v2/summary.json",
        },
        {
          name: "Vercel",
          url: "https://www.vercel-status.com/api/v2/summary.json",
        },
      ],
    });
  });

  it("blurring the input with a valid URL calls onSave", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <ServicesScreen config={baseConfig} onBack={vi.fn()} onSave={onSave} />,
    );
    fireEvent.click(
      screen.getByText("https://www.githubstatus.com/api/v2/summary.json"),
    );
    const input = screen.getByRole("textbox", { name: /github url/i });
    fireEvent.change(input, {
      target: { value: "https://newurl.example.com/api/v2/summary.json" },
    });
    fireEvent.blur(input);
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("pressing Escape cancels without calling onSave", () => {
    const onSave = vi.fn();
    render(
      <ServicesScreen config={baseConfig} onBack={vi.fn()} onSave={onSave} />,
    );
    fireEvent.click(
      screen.getByText("https://www.githubstatus.com/api/v2/summary.json"),
    );
    const input = screen.getByRole("textbox", { name: /github url/i });
    fireEvent.change(input, {
      target: { value: "https://changed.example.com" },
    });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onSave).not.toHaveBeenCalled();
    // URL text restored to original
    expect(
      screen.getByText("https://www.githubstatus.com/api/v2/summary.json"),
    ).toBeInTheDocument();
  });
});

describe("ServicesScreen – URL validation", () => {
  it("does not call onSave when Enter is pressed with an invalid URL", () => {
    const onSave = vi.fn();
    render(
      <ServicesScreen config={baseConfig} onBack={vi.fn()} onSave={onSave} />,
    );
    fireEvent.click(
      screen.getByText("https://www.githubstatus.com/api/v2/summary.json"),
    );
    const input = screen.getByRole("textbox", { name: /github url/i });
    fireEvent.change(input, { target: { value: "not-a-url" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSave).not.toHaveBeenCalled();
    // Input still visible (still in edit mode)
    expect(input).toBeInTheDocument();
  });

  it("does not call onSave on blur with an invalid URL", () => {
    const onSave = vi.fn();
    render(
      <ServicesScreen config={baseConfig} onBack={vi.fn()} onSave={onSave} />,
    );
    fireEvent.click(
      screen.getByText("https://www.githubstatus.com/api/v2/summary.json"),
    );
    const input = screen.getByRole("textbox", { name: /github url/i });
    fireEvent.change(input, { target: { value: "http://not-https.com" } });
    fireEvent.blur(input);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("does not call onSave when URL is empty", () => {
    const onSave = vi.fn();
    render(
      <ServicesScreen config={baseConfig} onBack={vi.fn()} onSave={onSave} />,
    );
    fireEvent.click(
      screen.getByText("https://www.githubstatus.com/api/v2/summary.json"),
    );
    const input = screen.getByRole("textbox", { name: /github url/i });
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("ServicesScreen – toggle regression", () => {
  it("toggling enable/disable still calls onSave with enabled flipped", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <ServicesScreen config={baseConfig} onBack={vi.fn()} onSave={onSave} />,
    );
    fireEvent.click(screen.getByRole("switch", { name: /disable github/i }));
    expect(onSave).toHaveBeenCalledWith({
      services: [
        {
          name: "GitHub",
          url: "https://www.githubstatus.com/api/v2/summary.json",
          enabled: false,
        },
        {
          name: "Vercel",
          url: "https://www.vercel-status.com/api/v2/summary.json",
        },
      ],
    });
  });
});
```

- [ ] **Step 2: Run the tests, verify they all pass**

```bash
pnpm test run src/ServicesScreen.test.tsx
```

Expected: **PASS** — all new tests green.

- [ ] **Step 3: Run the full suite**

```bash
pnpm test run
```

Expected: all tests pass (37 original + new ServicesScreen tests).

- [ ] **Step 4: Commit**

```bash
git add src/ServicesScreen.test.tsx
git commit -m "test: full coverage for inline URL editing in ServicesScreen"
```

---

## Spec coverage check

| Requirement                                                             | Task                           |
| ----------------------------------------------------------------------- | ------------------------------ |
| Click URL → enters edit mode with prefilled input                       | Tasks 1 & 2                    |
| `Enter` with valid URL → saves                                          | Task 3                         |
| Blur with valid URL → saves                                             | Task 3                         |
| `Escape` → cancels, original URL restored, no save                      | Task 3                         |
| Invalid URL (non-https, malformed, empty) → no save, stays in edit mode | Task 3                         |
| Enable/disable toggle still works                                       | Task 3                         |
| `isValidUrl` rejects `http://`, empty string, and non-URL strings       | Task 2 (impl) + Task 3 (tests) |

## Out of scope

- Rename service name — same pattern, trivial follow-up
- Add / delete services — larger scope, separate plan
- Network probe on save — UI complexity not justified for this use case; broken URLs surface in the failure banner
