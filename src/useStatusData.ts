import { useState, useEffect, useRef, useCallback } from "react";
import { arrayMove } from "@dnd-kit/sortable";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isServiceEnabled, type AppConfig } from "./types";
import {
  loadAppConfig,
  persistAppConfig,
  persistBrowserConfigSync,
} from "./configStorage";
import { diffOverallIndicators, STATUS_POLL_INTERVAL_MS } from "./statusChange";
import { notifyIndicatorChanges } from "./statusNotify";
import { fetchOneService } from "./statusFetch";
import {
  applyFetchResult,
  emptyFetchState,
  type FetchResult,
  type ServiceFetchState,
} from "./serviceStatusState";

export function useStatusData() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const configRef = useRef<AppConfig | null>(null);
  const [fetchState, setFetchState] =
    useState<ServiceFetchState>(emptyFetchState);
  const fetchStateRef = useRef<ServiceFetchState>(emptyFetchState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  const fetchConfig = async () => {
    try {
      const parsed = await loadAppConfig();
      setConfig(parsed);
      return parsed;
    } catch (err) {
      console.error("Failed to fetch config", err);
      setError("Failed to load configuration");
      return null;
    }
  };

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

  const saveConfig = useCallback(async (next: AppConfig) => {
    await persistAppConfig(next);
    configRef.current = next;
    setConfig(next);
  }, []);

  /** Reorder by service name using latest config (avoids stale closure on rapid drags). */
  const reorderServices = useCallback(
    async (activeId: string, overId: string) => {
      if (activeId === overId) return;
      const c = configRef.current;
      if (!c) return;
      const oldIndex = c.services.findIndex((s) => s.name === activeId);
      const newIndex = c.services.findIndex((s) => s.name === overId);
      if (oldIndex < 0 || newIndex < 0) return;
      const next: AppConfig = {
        ...c,
        services: arrayMove(c.services, oldIndex, newIndex),
      };
      await persistAppConfig(next);
      configRef.current = next;
      setConfig(next);
    },
    [],
  );

  const refresh = useCallback(async () => {
    const c = configRef.current;
    if (!c) return;
    setRefreshing(true);
    try {
      await fetchStatuses(c);
    } finally {
      setRefreshing(false);
    }
  }, [fetchStatuses]);

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval>;

    const init = async () => {
      setLoading(true);
      setError(null);
      const loadedConfig = await fetchConfig();
      if (loadedConfig) {
        await fetchStatuses(loadedConfig);

        intervalId = setInterval(() => {
          const c = configRef.current;
          if (c) void fetchStatuses(c);
        }, STATUS_POLL_INTERVAL_MS);
      }
    };

    void init();

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [fetchStatuses]);

  useEffect(() => {
    if (isTauri()) {
      const promise = getCurrentWindow().onCloseRequested(async () => {
        const c = configRef.current;
        if (c) await persistAppConfig(c);
      });
      return () => {
        void promise.then((unlisten) => unlisten());
      };
    }

    const onBeforeUnload = () => {
      const c = configRef.current;
      if (c) persistBrowserConfigSync(c);
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // Only surface state for currently-enabled services. Without this filter,
  // disabling a service leaves its stale error in the banner until the next poll
  // clears it — which never happens because disabled services aren't fetched.
  const enabledNames = config
    ? new Set(config.services.filter(isServiceEnabled).map((s) => s.name))
    : null;
  const visibleErrors = enabledNames
    ? Object.fromEntries(
        Object.entries(fetchState.errors).filter(([k]) => enabledNames.has(k)),
      )
    : fetchState.errors;
  const visibleStatuses = enabledNames
    ? Object.fromEntries(
        Object.entries(fetchState.statuses).filter(([k]) =>
          enabledNames.has(k),
        ),
      )
    : fetchState.statuses;
  const visibleLastSuccessAt = enabledNames
    ? Object.fromEntries(
        Object.entries(fetchState.lastSuccessAt).filter(([k]) =>
          enabledNames.has(k),
        ),
      )
    : fetchState.lastSuccessAt;

  return {
    config,
    saveConfig,
    reorderServices,
    statuses: visibleStatuses,
    errors: visibleErrors,
    lastSuccessAt: visibleLastSuccessAt,
    retryService,
    loading,
    error,
    lastFetchedAt,
    refresh,
    refreshing,
  };
}
