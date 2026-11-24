import { describe, expect, it } from "vitest";

import { attentionKey, portfolioSchema, type AttentionItem } from "@/lib/api/schemas";
import { STALE_AFTER_MS } from "@/lib/sync";

import { sampleBoard } from "../sample/boards";
import { buildDataset, CATALOGUE_SETTINGS, type Dataset } from "../sample/dataset";
import { overview } from "../sample/overview";
import { portfolioView } from "../sample/portfolio";
import { DAY, iso, MINUTE } from "../sample/time";

const NOW = Date.parse("2026-11-04T14:30:00Z");

describe("the sample Portfolio's staleness", () => {
  const dataset = buildDataset(NOW);
  const staleAt = (wallClock: number) => portfolioView([dataset], undefined, wallClock).boards[0].stale;

  it("is the last sync's age when the Portfolio is read, by the server's clock, on the top bar's rule (two hours, JO-14)", () => {
    const synced = dataset.world.syncAt;
    expect(STALE_AFTER_MS).toBe(2 * 60 * MINUTE);
    expect(staleAt(synced + 10 * MINUTE)).toBe(false);
    expect(staleAt(synced + STALE_AFTER_MS - MINUTE)).toBe(false);
    expect(staleAt(synced + STALE_AFTER_MS + MINUTE)).toBe(true);
    // Regression: a day was the Portfolio's own rule, so three hours on it said fresh beside a stale top bar.
    expect(staleAt(synced + 3 * 60 * MINUTE)).toBe(true);
  });

  it("is stale when a sample pinned to SAMPLE_NOW is read days later, as the top bar and the row's own age say", () => {
    // Regression (the check): the row read "synced 8 d ago" in the calm style, the top bar "Stale" in amber.
    expect(staleAt(NOW + 8 * DAY)).toBe(true);
    // Its figures stay the snapshot's: only the staleness is said at the time of reading.
    expect(portfolioView([dataset], undefined, NOW + 8 * DAY).boards[0].open_breaches).toBe(portfolioView([dataset], undefined, NOW).boards[0].open_breaches);
  });
});

describe("the sample's 'Needs attention' ages, on the one clock (JO-14)", () => {
  const dataset = buildDataset(NOW);
  const at = (wallClock: number) => portfolioSchema.parse(portfolioView([dataset], undefined, wallClock)).attention;

  it("say when each breach was last seen, the last rules run, after its first sighting", () => {
    for (const item of at(NOW)) {
      expect(Date.parse(item.last_seen_at)).toBeGreaterThanOrEqual(Date.parse(item.opened_at));
      expect(Date.parse(item.last_seen_at)).toBeLessThanOrEqual(NOW);
    }
  });

  it("count to now while the board's sync is fresh, and stop at the last run that saw them once it is stale", () => {
    const synced = dataset.world.syncAt;
    const fresh = at(synced + 30 * MINUTE);
    for (const item of fresh) expect(item.age_days).toBe(Math.floor((synced + 30 * MINUTE - Date.parse(item.opened_at)) / DAY));
    const later = at(NOW + 8 * DAY);
    for (const [index, item] of later.entries()) {
      expect(item.age_days).toBe(Math.floor((Date.parse(item.last_seen_at) - Date.parse(item.opened_at)) / DAY));
      expect(item.age_days).toBeLessThanOrEqual(fresh[index].age_days);
    }
  });
});

describe("the sample's 'Needs attention', one row for each ticket and rule (13 Nov 2026)", () => {
  /** The open breaches on tickets, as the service reads them. */
  const openBreaches = (dataset: Dataset) =>
    dataset.engine.findings.filter((finding) => finding.resolvedAt === null && finding.rule.severity === "breach" && finding.issue !== null);
  const findingsOf = (dataset: Dataset, item: AttentionItem) =>
    openBreaches(dataset).filter((finding) => finding.issue!.key === item.issue_key && finding.rule.id === item.rule_id);

  it("names each ticket and rule once, with how many open findings of the rule it holds, dated from the oldest", () => {
    const dataset = buildDataset(NOW);
    const attention = portfolioSchema.parse(portfolioView([dataset], undefined, NOW)).attention;
    expect(attention).toHaveLength(10);
    expect(new Set(attention.map(attentionKey)).size).toBe(attention.length);
    for (const item of attention) {
      const mine = findingsOf(dataset, item);
      expect(item.findings).toBe(mine.length);
      expect(item.opened_at).toBe(iso(Math.min(...mine.map((finding) => finding.firstSeenAt))));
    }
  });

  it("lists a ticket holding two open findings of one rule once, counted, and still the ten oldest distinct", () => {
    const before = portfolioView([buildDataset(NOW)], undefined, NOW).attention;
    const dataset = buildDataset(NOW);
    const [first, second] = before.map((item) => findingsOf(dataset, item)[0]);
    dataset.engine.findings.push(
      // Another skipped stage on the oldest's ticket, a week earlier; and one on the second's, seen at the same moment.
      { ...first, id: "f".repeat(32), evidenceKey: "skip-earlier", firstSeenAt: first.firstSeenAt - 7 * DAY },
      { ...second, id: "e".repeat(32), evidenceKey: "skip-same-moment" },
    );
    const after = portfolioSchema.parse(portfolioView([dataset], undefined, NOW)).attention;
    expect(after.map(attentionKey)).toEqual(before.map(attentionKey)); // none twice, none pushed out
    expect(new Set(after.map(attentionKey)).size).toBe(10);
    expect([after[0].findings, after[0].opened_at, after[0].age_days]).toEqual([
      before[0].findings + 1,
      iso(first.firstSeenAt - 7 * DAY),
      before[0].age_days + 7,
    ]);
    expect([after[1].findings, after[1].opened_at]).toEqual([before[1].findings + 1, before[1].opened_at]);
    expect(after.slice(2)).toEqual(before.slice(2));
  });
});

describe("the sample Portfolio across its boards (JO-17)", () => {
  const demo = buildDataset(NOW);
  const mob = buildDataset(NOW, CATALOGUE_SETTINGS, sampleBoard("MOB")!);
  const both = () => portfolioSchema.parse(portfolioView([demo, mob], undefined, NOW, ["HELP"]));

  it("lists every synced board in the service's order, each from its own Overview, and counts those not synced yet", () => {
    const portfolio = both();
    expect(portfolio.boards.map((board) => board.project)).toEqual([
      { key: "DEMO", name: "Demo project" },
      { key: "MOB", name: "Mobile app" },
    ]);
    expect(portfolio.meta.projects).toEqual(["DEMO", "MOB"]);
    expect(portfolio.boards_not_synced).toBe(1);
    expect(portfolio.boards[1].open_breaches).toBe(overview(mob).totals.open_breaches.current);
  });

  it("finds the oldest breaches across the boards, ties taking turns by board, each on its own board", () => {
    const { attention } = both();
    expect(attention).toHaveLength(10);
    for (const item of attention) expect(item.issue_key.startsWith(`${item.project}-`)).toBe(true);
    for (const [index, item] of attention.entries()) {
      const before = attention[index - 1];
      if (before) expect(Date.parse(item.opened_at)).toBeGreaterThanOrEqual(Date.parse(before.opened_at));
    }
    // One rules run stamps every board alike: on a tie the boards take turns, so neither fills the list on its own.
    const firstMoment = attention.filter((item) => item.opened_at === attention[0].opened_at);
    if (firstMoment.length > 1) expect(new Set(firstMoment.slice(0, 2).map((item) => item.project)).size).toBe(2);
  });

  it("holds the boards, and the count of boards not synced yet, to a reader's own", () => {
    const mine = portfolioSchema.parse(portfolioView([demo, mob], ["MOB"], NOW, ["HELP"]));
    expect(mine.boards.map((board) => board.project.key)).toEqual(["MOB"]);
    expect(mine.attention.every((item) => item.project === "MOB")).toBe(true);
    expect(mine.boards_not_synced).toBe(0);
    expect(portfolioView([demo, mob], ["MOB", "HELP"], NOW, ["HELP"]).boards_not_synced).toBe(1);
  });
});
