// @vitest-environment node
import { describe, expect, it } from "vitest";

import { parseFindingsQuery } from "@/lib/api/params";
import { buildDataset } from "@/server/sample/dataset";
import { findingDetail, matchingFindings } from "@/server/sample/findings";
import { insightsView } from "@/server/sample/insights";

import { findingsTarget, needsRuleHint } from "../model";

/*
 * Every number traces back: each chip that says "73 open breaches" must open
 * a Findings view holding exactly those 73 findings. Checked against the
 * sample at the frozen time the end-to-end suite uses, and at a later one.
 */

for (const at of ["2026-11-04T14:30:00Z", "2027-01-15T12:00:00Z"]) {
  describe(`the briefing's findings links at ${at}`, () => {
    const dataset = buildDataset(Date.parse(at));
    const briefing = insightsView(dataset);

    it("open exactly each candidate's findings", () => {
      let checked = 0;
      for (const candidate of briefing.candidates) {
        const hint = needsRuleHint(candidate)
          ? findingDetail(dataset, candidate.finding_ids[0])?.finding.rule_id
          : undefined;
        const target = findingsTarget(candidate, hint);
        if (!target) {
          expect(candidate.finding_ids).toEqual([]);
          continue;
        }
        expect(target.exact).toBe(true);
        expect(target.count).toBe(candidate.finding_ids.length);

        const search = new URL(target.href, "http://localhost").searchParams;
        const single = search.get("finding");
        if (single) {
          expect(candidate.finding_ids).toEqual([single]);
          continue;
        }
        const query = parseFindingsQuery(search);
        if (!query.ok) throw new Error(`${target.href} is not a findings query: ${JSON.stringify(query.problems)}`);
        const shown = matchingFindings(dataset, query.value).map((finding) => finding.finding_id);
        expect(new Set(shown)).toEqual(new Set(candidate.finding_ids));
        checked += 1;
      }
      expect(checked).toBeGreaterThan(0);
    });

    it("say what each sentence was written from", () => {
      const ids = new Set(briefing.candidates.map((candidate) => candidate.id));
      for (const sentence of briefing.sentences) {
        expect(sentence.candidate_ids.length).toBeGreaterThan(0);
        for (const id of sentence.candidate_ids) expect(ids.has(id)).toBe(true);
      }
    });
  });
}
