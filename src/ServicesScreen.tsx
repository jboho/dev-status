import React from "react";
import type { AppConfig, ServiceConfig } from "./types";
import { isServiceEnabled } from "./types";
import { isDeadServiceName } from "./configStorage";

type ServicesScreenProps = {
  config: AppConfig;
  onBack: () => void;
  onSave: (next: AppConfig) => Promise<void>;
};

function isValidUrl(value: string): boolean {
  if (!value.startsWith("https://")) return false;
  try {
    const u = new URL(value);
    const h = u.hostname;
    if (
      h === "localhost" ||
      h.startsWith("127.") ||
      h === "0.0.0.0" ||
      h === "169.254.169.254" ||
      h === "[::1]"
    )
      return false;
    return true;
  } catch {
    return false;
  }
}

function ToggleRow({
  service,
  onToggle,
  onUrlSave,
}: {
  service: ServiceConfig;
  onToggle: () => void;
  onUrlSave: (newUrl: string) => void | Promise<void>;
}) {
  const on = isServiceEnabled(service);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(service.url);
  const committingRef = React.useRef(false);

  React.useEffect(() => {
    if (!editing) setDraft(service.url);
  }, [service.url, editing]);

  const commit = () => {
    if (committingRef.current) return;
    const trimmed = draft.trim();
    if (isValidUrl(trimmed)) {
      committingRef.current = true;
      onUrlSave(trimmed);
      committingRef.current = false;
      setEditing(false);
    }
  };

  const cancel = () => {
    committingRef.current = false;
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

export function ServicesScreen({
  config,
  onBack,
  onSave,
}: ServicesScreenProps) {
  const toggle = async (name: string) => {
    const next: AppConfig = {
      ...config,
      services: config.services.map((s) => {
        if (s.name !== name) return s;
        const wasOn = isServiceEnabled(s);
        return { ...s, enabled: !wasOn };
      }),
    };
    await onSave(next);
  };

  const saveUrl = async (name: string, newUrl: string) => {
    const next: AppConfig = {
      ...config,
      services: config.services.map((s) =>
        s.name === name ? { ...s, url: newUrl } : s,
      ),
    };
    await onSave(next);
  };

  return (
    <div className="flex min-h-screen flex-col bg-[var(--app-bg)] text-[var(--app-body)]">
      <div className="mx-auto flex w-full max-w-[calc(28rem+1.5rem)] flex-1 flex-col px-3 pb-6 pt-4">
        <header className="mb-3 flex shrink-0 items-center gap-2 border-b border-[var(--app-border)] pb-3">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to dashboard"
            className="rounded-lg border border-[var(--app-border)] bg-[var(--app-card)] px-2 py-1.5 text-app-caption text-[var(--app-title)] transition hover:bg-[var(--app-card-hover)]"
          >
            ←
          </button>
          <h1 className="text-app-heading font-bold tracking-tight text-[var(--app-title)]">
            Services
          </h1>
        </header>

        <p className="mb-2 text-app-caption text-[var(--app-subtitle)]">
          Turn feeds on or off. Disabled services stay in your list but are not
          fetched or shown on the dashboard.
        </p>

        <div className="max-h-[calc(100vh-12rem)] overflow-y-auto rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-3 py-1 shadow-sm ring-1 ring-black/5 dark:ring-0">
          {config.services
            .filter((s) => !isDeadServiceName(s.name))
            .map((s) => (
              <ToggleRow
                key={s.name}
                service={s}
                onToggle={() => void toggle(s.name)}
                onUrlSave={(newUrl) => void saveUrl(s.name, newUrl)}
              />
            ))}
        </div>
      </div>
    </div>
  );
}
