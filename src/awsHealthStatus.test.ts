import { describe, expect, it } from "vitest";
import {
  isAwsHealthDataUrl,
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
