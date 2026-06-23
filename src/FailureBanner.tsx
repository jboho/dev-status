import { useState } from "react";

export type ServiceFailure = { name: string; message: string };

type FailureBannerProps = {
  failures: ServiceFailure[];
  total: number;
  onRetry: (name: string) => void | Promise<void>;
};

export function FailureBanner({
  failures,
  total,
  onRetry,
}: FailureBannerProps) {
  const [open, setOpen] = useState(false);
  const [retrying, setRetrying] = useState<Record<string, boolean>>({});

  if (failures.length === 0) return null;

  const handleRetry = async (name: string) => {
    setRetrying((r) => ({ ...r, [name]: true }));
    try {
      await Promise.resolve(onRetry(name));
    } finally {
      setRetrying((r) => {
        const next = { ...r };
        delete next[name];
        return next;
      });
    }
  };

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
                onClick={() => void handleRetry(f.name)}
                disabled={retrying[f.name]}
                aria-label={`Retry ${f.name}`}
                className="shrink-0 rounded-md border border-[var(--app-border)] bg-[var(--app-card)] px-2 py-0.5 text-app-caption text-[var(--app-title)] transition hover:bg-[var(--app-card-hover)] disabled:pointer-events-none disabled:opacity-50"
              >
                {retrying[f.name] ? (
                  <span className="inline-block animate-spin" aria-hidden>
                    ↻
                  </span>
                ) : (
                  "Retry"
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
