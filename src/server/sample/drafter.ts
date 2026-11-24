import { limitWords, listWords, unitWords, type CustomRuleInput } from "@/lib/api/custom-rules";
import {
  CHECK_REGISTRY,
  CHECKS_BY_NAME,
  CUSTOM_TITLE_MAX,
  MISSING_FIELD_LABELS,
  type DraftOutcome,
  type MissingField,
  type ParamValue,
  type StatusCategory,
} from "@/lib/api/schemas";

import type { BoardOptions } from "./custom-rules";

/** What the script made of the words: a rule to check, or why not. */
export interface ScriptedDraft {
  outcome: DraftOutcome;
  draft: CustomRuleInput | null;
  explanation: string | null;
  note: string | null;
}

/** The numbers people write in words before a length of time: "two weeks", "a day", "a couple of days". */
const NUMBER_WORDS: Readonly<Record<string, number>> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  couple: 2,
};
const NUMBER_WORD = String.raw`(?:a\s+)?couple(?:\s+of)?|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve`;
const UNIT = String.raw`hours?|hrs?|h|days?|d|weeks?|wks?|w`;
/** A number in figures ("36h", "3 days") or in words ("two weeks", "a day"), then its unit. */
const DURATION = new RegExp(String.raw`(?:(\d+(?:\.\d+)?)\s*|\b(${NUMBER_WORD})\s+)(${UNIT})\b`, "i");
const TIMES = /(\d+(?:\.\d+)?)\s*(?:×|x\b|times\b)/i;
const NO = String.raw`(?:no|without(?:\s+an?)?|missing(?:\s+an?)?)`;
/** Each field missing_field looks for, as the words say it is missing, in the order the script tries them. */
const MISSING_FIELDS: readonly (readonly [MissingField, RegExp])[] = [
  ["assignee", new RegExp(String.raw`\b${NO}\s+assignees?\b|\bunassigned\b`, "i")],
  ["epic", new RegExp(String.raw`\b${NO}\s+epics?\b`, "i")],
  ["estimate", new RegExp(String.raw`\b${NO}\s+estimates?\b|\bunestimated\b`, "i")],
  ["sprint", new RegExp(String.raw`\bnot\s+in\s+(?:a|any)\s+sprint\b|\b${NO}\s+sprints?\b`, "i")],
];
const NO_UPDATE = /\bno\s+updates?\b|\bnot\s+(?:been\s+)?updated\b|\buntouched\b|\bno\s+changes?\b|\b(?:nobody|no\s+one|not)\s+(?:(?:has|have|been)\s+)*touched\b/i;
const OPEN_FOR = new RegExp(String.raw`\bopen\s+(?:for\s+)?(?:more\s+than\s+|longer\s+than\s+|over\s+)?(?:\d|(?:${NUMBER_WORD})\s+(?:${UNIT})\b)|\bolder\s+than\b`, "i");
const EFFORT = /\beffort\b|\bover\s+(?:the\s+|its\s+)?estimates?\b/i;
const REOPEN = /\breopen/i;
const SKIP = /\bskip/i;
const WARNING = /\bwarn(?:ing)?s?\b|\bearly\b/i;
const LONG_WORD = /[A-Za-z]{3,}/;
/** "in" before a word: with a length of time, the words name a status, whether the board has it or not. */
const IN_SOMEWHERE = /\bin\s+[A-Za-z]/i;

/** A length of time in the words, in hours: "3 days" is 72, "two weeks" 336, "36 hours" 36; null when they give none. */
function durationHours(text: string): number | null {
  const match = DURATION.exec(text);
  if (!match) return null;
  const words = (match[2] ?? "").toLowerCase().split(/\s+/);
  const value = match[1] !== undefined ? Number(match[1]) : NUMBER_WORDS[words.includes("couple") ? "couple" : words[0]];
  const unit = match[3].toLowerCase();
  return value * (unit.startsWith("w") ? 168 : unit.startsWith("d") ? 24 : 1);
}

/** A number of days from a length of time in hours, as the service rounds it (four places); `fallback` with none. */
const daysOf = (hours: number | null, fallback: number) => (hours === null ? fallback : Math.round((hours / 24) * 10_000) / 10_000);

/** A name's plural as the service writes it: "Bugs", "Stories", "Tasks"; a name ending in s as it is. */
function plural(name: string): string {
  if (/s$/i.test(name)) return name;
  if (/[^aeiou]y$/i.test(name)) return `${name.slice(0, -1)}ies`;
  return `${name}s`;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A phrase as whole words, in any case: "QA" in "sitting in QA", never in "aqua". */
const whole = (phrase: string) => new RegExp(String.raw`(?<![\p{L}\p{N}_])${escape(phrase)}(?![\p{L}\p{N}_])`, "iu");

/** The board's issue types the words name, singular or plural, in the board's order; "epic" in "no epic" is the field. */
function typesNamed(text: string, options: BoardOptions): string[] | null {
  const words = MISSING_FIELDS.reduce((rest, [, pattern]) => rest.replace(new RegExp(pattern.source, "gi"), " "), text);
  const named = options.issueTypes.filter((type) => whole(type).test(words) || whole(plural(type)).test(words));
  return named.length > 0 ? named : null;
}

function statusesNamed(text: string, options: BoardOptions): string[] {
  let rest = text;
  const found = new Set<string>();
  for (const { name } of [...options.statuses].sort((a, b) => b.name.length - a.name.length)) {
    const match = whole(name).exec(rest);
    if (!match) continue;
    found.add(name);
    rest = `${rest.slice(0, match.index)}${" ".repeat(match[0].length)}${rest.slice(match.index + match[0].length)}`;
  }
  if (found.size === 0 && /\breview/i.test(text)) {
    const reviewing = options.statuses.find((status) => /review/i.test(status.name));
    if (reviewing) found.add(reviewing.name);
  }
  return options.statuses.filter((status) => found.has(status.name)).map((status) => status.name);
}

/** The categories the named statuses are in, where time in a status may look at them; null for the check's defaults. */
function statusCategories(statuses: readonly string[], options: BoardOptions): StatusCategory[] | null {
  const allowed = CHECKS_BY_NAME.get("time_in_status_over")?.categories ?? [];
  const named = new Set(options.statuses.filter((status) => statuses.includes(status.name)).map((status) => status.category));
  const categories = allowed.filter((category) => named.has(category));
  return categories.length > 0 ? categories : null;
}

const CATEGORY_WORDS: Readonly<Record<StatusCategory, string>> = { new: "not started", indeterminate: "in progress", done: "already done" };

function categoryWords(check: string, categories: readonly StatusCategory[]): string {
  const allowed = CHECKS_BY_NAME.get(check)?.categories ?? [];
  if (allowed.every((category) => categories.includes(category))) return "";
  const named = (["new", "indeterminate", "done"] as const).filter((category) => categories.includes(category));
  if (named.join() === "new,indeterminate") return " not done";
  return ` ${listWords(named.map((category) => CATEGORY_WORDS[category]), "or")}`;
}

/** "Bugs", "Bugs and tasks", "Tickets": what the rule looks at, for its name and explanation. */
function typesWords(types: readonly string[] | null): string {
  if (types === null) return "Tickets";
  return listWords(types.map((type, index) => (index === 0 ? plural(type) : plural(type).toLowerCase())));
}

/** "in progress" for In Progress, "in Code Review" for any other status: as a reader says where a ticket is. */
function inStatusWords(statuses: readonly string[]): string {
  return listWords(
    statuses.map((status) => (/^in\s/i.test(status) ? status.toLowerCase() : `in ${status}`)),
    "or",
  );
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** A name cut to the form's length at a word, as the service cuts the model's (rule_draft.py `_words`): no ellipsis. */
function fit(title: string): string {
  if (title.length <= CUSTOM_TITLE_MAX) return title;
  const head = title.slice(0, CUSTOM_TITLE_MAX + 1);
  const cut = head.includes(" ") ? head.slice(0, head.lastIndexOf(" ")) : head;
  return cut.slice(0, CUSTOM_TITLE_MAX).replace(/[ ,;:]+$/, "");
}
/** The words of four letters or more in a text, in one case: what a request and a check are matched on. */
const longWords = (text: string) => new Set((text.match(/[A-Za-z]{4,}/g) ?? []).map((word) => word.toLowerCase()));

function closest(text: string): string {
  if (DURATION.test(text) && IN_SOMEWHERE.test(text)) return CHECKS_BY_NAME.get("time_in_status_over")?.label ?? "time_in_status_over";
  const words = longWords(text);
  let best = CHECK_REGISTRY[0].label;
  let score = -1;
  for (const check of CHECK_REGISTRY) {
    const own = longWords(`${check.label} ${check.summary}`);
    const shared = [...words].filter((word) => own.has(word)).length;
    if (shared > score) [best, score] = [check.label, shared];
  }
  return best;
}

export function scriptedDraft(text: string, options: BoardOptions): ScriptedDraft {
  const types = typesNamed(text, options);
  const who = typesWords(types);
  const tickets = lowerFirst(who);
  const severity = WARNING.test(text) ? "warning" : "breach";
  const hours = durationHours(text);
  // Said beside a limit the words did not give, so the admin sets their own.
  const usual = hours === null ? " (the default limit)" : "";
  const draft = (
    check: string,
    params: Record<string, ParamValue>,
    title: string,
    explain: (where: string) => string,
    categories: StatusCategory[] | null = null,
  ): ScriptedDraft => {
    const spec = CHECKS_BY_NAME.get(check);
    const looksAt = spec?.scope === "sprint" ? [] : (categories ?? [...(spec?.defaultCategories ?? [])]);
    return {
      outcome: "drafted",
      draft: { title: fit(title), description: null, check, params, applies_to: { status_category: looksAt, issue_type: types }, severity },
      explanation: explain(categoryWords(check, looksAt)),
      note: null,
    };
  };

  if (REOPEN.test(text)) return draft("reopened", {}, `${who} reopened after Done`, (where) => `Flags ${tickets}${where} that left Done for another status.`);
  if (SKIP.test(text)) {
    return draft("skipped_stage", {}, `${who} that skipped a stage`, (where) => `Flags ${tickets}${where} whose status jumped over a stage of the process.`);
  }
  const times = TIMES.exec(text);
  if (EFFORT.test(text) && times) {
    const threshold = Number(times[1]);
    return draft(
      "effort_ratio_at_least",
      { threshold },
      `${who} over the estimate`,
      (where) => `Flags ${tickets}${where} whose logged time is at least ${threshold} times the estimate.`,
    );
  }
  const missing = MISSING_FIELDS.find(([, pattern]) => pattern.test(text));
  if (missing) {
    const field = missing[0];
    const label = MISSING_FIELD_LABELS[field].toLowerCase();
    return draft("missing_field", { field }, field === "sprint" ? `${who} in no sprint` : `${who} with no ${label}`, (where) => `Flags ${tickets}${where} with no ${label}.`);
  }
  if (NO_UPDATE.test(text)) {
    const days = daysOf(hours, 7);
    return draft(
      "no_update_for",
      { days },
      `${who} with no recent update`,
      (where) => `Flags ${where ? `${tickets}${where}` : `open ${tickets}`} with no change in Jira for more than ${unitWords("days", days)}${usual}.`,
    );
  }
  if (OPEN_FOR.test(text)) {
    const days = daysOf(hours, 30);
    return draft(
      "open_longer_than",
      { days },
      `${who} open too long`,
      (where) => `Flags ${tickets}${where || " still open"} more than ${unitWords("days", days)}${usual} after they were created.`,
    );
  }
  const statuses = statusesNamed(text, options);
  if (statuses.length > 0) {
    const limit = hours ?? 72;
    const where = inStatusWords(statuses);
    return draft(
      "time_in_status_over",
      { statuses, hours: limit },
      `${who} ${where} too long`,
      () => `Flags ${tickets} that stay ${where} for more than ${limitWords(limit)}${usual}.`,
      statusCategories(statuses, options),
    );
  }
  // The service's own words for what it cannot draft (oversight/api/rule_draft.py, oversight/llm/scripted.py).
  if (!LONG_WORD.test(text)) return { outcome: "not_understood", draft: null, explanation: null, note: NOT_UNDERSTOOD_NOTE };
  return {
    outcome: "not_supported",
    draft: null,
    explanation: null,
    note: `None of the checks can do that. The closest is '${closest(text)}'.`,
  };
}

/** What the service says to words with nothing to draft from, word for word. */
export const NOT_UNDERSTOOD_NOTE = 'Describe the rule in a few words, such as "Bugs in Code Review for more than 3 days".';
