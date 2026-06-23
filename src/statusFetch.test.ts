import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchOneService, utf8JsonParse } from "./statusFetch";
import type { ServiceConfig } from "./types";

describe("utf8JsonParse", () => {
  it("parses UTF-8 JSON from ArrayBuffer", () => {
    const buf = new TextEncoder().encode('{"x":true}').buffer;
    expect(utf8JsonParse(buf)).toEqual({ x: true });
  });

  it("strips leading BOM", () => {
    const withBom = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...new TextEncoder().encode('{"a":2}'),
    ]);
    expect(utf8JsonParse(withBom.buffer)).toEqual({ a: 2 });
  });
});

describe("fetchOneService (browser path)", () => {
  afterEach(() => vi.unstubAllGlobals());

  const svc: ServiceConfig = {
    name: "GitHub",
    url: "https://www.githubstatus.com/api/v2/summary.json",
  };

  it("returns parsed JSON on a 200 response", async () => {
    const body = {
      page: { id: "p", name: "GitHub" },
      status: { indicator: "none", description: "All Systems Operational" },
      components: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
    );
    await expect(fetchOneService(svc)).resolves.toEqual(body);
  });

  it("throws with the HTTP status on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 })),
    );
    await expect(fetchOneService(svc)).rejects.toThrow(
      "HTTP error! status: 404",
    );
  });

  it("sends only CORS-safelisted headers so it never triggers a preflight", async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response("{}", { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    await fetchOneService(svc);

    const init = fetchMock.mock.calls[0]?.[1];
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const names = Object.keys(headers).map((h) => h.toLowerCase());
    // Cache-Control / Pragma are NOT safelisted — their presence forces an
    // OPTIONS preflight that the statuspage feeds reject with a redirect.
    expect(names).not.toContain("cache-control");
    expect(names).not.toContain("pragma");
    expect(init?.cache).toBe("no-store");
  });
});
