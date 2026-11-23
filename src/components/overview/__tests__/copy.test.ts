import { describe, expect, it } from "vitest";

import { parseFindingsQuery } from "@/lib/api/params";

import {
  coverageReason,
  evidenceName,
  formatPoints,
  listWords,
  missingEvidenceText,
  notMeasurable,
  unitDeltaFormat,
  weekOnWeek,
} from "../copy";
import { hotSpotHref, ruleHref, TILE_HREF } from "../links";
import { overviewFixture } from "./fixture";

const MINUS = "−";
const options = { locale: "en-GB" };

describe("words", () => {
  it("joins lists the UK way", () => {
    expect(listWords([])).toBe("");
    expect(listWords(["code review"])).toBe("code review");
    expect(listWords(["code review", "testing"], "or")).toBe("code review or testing");
    expect(listWords(["a", "b", "c"])).toBe("a, b and c");
  });

  it("names evidence as a reader says it", () => {
    expect(evidenceName("code_review")).toBe("code review");
    expect(evidenceName("dev_signoff")).toBe("dev sign-off");
    expect(evidenceName("pull_request_links")).toBe("pull request links");
    expect(missingEvidenceText(["code_review", "testing"])).toBe("No code review or testing in Jira");
    expect(missingEvidenceText(["code_review", "testing"], { inJira: false })).toBe("No code review or testing");
    expect(missingEvidenceText([])).toBe("Jira holds no evidence for it");
  });

  it("collects the rules Jira cannot evaluate and what they lack", () => {
    expect(notMeasurable(overviewFixture().by_rule)).toEqual({
      ids: ["R-FLOW-01", "W-REV-01"],
      missing: ["code_review", "testing"],
    });
  });

  it("gives a coverage gap's reason as the note's first clause", () => {
    const { coverage } = overviewFixture();
    expect(coverageReason(coverage.code_review)).toBe("Jira records no code review for DEMO, so it cannot be counted.");
    expect(coverageReason({ ...coverage.code_review, note: "No source for it." })).toBe("No source for it.");
  });
});

describe("changes", () => {
  it("reads a change in a share in percentage points", () => {
    expect(formatPoints(0.05, options)).toBe("5 pts");
    expect(formatPoints(0.01, options)).toBe("1 pt");
    expect(unitDeltaFormat("share")(-0.0526, options)).toBe(`${MINUS}5 pts`);
    expect(unitDeltaFormat("share")(0.003, options)).toBe("0 pts");
  });

  it("signs a change in the figure's own unit", () => {
    expect(unitDeltaFormat("hours")(113.4 - 143.55, options)).toBe(`${MINUS}30.2 h`);
    expect(unitDeltaFormat("ratio")(1.2734 - 1.3813, options)).toBe(`${MINUS}0.11×`);
    expect(unitDeltaFormat("count")(10, options)).toBe("+10");
  });

  it("has no change when either week is unmeasured", () => {
    expect(weekOnWeek(2, null)).toBeNull();
    expect(weekOnWeek(null, 2)).toBeNull();
    expect(weekOnWeek(3, 1)).toBe(2);
  });
});

describe("links", () => {
  const search = (href: string) => new URLSearchParams(href.split("?")[1] ?? "");

  it("opens exactly the findings behind each tile, in a query the Findings page accepts", () => {
    for (const href of Object.values(TILE_HREF).filter((value) => value.startsWith("/findings"))) {
      expect(parseFindingsQuery(search(href)).ok).toBe(true);
    }
    expect(TILE_HREF.open_breaches).toBe("/findings?severity=breach&state=open");
    expect(TILE_HREF.new_7d).toBe("/findings?state=all&first_seen=7d");
  });

  it("opens a hot spot's open findings, and work outside every epic as epic=none", () => {
    expect(hotSpotHref({ epic_key: "DEMO-704" })).toBe("/findings?state=open&epic=DEMO-704");
    expect(hotSpotHref({ epic_key: null })).toBe("/findings?state=open&epic=none");
    expect(parseFindingsQuery(search(hotSpotHref({ epic_key: null }))).ok).toBe(true);
  });

  it("opens a rule's findings, or the process map for a rule Jira cannot evaluate", () => {
    expect(ruleHref({ rule_id: "R-EST-01", measurable: true })).toBe("/findings?rule=R-EST-01");
    expect(ruleHref({ rule_id: "R-FLOW-01", measurable: false })).toBe("/process");
  });
});
