import { describe, expect, it } from "vitest";
import { resolveStatusPageHref } from "./statusPageUrl";
import type { StatuspageResponse } from "./types";

function summary(page: StatuspageResponse["page"]): StatuspageResponse {
  return {
    page,
    status: { indicator: "none", description: "All systems operational" },
    components: [],
  };
}

describe("resolveStatusPageHref", () => {
  it("prefers a valid https page.url from the API", () => {
    const data = summary({
      id: "1",
      name: "Svc",
      url: "https://status.example.com/",
    });
    expect(
      resolveStatusPageHref(data, "https://x.com/api/v2/summary.json"),
    ).toBe("https://status.example.com/");
  });

  it("strips Statuspage summary path from the config URL when page.url is missing", () => {
    const data = summary({ id: "1", name: "Svc" });
    expect(
      resolveStatusPageHref(
        data,
        "https://www.githubstatus.com/api/v2/summary.json",
      ),
    ).toBe("https://www.githubstatus.com");
  });

  it("maps AWS data.json to the public status home", () => {
    const data = summary({ id: "1", name: "AWS" });
    expect(
      resolveStatusPageHref(data, "https://status.aws.amazon.com/data.json"),
    ).toBe("https://status.aws.amazon.com/");
  });

  it("falls back to AWS home on unparseable api URL", () => {
    const data = summary({ id: "1", name: "X" });
    expect(resolveStatusPageHref(data, "not-a-url")).toBe(
      "https://status.aws.amazon.com/",
    );
  });
});
