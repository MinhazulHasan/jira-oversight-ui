import type {
  IgnorePreview,
  IgnorePreviewRequest,
  IgnoreRecord,
  IgnoreRequest,
  IgnoreResult,
  IgnoreTarget,
  IgnoredPage,
  RestoreRequest,
  RestoreResult,
} from "@/lib/api/ignores";
import { normalizeFindingsQuery, type IgnoredQuery } from "@/lib/api/params";
import type { IgnoreScope } from "@/lib/api/schemas";

import { STATUS } from "./catalogue";
import { meta, type Dataset } from "./dataset";
import type { FindingRecord } from "./engine";
import { matchingRecords, searchMatcher } from "./findings";
import { recordIgnores, restoreIgnores, storedIgnores, type IgnoreActor, type IgnorePair, type StoredIgnore } from "./ignores";
import { iso } from "./time";

/** What a target comes to now: the open findings it would resolve, the pairs it records, the ones ignored already. */
interface Resolution {
  findings: FindingRecord[];
  pairs: IgnorePair[];
  alreadyIgnored: number;
}

const isOpen = (finding: FindingRecord) => finding.resolvedAt === null;

/** The findings a target names, on tickets only: a sprint's finding is on no ticket, so nothing can ignore it. */
function named(dataset: Dataset, target: IgnoreTarget): FindingRecord[] {
  const { byId, byIssue } = dataset.engine;
  const found =
    "finding_ids" in target
      ? target.finding_ids.flatMap((id) => byId.get(id) ?? [])
      : "issue_keys" in target
        ? target.issue_keys.flatMap((key) => byIssue.get(key) ?? [])
        : matchingRecords(dataset, normalizeFindingsQuery({ ...target.query, state: "all" }));
  return found.filter((finding) => finding.issue !== null);
}

function resolve(dataset: Dataset, target: IgnoreTarget, scope: IgnoreScope): Resolution {
  const all = named(dataset, target);
  const open = all.filter(isOpen);
  const alreadyIgnored = all.filter((finding) => finding.resolvedWhy === "ignored").length;
  if (scope === "ticket") {
    const keys = [...new Set(open.map((finding) => finding.issue!.key))];
    // Every rule on the ticket: its open findings the filters did not name go too.
    const findings = keys.flatMap((key) => (dataset.engine.byIssue.get(key) ?? []).filter(isOpen));
    return { findings, pairs: keys.map((issueKey) => ({ issueKey, ruleId: null })), alreadyIgnored };
  }
  const pairs = new Map<string, IgnorePair>();
  for (const finding of open) pairs.set(`${finding.issue!.key}\u001f${finding.rule.id}`, { issueKey: finding.issue!.key, ruleId: finding.rule.id });
  return { findings: open, pairs: [...pairs.values()], alreadyIgnored };
}

const ticketsOf = (findings: readonly FindingRecord[]) => new Set(findings.map((finding) => finding.issue!.key)).size;

/** The findings by rule, in the board's order of its rules, then any it no longer runs by id. */
function byRule(dataset: Dataset, findings: readonly FindingRecord[]): IgnorePreview["by_rule"] {
  const order = new Map(dataset.rules.map((rule, index) => [rule.def.id, index]));
  const counts = new Map<string, { title: string; findings: number }>();
  for (const finding of findings) {
    const entry = counts.get(finding.rule.id) ?? { title: finding.rule.title, findings: 0 };
    entry.findings += 1;
    counts.set(finding.rule.id, entry);
  }
  return [...counts]
    .sort(([a], [b]) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER) || (a < b ? -1 : 1))
    .map(([ruleId, entry]) => ({ rule_id: ruleId, rule_title: entry.title, findings: entry.findings }));
}

export function ignorePreviewView(dataset: Dataset, request: IgnorePreviewRequest): IgnorePreview {
  const { findings, alreadyIgnored } = resolve(dataset, request.target, request.scope);
  return { meta: meta(dataset), findings: findings.length, tickets: ticketsOf(findings), by_rule: byRule(dataset, findings), already_ignored: alreadyIgnored };
}

/** Records the ignore as the preview said it: the same findings, at once (the next read is worked out with it). */
export function ignoreView(dataset: Dataset, request: IgnoreRequest, by: IgnoreActor, at: number): IgnoreResult {
  const { findings, pairs } = resolve(dataset, request.target, request.scope);
  const ids = pairs.length > 0 ? recordIgnores(dataset.board.key, pairs, request.reason, by, at) : [];
  return { meta: meta(dataset), ignored: { findings: findings.length, tickets: ticketsOf(findings) }, ignore_ids: ids };
}

/** Removes the ignores: the board's next read is its findings as the rules leave them, so those they still hold reopen. */
export function restoreView(dataset: Dataset, request: RestoreRequest, by: IgnoreActor, at: number): RestoreResult {
  const restored = restoreIgnores(dataset.board.key, request.ignore_ids, by, at);
  return {
    meta: meta(dataset),
    restored: restored.length,
    // The sample re-checks the board at once, as the service's re-check would leave it.
    recheck: { state: "succeeded", started_at: iso(at), finished_at: iso(at), message: null },
  };
}

function ignoreRecord(dataset: Dataset, stored: StoredIgnore, held: ReadonlyMap<string, number>): IgnoreRecord {
  const issue = dataset.world.byKey.get(stored.issueKey) ?? null;
  const rule = stored.ruleId === null ? null : (dataset.rules.find((candidate) => candidate.def.id === stored.ruleId)?.def ?? null);
  return {
    ignore_id: stored.id,
    scope: stored.ruleId === null ? "ticket" : "finding",
    issue_key: stored.issueKey,
    issue_summary: issue?.summary ?? null,
    issue_type: issue?.type ?? null,
    status: issue?.status ?? null,
    status_category: issue ? STATUS[issue.status].category : null,
    rule_id: stored.ruleId,
    rule_title: stored.ruleId === null ? null : (rule?.title ?? stored.ruleId),
    findings: held.get(stored.id) ?? 0,
    reason: stored.reason,
    by: stored.by.name,
    at: iso(stored.at),
  };
}

const keyNumber = (key: string) => Number(key.slice(key.lastIndexOf("-") + 1));

/** The board's standing ignores, filtered, sorted and a page at a time; each with the findings it holds now. */
export function ignoredView(dataset: Dataset, query: IgnoredQuery): IgnoredPage {
  const held = new Map<string, number>();
  for (const finding of dataset.engine.findings) {
    if (finding.ignore && finding.resolvedWhy === "ignored") held.set(finding.ignore.id, (held.get(finding.ignore.id) ?? 0) + 1);
  }
  const rules = new Set(query.rule);
  const search = searchMatcher(query.q);
  const direction = query.order === "asc" ? 1 : -1;
  const items = storedIgnores(dataset.board.key)
    .filter((stored) => stored.restored === null && (rules.size === 0 || (stored.ruleId !== null && rules.has(stored.ruleId))))
    .map((stored) => ignoreRecord(dataset, stored, held))
    .filter((item) => search({ issue_key: item.issue_key, issue_summary: item.issue_summary, sprint: null }))
    .sort((a, b) => {
      let order = 0;
      if (query.sort === "issue_key") order = keyNumber(a.issue_key) - keyNumber(b.issue_key) || (a.issue_key < b.issue_key ? -1 : a.issue_key > b.issue_key ? 1 : 0);
      else if (query.sort === "rule_id") {
        // An ignore of every rule has no rule to sort by: it goes last either way.
        if (a.rule_id === null || b.rule_id === null) {
          if (a.rule_id !== b.rule_id) return a.rule_id === null ? 1 : -1;
        } else order = a.rule_id < b.rule_id ? -1 : a.rule_id > b.rule_id ? 1 : 0;
      } else order = Date.parse(a.at) - Date.parse(b.at);
      return order * direction || Date.parse(b.at) - Date.parse(a.at) || (a.ignore_id < b.ignore_id ? -1 : 1);
    });
  const start = (query.page - 1) * query.page_size;
  return { meta: meta(dataset), items: items.slice(start, start + query.page_size), total: items.length, page: query.page, page_size: query.page_size };
}
