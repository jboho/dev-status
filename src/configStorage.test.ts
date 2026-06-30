import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadAppConfig, persistAppConfig } from "./configStorage";
import type { AppConfig } from "./types";

const STORAGE_KEY = "dev-status.config.v1";

function seed(config: AppConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

describe("loadAppConfig – dead service removal (browser path)", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("strips a saved Redis entry and never re-adds it", async () => {
    seed({
      services: [
        {
          name: "GitHub",
          url: "https://www.githubstatus.com/api/v2/summary.json",
        },
        { name: "Redis", url: "https://status.redis.com/api/v2/summary.json" },
      ],
    });

    const config = await loadAppConfig();

    expect(config.services.some((s) => s.name === "Redis")).toBe(false);
    // Removal is persisted so it does not churn on the next launch.
    const persisted = JSON.parse(
      localStorage.getItem(STORAGE_KEY)!,
    ) as AppConfig;
    expect(persisted.services.some((s) => s.name === "Redis")).toBe(false);
  });

  it("keeps a user's deselection of a service across reloads", async () => {
    seed({
      services: [
        {
          name: "GitHub",
          url: "https://www.githubstatus.com/api/v2/summary.json",
          enabled: false,
        },
      ],
    });

    const first = await loadAppConfig();
    expect(first.services.find((s) => s.name === "GitHub")?.enabled).toBe(
      false,
    );

    const second = await loadAppConfig();
    expect(second.services.find((s) => s.name === "GitHub")?.enabled).toBe(
      false,
    );
  });

  it("does not persist dead services on save", async () => {
    seed({
      services: [
        {
          name: "GitHub",
          url: "https://www.githubstatus.com/api/v2/summary.json",
        },
        { name: "Redis", url: "https://status.redis.com/api/v2/summary.json" },
      ],
    });

    await persistAppConfig({
      services: [
        {
          name: "GitHub",
          url: "https://www.githubstatus.com/api/v2/summary.json",
        },
        { name: "Redis", url: "https://status.redis.com/api/v2/summary.json" },
      ],
    });

    const persisted = JSON.parse(
      localStorage.getItem(STORAGE_KEY)!,
    ) as AppConfig;
    expect(persisted.services.some((s) => s.name === "Redis")).toBe(false);
  });
});

describe("loadAppConfig legacy URL fixes", () => {
  beforeEach(() => localStorage.clear());

  it("rewrites the legacy Stripe apex URL to the canonical www host", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        services: [
          {
            name: "Stripe",
            url: "https://stripestatus.com/api/v2/summary.json",
          },
        ],
      }),
    );

    const config = await loadAppConfig();
    const stripe = config.services.find((s) => s.name === "Stripe");

    expect(stripe?.url).toBe(
      "https://www.stripestatus.com/api/v2/summary.json",
    );
  });

  it("rewrites the legacy Notion status.notion.so URL", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        services: [
          {
            name: "Notion",
            url: "https://status.notion.so/api/v2/summary.json",
          },
        ],
      }),
    );

    const config = await loadAppConfig();
    const notion = config.services.find((s) => s.name === "Notion");

    expect(notion?.url).toBe(
      "https://www.notion-status.com/api/v2/summary.json",
    );
  });

  it("rewrites the legacy Linear status.linear.app URL", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        services: [
          {
            name: "Linear",
            url: "https://status.linear.app/api/v2/summary.json",
          },
        ],
      }),
    );

    const config = await loadAppConfig();
    const linear = config.services.find((s) => s.name === "Linear");

    expect(linear?.url).toBe("https://linearstatus.com/api/v2/summary.json");
  });

  it("drops services with retired feeds (Anthropic, Redis) from saved config", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        services: [
          {
            name: "Anthropic",
            url: "https://status.anthropic.com/api/v2/summary.json",
          },
          {
            name: "Redis",
            url: "https://status.redis.com/api/v2/summary.json",
          },
        ],
      }),
    );

    const config = await loadAppConfig();

    expect(config.services.find((s) => s.name === "Anthropic")).toBeUndefined();
    expect(config.services.find((s) => s.name === "Redis")).toBeUndefined();
  });
});
