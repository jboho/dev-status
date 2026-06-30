import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ServicesScreen } from "./ServicesScreen";
import { useStatusData } from "./useStatusData";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { openExternalUrl } from "./openExternal";
import { formatPollIntervalLabel } from "./statusChange";
import { resolveStatusPageHref } from "./statusPageUrl";
import { isServiceEnabled, type StatuspageResponse } from "./types";
import { isTauri, invoke } from "@tauri-apps/api/core";
import { FailureBanner, type ServiceFailure } from "./FailureBanner";
import { deriveServiceState } from "./serviceStatusState";
import { isDeadServiceName } from "./configStorage";

const THEME_KEY = "dev-status-theme";

function getInitialIsDark(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(THEME_KEY) !== "light";
}

type Indicator = string;

function indicatorRank(ind: string): number {
  const x = ind.toLowerCase();
  if (x === "critical" || x === "major") return 3;
  if (x === "minor") return 2;
  if (x === "maintenance") return 1;
  return 0;
}

function overallIndicatorFromStatuses(
  statuses: Record<string, { status: { indicator: string } }>,
): Indicator {
  let worst: Indicator = "none";
  for (const s of Object.values(statuses)) {
    const ind = s.status.indicator.toLowerCase();
    if (indicatorRank(ind) > indicatorRank(worst)) worst = ind;
  }
  return worst;
}

function cardLeftAccent(indicator: string): string {
  const i = indicator.toLowerCase();
  if (i === "none") return "border-l-[3px] border-l-emerald-500";
  if (i === "minor") return "border-l-[3px] border-l-amber-500";
  if (i === "maintenance") return "border-l-[3px] border-l-sky-500";
  return "border-l-[3px] border-l-orange-500";
}

function statusDotClass(indicator: string): string {
  const i = indicator.toLowerCase();
  if (i === "none")
    return "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]";
  if (i === "minor")
    return "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.4)]";
  if (i === "maintenance") return "bg-sky-400";
  return "bg-orange-400 shadow-[0_0_8px_rgba(251,146,60,0.45)]";
}

function componentDotClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "operational") return "bg-emerald-400";
  if (s === "degraded_performance") return "bg-amber-400";
  if (s === "partial_outage" || s === "major_outage") return "bg-red-400";
  if (s === "under_maintenance") return "bg-sky-400";
  return "bg-zinc-500";
}

/** Text color for status label (matches dot semantics) */
function componentStatusTextClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "operational") return "text-emerald-600 dark:text-emerald-400";
  if (s === "degraded_performance") return "text-amber-600 dark:text-amber-400";
  if (s === "partial_outage" || s === "major_outage")
    return "text-red-600 dark:text-red-400";
  if (s === "under_maintenance") return "text-sky-600 dark:text-sky-400";
  return "text-[var(--app-muted)]";
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatStaleLabel(sinceMs: number | undefined, now: Date): string {
  if (sinceMs == null) return "stale";
  const mins = Math.floor((now.getTime() - sinceMs) / 60_000);
  return mins < 1 ? "stale <1m" : `stale ${mins}m`;
}

function formatUpdatedLabel(
  iso: string | undefined,
  fallback: Date | null,
): string {
  if (iso) {
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return formatTime(d);
  }
  if (fallback) return formatTime(fallback);
  return "—";
}

function humanStatus(status: string): string {
  return status.replace(/_/g, " ");
}

type ServiceCardProps = {
  service: { name: string; url: string };
  data: StatuspageResponse;
  lastFetchedAt: Date | null;
  isStale?: boolean;
  staleLabel?: string;
  onRetry?: () => void;
};

function ServiceCard({
  service,
  data,
  lastFetchedAt,
  isStale,
  staleLabel,
  onRetry,
}: ServiceCardProps) {
  const statusPageHref = resolveStatusPageHref(data, service.url);
  const ind = data.status.indicator;
  const componentCount = data.components.filter(
    (c) => !c.id.includes("group"),
  ).length;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: service.name });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : 1,
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={`overflow-hidden rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] shadow-sm ring-1 ring-black/5 dark:shadow-[0_0_0_1px_rgba(0,0,0,0.1)] dark:ring-0 ${cardLeftAccent(ind)}`}
    >
      <div className="flex gap-0">
        <button
          type="button"
          className="w-7 shrink-0 cursor-grab touch-none select-none border-r border-[var(--app-border)] bg-[var(--app-card-hover)] py-3 text-app-body leading-none text-[var(--app-muted)] hover:opacity-90 dark:bg-black/20 dark:hover:bg-black/30 active:cursor-grabbing"
          aria-label={`Drag to reorder ${service.name}`}
          {...attributes}
          {...listeners}
        >
          ⋮
        </button>

        <Accordion className="min-w-0 flex-1">
          <AccordionItem value="components" className="border-0">
            <AccordionTrigger className="items-center gap-2 px-2.5 py-3 hover:no-underline [&_[data-slot=accordion-trigger-icon]]:mt-0">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusDotClass(ind)}`}
                  aria-hidden
                />
                <div className="min-w-0 text-left">
                  <h2 className="text-app-body font-semibold tracking-tight text-[var(--app-title)]">
                    {service.name}
                  </h2>
                  <span className="sr-only">
                    {data.status.description}, service status
                  </span>
                </div>
              </div>
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
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-0 border-t border-[var(--app-border)] px-2.5 pb-2.5 pt-0.5">
                {data.components
                  .filter((c) => !c.id.includes("group"))
                  .map((component) => (
                    <div
                      key={component.id}
                      className="flex items-center justify-between gap-3 border-b border-[var(--app-border)] py-1.5 last:border-0"
                    >
                      <span className="min-w-0 truncate text-app-caption text-[var(--app-subtitle)]">
                        {component.name}
                      </span>
                      <div className="flex shrink-0 items-center gap-2">
                        <span
                          className={`text-app-caption font-medium capitalize ${componentStatusTextClass(component.status)}`}
                        >
                          {humanStatus(component.status)}
                        </span>
                        <span
                          className={`h-2.5 w-2.5 shrink-0 rounded-full ${componentDotClass(component.status)}`}
                          aria-hidden
                        />
                      </div>
                    </div>
                  ))}
                <div className="mt-2 flex flex-row flex-wrap items-center justify-between gap-x-2 gap-y-1 pt-1.5">
                  <a
                    href={statusPageHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 shrink text-app-caption text-[var(--app-muted)] transition-colors hover:text-[var(--app-title)]"
                    onClick={(e) => {
                      if (isTauri()) {
                        e.preventDefault();
                        void openExternalUrl(statusPageHref);
                      }
                    }}
                  >
                    View status page →
                  </a>
                  {isStale && onRetry && (
                    <button
                      type="button"
                      onClick={onRetry}
                      aria-label={`Retry ${service.name}`}
                      className="shrink-0 rounded-md border border-[var(--app-border)] bg-[var(--app-card)] px-2 py-0.5 text-app-caption text-[var(--app-title)] transition hover:bg-[var(--app-card-hover)]"
                    >
                      Retry
                    </button>
                  )}
                  <p className="m-0 shrink-0 text-right text-app-caption text-[var(--app-muted)] tabular-nums">
                    Updated{" "}
                    {formatUpdatedLabel(data.page.updated_at, lastFetchedAt)}
                  </p>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </article>
  );
}

function App() {
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
  const [screen, setScreen] = useState<"dashboard" | "services">("dashboard");
  const [now, setNow] = useState(() => new Date());
  const [isDark, setIsDark] = useState(getInitialIsDark);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
    localStorage.setItem(THEME_KEY, isDark ? "dark" : "light");
  }, [isDark]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const overall = useMemo(
    () => overallIndicatorFromStatuses(statuses),
    [statuses],
  );

  useEffect(() => {
    if (!isTauri()) return;
    void invoke("update_tray_icon", { indicator: overall });
  }, [overall]);

  const enabledServices = useMemo(() => {
    if (!config) return [];
    return config.services.filter(
      (s) => isServiceEnabled(s) && !isDeadServiceName(s.name),
    );
  }, [config]);

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

  const healthyCount = useMemo(() => {
    return visibleServices.filter(
      (s) => statuses[s.name]!.status.indicator.toLowerCase() === "none",
    ).length;
  }, [visibleServices, statuses]);

  const totalTracked = visibleServices.length;

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    void reorderServices(String(active.id), String(over.id));
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--app-bg)] text-[var(--app-muted)]">
        <p className="animate-pulse text-app-body">Loading…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--app-bg)] p-4 text-center text-app-body text-red-600 dark:text-red-400">
        <p>{error}</p>
      </div>
    );
  }

  if (screen === "services" && config) {
    return (
      <ServicesScreen
        config={config}
        onBack={() => setScreen("dashboard")}
        onSave={async (next) => {
          await saveConfig(next);
          await refresh();
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[var(--app-bg)] text-[var(--app-body)]">
      <div className="mx-auto max-w-[calc(28rem+1.5rem)] px-3 pb-6 pt-4">
        <header className="mb-3 flex flex-row flex-nowrap items-start justify-between gap-3 border-b border-[var(--app-border)] pb-3">
          <div className="min-w-0 flex-1 pt-0.5">
            <h1 className="text-app-heading font-bold tracking-tight text-[var(--app-title)]">
              DevStatus
            </h1>
            <p className="mt-0.5 text-app-caption leading-snug text-[var(--app-subtitle)]">
              essential services - live monitoring
            </p>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-1 self-start">
            <div className="flex items-center gap-1.5">
              <div className="flex items-center gap-1.5 rounded-full bg-[var(--app-clock-bg)] px-2.5 py-1.5 shadow-sm ring-1 ring-[var(--app-clock-border)]">
                <span
                  className="h-2 w-2 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)] dark:bg-emerald-400 dark:shadow-[0_0_6px_rgba(52,211,153,0.6)]"
                  aria-hidden
                />
                <time
                  className="tabular-nums text-app-caption font-medium text-[var(--app-clock-text)]"
                  dateTime={now.toISOString()}
                >
                  {formatTime(now)}
                </time>
              </div>
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={refreshing}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--app-moon-ring)] bg-[var(--app-moon-bg)] text-app-body leading-none text-[var(--app-moon-fg)] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] transition hover:opacity-90 disabled:pointer-events-none disabled:opacity-50"
                aria-label="Refresh status data"
                title="Refresh"
              >
                <span
                  className={refreshing ? "inline-block animate-spin" : ""}
                  aria-hidden
                >
                  ↻
                </span>
              </button>
              <button
                type="button"
                onClick={() => setIsDark((d) => !d)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--app-moon-ring)] bg-[var(--app-moon-bg)] text-app-icon leading-none text-[var(--app-moon-fg)] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] transition hover:opacity-90"
                aria-label={
                  isDark ? "Switch to light mode" : "Switch to dark mode"
                }
              >
                {isDark ? "🌙" : "☀️"}
              </button>
              <button
                type="button"
                onClick={() => setScreen("services")}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--app-moon-ring)] bg-[var(--app-moon-bg)] text-app-icon leading-none text-[var(--app-moon-fg)] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] transition hover:opacity-90"
                aria-label="Services settings"
                title="Services"
              >
                ⚙
              </button>
            </div>
            <p className="m-0 max-w-[16rem] text-right text-app-caption leading-tight text-[var(--app-muted)] tabular-nums">
              Auto refresh every {formatPollIntervalLabel()} · Last updated{" "}
              {lastFetchedAt ? formatTime(lastFetchedAt) : "—"}
            </p>
          </div>
        </header>

        <section
          className="mb-3 flex items-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-summary)] px-3 py-2 shadow-sm ring-1 ring-black/[0.04] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] dark:ring-white/5"
          aria-label="Overall status"
        >
          <span
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusDotClass(overall)}`}
            aria-hidden
          />
          <p className="text-app-caption tabular-nums text-[var(--app-muted)]">
            {totalTracked === 0 ? (
              "—"
            ) : (
              <>
                <span className="font-medium text-[var(--app-title)]">
                  {healthyCount}
                </span>
                <span className="text-[var(--app-subtitle)]">/</span>
                <span className="font-medium text-[var(--app-title)]">
                  {totalTracked}
                </span>
                <span className="text-[var(--app-subtitle)]"> healthy</span>
              </>
            )}
          </p>
        </section>

        <FailureBanner
          failures={failures}
          total={enabledServices.length}
          onRetry={retryService}
        />

        {enabledServices.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--app-border)] bg-[var(--app-card)] px-3 py-6 text-center text-app-caption text-[var(--app-muted)]">
            No services enabled. Open{" "}
            <button
              type="button"
              onClick={() => setScreen("services")}
              className="text-[var(--app-title)] underline underline-offset-2"
            >
              Services
            </button>{" "}
            to turn some on.
          </p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={visibleServices.map((s) => s.name)}
              strategy={verticalListSortingStrategy}
            >
              <div className="flex flex-col gap-2">
                {visibleServices.map((service) => {
                  const data = statuses[service.name]!;
                  const isStale =
                    deriveServiceState(service.name, statuses, errors) ===
                    "stale";
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
          </DndContext>
        )}
      </div>
    </div>
  );
}

export default App;
