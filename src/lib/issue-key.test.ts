import { describe, expect, it } from "vitest";

import { isIssueKey, issueKeyFromSegment, parseIssueKey } from "./issue-key";

describe("parseIssueKey", () => {
  it("normalises what readers actually type", () => {
    expect(parseIssueKey("DEMO-142")).toBe("DEMO-142");
    expect(parseIssueKey("demo-142")).toBe("DEMO-142");
    expect(parseIssueKey("  Demo 142 ")).toBe("DEMO-142");
    expect(parseIssueKey("DEMO-0142")).toBe("DEMO-142");
    expect(parseIssueKey("AIL_2-7")).toBe("AIL_2-7");
  });

  it("reads a bare number as an issue in the default project", () => {
    expect(parseIssueKey("142", "demo")).toBe("DEMO-142");
    expect(parseIssueKey("#142", "DEMO")).toBe("DEMO-142");
    expect(parseIssueKey("142")).toBeNull();
  });

  it("rejects text that is not a key", () => {
    expect(parseIssueKey("")).toBeNull();
    expect(parseIssueKey("where do tickets get stuck")).toBeNull();
    expect(parseIssueKey("A-1")).toBeNull();
    expect(parseIssueKey("1DEMO-4")).toBeNull();
    expect(parseIssueKey("DEMO-0")).toBeNull();
    expect(parseIssueKey("TOOLONGPROJECT-1")).toBeNull();
  });
});

describe("isIssueKey", () => {
  it("accepts only the canonical form", () => {
    expect(isIssueKey("DEMO-1")).toBe(true);
    expect(isIssueKey("demo-1")).toBe(false);
    expect(isIssueKey("DEMO 1")).toBe(false);
    expect(isIssueKey("DEMO-01")).toBe(false);
  });
});

describe("issueKeyFromSegment", () => {
  it("reads the key in an issue address, upper-cased", () => {
    expect(issueKeyFromSegment("DEMO-1")).toBe("DEMO-1");
    expect(issueKeyFromSegment("demo-12")).toBe("DEMO-12");
    expect(issueKeyFromSegment("DEMO%2D12")).toBe("DEMO-12");
  });

  it("is null for an address that cannot hold a key", () => {
    expect(issueKeyFromSegment("not-a-key")).toBeNull();
    expect(issueKeyFromSegment("DEMO%2012")).toBeNull();
    expect(issueKeyFromSegment("%E0%A4%A")).toBeNull();
  });
});
