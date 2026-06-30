import { describe, expect, it } from "vitest";
import {
  isAwsHealthDataUrl,
  isUsOrGlobalRegion,
  normalizeAwsDataJson,
  parseAwsHealthDataBuffer,
} from "./awsHealthStatus";

describe("isAwsHealthDataUrl", () => {
  it("returns true for status.aws.amazon.com/data.json", () => {
    expect(isAwsHealthDataUrl("https://status.aws.amazon.com/data.json")).toBe(
      true,
    );
  });

  it("allows trailing slash normalization", () => {
    expect(isAwsHealthDataUrl("https://status.aws.amazon.com/data.json/")).toBe(
      true,
    );
  });

  it("returns false for other hosts or paths", () => {
    expect(isAwsHealthDataUrl("https://example.com/data.json")).toBe(false);
    expect(isAwsHealthDataUrl("https://status.aws.amazon.com/other.json")).toBe(
      false,
    );
    expect(isAwsHealthDataUrl("not a url")).toBe(false);
  });
});

describe("isUsOrGlobalRegion", () => {
  it("keeps us-* regions", () => {
    expect(isUsOrGlobalRegion("us-east-1")).toBe(true);
    expect(isUsOrGlobalRegion("us-west-2")).toBe(true);
    expect(isUsOrGlobalRegion("us-gov-east-1")).toBe(true);
  });

  it("keeps global and region-less events", () => {
    expect(isUsOrGlobalRegion("global")).toBe(true);
    expect(isUsOrGlobalRegion("")).toBe(true);
    expect(isUsOrGlobalRegion(undefined)).toBe(true);
  });

  it("drops non-US regions", () => {
    expect(isUsOrGlobalRegion("me-south-1")).toBe(false);
    expect(isUsOrGlobalRegion("eu-west-1")).toBe(false);
    expect(isUsOrGlobalRegion("ap-southeast-2")).toBe(false);
    expect(isUsOrGlobalRegion("sa-east-1")).toBe(false);
  });
});

describe("normalizeAwsDataJson region filtering", () => {
  const event = (region: string, summary: string) => ({
    arn: `arn:aws:health:${region}:event/${summary}`,
    region_name: region,
    summary,
  });

  it("drops non-US events and keeps us-* / global", () => {
    const result = normalizeAwsDataJson([
      event("me-south-1", "Outage in Bahrain"),
      event("us-east-1", "Increased error rates"),
      event("global", "Console sign-in latency"),
    ]);
    const names = result.components.map((c) => c.name);
    expect(names.some((n) => n.includes("me-south-1"))).toBe(false);
    expect(names.some((n) => n.includes("us-east-1"))).toBe(true);
    expect(names.some((n) => n.includes("global"))).toBe(true);
  });

  it("reports no US events when only non-US regions are present", () => {
    const result = normalizeAwsDataJson([
      event("me-south-1", "Outage in Bahrain"),
      event("eu-west-1", "EU latency"),
    ]);
    expect(result.status.indicator).toBe("none");
    expect(result.components).toHaveLength(1);
    expect(result.components[0].status).toBe("operational");
  });
});

describe("parseAwsHealthDataBuffer", () => {
  it("returns empty array for empty buffer", () => {
    expect(parseAwsHealthDataBuffer(new ArrayBuffer(0))).toEqual([]);
  });

  it("parses UTF-8 JSON", () => {
    const enc = new TextEncoder();
    const buf = enc.encode('{"hello":1}').buffer;
    expect(parseAwsHealthDataBuffer(buf)).toEqual({ hello: 1 });
  });

  it("strips UTF-8 BOM before JSON.parse", () => {
    const raw = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...new TextEncoder().encode("{}"),
    ]);
    expect(parseAwsHealthDataBuffer(raw.buffer)).toEqual({});
  });
});
