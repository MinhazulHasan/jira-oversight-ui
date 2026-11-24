import type { BoardRule } from "./board-rules";
import { assembleEngine, linkWarnings, type Engine, type FindingRecord, type ResolvedWhy } from "./engine";

export interface RecheckOutcome {
  engine: Engine;
  /** What it opened: new findings, and closed ones that reopened. */
  opened: FindingRecord[];
  /** The open findings it closed. */
  closed: FindingRecord[];
}

/** The board's findings after a re-check at `at`: `previous` as they stood, */
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
