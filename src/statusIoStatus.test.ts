import { describe, expect, it } from "vitest";
import {
  isStatusIoUrl,
  normalizeStatusIoJson,
  statusIoPageId,
} from "./statusIoStatus";

const GITLAB_ID = "5b36dc6502d06804c08349f7";
const GITLAB_URL = `https://api.status.io/1.0/status/${GITLAB_ID}`;

// Trimmed from the live GitLab feed during the 2026-10-14 CI/CD incident.
function gitlabPayload(overallCode: number, overallStatus: string) {
  return {
    result: {
      status_overall: {
        updated: "2026-10-14T15:22:51.551Z",
        status: overallStatus,
        status_code: overallCode,
      },
      status: [
        {
          id: "5b36e05f02d06804c0834a09",
          name: "API",
          status: "Operational",
          status_code: 100,
        },
        {
          id: "67ea346990c050053ab18e89",
          name: "CI/CD",
          status: "Partial Service Disruption",
          status_code: 400,
        },
      ],
      incidents: [],
      maintenance: { active: [], upcoming: [] },
    },
  };
}

describe("statusIoPageId / isStatusIoUrl", () => {
  it("extracts the page ID from a status.io status URL", () => {
    expect(statusIoPageId(GITLAB_URL)).toBe(GITLAB_ID);
    expect(statusIoPageId(`${GITLAB_URL}/`)).toBe(GITLAB_ID);
    expect(isStatusIoUrl(GITLAB_URL)).toBe(true);
  });

  it("rejects other hosts, paths and non-URLs", () => {
    expect(
      isStatusIoUrl(`https://status.gitlab.com/1.0/status/${GITLAB_ID}`),
    ).toBe(false);
    expect(isStatusIoUrl("https://api.status.io/1.0/status/not-an-id")).toBe(
      false,
    );
    expect(
      isStatusIoUrl("https://www.githubstatus.com/api/v2/summary.json"),
    ).toBe(false);
    expect(isStatusIoUrl("not a url")).toBe(false);
  });
});

describe("normalizeStatusIoJson", () => {
  it("maps the GitLab feed to the Statuspage shape", () => {
    const out = normalizeStatusIoJson(
      gitlabPayload(400, "Partial Service Disruption"),
      GITLAB_ID,
    );
    expect(out.page).toEqual({
      id: GITLAB_ID,
      name: "GitLab",
      url: "https://status.gitlab.com",
      updated_at: "2026-10-14T15:22:51.551Z",
    });
    expect(out.status).toEqual({
      indicator: "major",
      description: "Partial Service Disruption",
    });
    expect(out.components).toEqual([
      { id: "5b36e05f02d06804c0834a09", name: "API", status: "operational" },
      {
        id: "67ea346990c050053ab18e89",
        name: "CI/CD",
        status: "partial_outage",
      },
    ]);
  });

  it.each([
    [100, "none"],
    [200, "maintenance"],
    [300, "minor"],
    [400, "major"],
    [500, "critical"],
    [600, "critical"],
    [999, "minor"],
  ])("maps overall code %i to indicator %s", (code, indicator) => {
    const out = normalizeStatusIoJson(gitlabPayload(code, "x"), GITLAB_ID);
    expect(out.status.indicator).toBe(indicator);
  });

  it("never shows an unknown component code as operational", () => {
    const payload = gitlabPayload(100, "Operational");
    payload.result.status[0].status_code = 700;
    const out = normalizeStatusIoJson(payload, GITLAB_ID);
    expect(out.components[0].status).toBe("degraded_performance");
  });

  it("links an unknown page ID to its status.io page", () => {
    const id = "0123456789abcdef01234567";
    const out = normalizeStatusIoJson(gitlabPayload(100, "Operational"), id);
    expect(out.page.url).toBe(`https://status.io/pages/${id}`);
  });

  it("throws on an unexpected shape instead of reporting all clear", () => {
    expect(() => normalizeStatusIoJson({}, GITLAB_ID)).toThrow(
      "Unexpected status.io data shape",
    );
    expect(() => normalizeStatusIoJson(null, GITLAB_ID)).toThrow();
    expect(() =>
      normalizeStatusIoJson({ result: { status_overall: {} } }, GITLAB_ID),
    ).toThrow();
  });
});
