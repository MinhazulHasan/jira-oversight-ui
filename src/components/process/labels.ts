import { isStage, STAGE_LABELS } from "@/components/charts/palette";
import { SEVERITY_LABEL } from "@/components/ui/badge";
import type { CsvColumn } from "@/components/ui/csv";
import type { ProcessStage, Rule, RuleKind } from "@/lib/api/schemas";

/** The rules that decide, and the early warnings that foreshadow a breach. */
export const KIND_LABEL: Record<RuleKind, string> = { rule: "Rule", warning: "Early warning" };

/** Where Jira records that a stage happened, in full, for assistive technology and exports. */
export const EVIDENCE_LABEL: Record<ProcessStage["evidence"], string> = {
  status: "Tracked by status",
  field: "Tracked by a field",
  none: "Not measurable",
};

/** Jira field ids that read badly as words. */
const FIELD_NAMES: Record<string, string> = {
  story_points: "Story points",
  storypoints: "Story points",
  timeoriginalestimate: "Original estimate",
  original_estimate: "Original estimate",
};

/** A key in words: "story_points" -> "Story points". */
export function humanize(key: string): string {
  const words = key.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

export function fieldName(field: string): string {
  return FIELD_NAMES[field.toLowerCase()] ?? humanize(field);
}

/** A stage as the process names it ("code_review" -> "Code review"), or the key in words. */
export function stageLabel(key: string, stages: readonly ProcessStage[] = []): string {
  const stage = stages.find((candidate) => candidate.stage === key);
  if (stage) return stage.label;
  return isStage(key) ? STAGE_LABELS[key] : humanize(key);
}

/** A label inside a sentence: "Code review" -> "code review", but "PR links" stays as it is. */
export function inSentence(label: string): string {
  return /^[A-Z][a-z]/.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label;
}

/** "a", "a and b", "a, b and c". */
export function joinWords(items: readonly string[], conjunction = "and"): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} ${conjunction} ${items.at(-1)}`;
}

/** What a rule cannot see, in words: "code review and testing". */
export function missingEvidenceText(rule: Rule, stages: readonly ProcessStage[] = []): string {
  return joinWords(rule.missing_evidence.map((key) => inSentence(stageLabel(key, stages))));
}

/**
 * Open findings only mean something for a rule that runs: a rule Jira cannot
 * feed, or one turned off on the board (JO-15), has none open because it never
 * looked, not because all is well.
 */
export function openFindings(rule: Rule): number | undefined {
  return rule.measurable && rule.enabled ? rule.open : undefined;
}

/** The words for a rule an admin turned off on this board (JO-15). */
export const OFF_ON_BOARD = "Off on this board";

/** Where an admin changes the board's rule settings (JO-15). */
export const RULE_SETTINGS_HREF = "/governance/rules";

export function findingsHref(ruleId: string): string {
  return `/findings?rule=${encodeURIComponent(ruleId)}`;
}

/** The catalogue as a spreadsheet, in the order the rows are shown. */
export const RULE_CSV_COLUMNS: CsvColumn<Rule>[] = [
  { header: "Rule", value: (rule) => rule.rule_id },
  { header: "Title", value: (rule) => rule.title },
  { header: "Kind", value: (rule) => KIND_LABEL[rule.kind] },
  { header: "Severity", value: (rule) => SEVERITY_LABEL[rule.severity] },
  { header: "Threshold", value: (rule) => rule.threshold },
  { header: "Measurable", value: (rule) => rule.measurable },
  { header: "Missing evidence", value: (rule) => rule.missing_evidence.map((key) => stageLabel(key)).join("; ") },
  { header: "Open findings", value: (rule) => openFindings(rule) },
  { header: "On this board", value: (rule) => rule.enabled },
  { header: "Customised", value: (rule) => rule.customised },
  { header: "Custom", value: (rule) => rule.custom },
  { header: "Check", value: (rule) => rule.check_label },
  { header: "Version", value: (rule) => rule.version },
  { header: "Escalates to", value: (rule) => rule.escalates_to },
  { header: "Reads from Jira", value: (rule) => rule.needs.join("; ") },
  { header: "Description", value: (rule) => rule.description },
];
