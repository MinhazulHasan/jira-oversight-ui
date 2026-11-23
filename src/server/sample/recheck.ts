import type { BoardRule } from "./board-rules";
import { assembleEngine, linkWarnings, type Engine, type FindingRecord, type ResolvedWhy } from "./engine";

/*
 * The re-check after a save (JO-15): the rules run once more over the board's
 * data as of its last sync, under its new settings, as the service runs
 * `rules --project KEY` straight after a save. What that does to the findings
 * is the service's lifecycle (the spec, section 2):
 *
 * - an open finding the new settings still raise stays the same finding (its
 *   id is the condition on the ticket, never the threshold): first seen when
 *   it was, with what the rule saw now;
 * - an open finding they no longer raise closes, as settings_changed, or as
 *   superseded when the rule's version moved (a severity change), never as
 *   cleared, which would read as a fix;
 * - a closed finding they raise again reopens with its id and first sighting;
 * - anything else they raise is new, first seen at the re-check.
 *
 * The past is never rewritten: findings resolved before are kept as they were,
 * and what the new settings would have raised in the past but never did is
 * not invented.
 */

export interface RecheckOutcome {
  engine: Engine;
  /** What it opened: new findings, and closed ones that reopened. */
  opened: FindingRecord[];
  /** The open findings it closed. */
  closed: FindingRecord[];
}

/**
 * The board's findings after a re-check at `at`: `previous` as they stood,
 * `proposed` the engine's run under the new settings (`rules`).
 */
export function recheck(previous: Engine, proposed: Engine, rules: readonly BoardRule[], at: number): RecheckOutcome {
  const versions = new Map(rules.map((rule) => [rule.def.id, rule.version]));
  const findings: FindingRecord[] = [];
  const opened: FindingRecord[] = [];
  const closed: FindingRecord[] = [];
  const linkAnew = new Set<string>();

  for (const old of previous.findings) {
    const next = proposed.byId.get(old.id);
    const holds = next !== undefined && next.resolvedAt === null;
    if (old.resolvedAt === null && holds) {
      findings.push({ ...next, firstSeenAt: old.firstSeenAt, lastSeenAt: Math.max(next.lastSeenAt, at), warnedBefore: old.warnedBefore });
    } else if (old.resolvedAt === null) {
      // Different settings no longer raise it: never "cleared", which the digest would count as a fix. A custom rule
      // deleted (JO-20) is a rule the board stopped running, as one turned off is: its settings changed.
      const version = versions.get(old.rule.id);
      const why: ResolvedWhy = version === undefined || old.ruleVersion === version ? "settings_changed" : "superseded";
      const record = { ...old, resolvedAt: Math.max(at, old.lastSeenAt), resolvedWhy: why };
      findings.push(record);
      closed.push(record);
    } else if (holds) {
      const record = { ...next, firstSeenAt: old.firstSeenAt, lastSeenAt: Math.max(next.lastSeenAt, at), warnedBefore: null };
      findings.push(record);
      opened.push(record);
      linkAnew.add(record.id);
    } else {
      findings.push(old);
    }
  }
  for (const next of proposed.findings) {
    if (next.resolvedAt !== null || previous.byId.has(next.id)) continue;
    const firstSeenAt = Math.max(at, next.firstSeenAt);
    const record = { ...next, firstSeenAt, lastSeenAt: Math.max(firstSeenAt, next.lastSeenAt), warnedBefore: null };
    findings.push(record);
    opened.push(record);
    linkAnew.add(record.id);
  }
  linkWarnings(findings, rules, (finding) => linkAnew.has(finding.id));
  return { engine: assembleEngine(findings, proposed.thresholds), opened, closed };
}
