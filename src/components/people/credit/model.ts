import { creditWords, type CreditField, type CreditOption, type CreditReading, type CreditSource, type PeopleCredit } from "@/lib/api/schemas";
import { formatCount, formatShare } from "@/lib/format";

/** A choice of whom tickets count for: a source, and its field where the source is one. */
export interface Choice {
  source: CreditSource;
  field: CreditField | null;
}

/** Automatic reads its field from the board, so the field says nothing of which of two Automatic choices it is. */
export const sameChoice = (a: Choice, b: Choice) =>
  a.source === b.source && (a.source === "auto" || (a.field?.key ?? null) === (b.field?.key ?? null));

/** The choice's name: "Automatic", "Assignee", or the field's name in Jira ("Programmer"). */
export function choiceName(choice: Choice): string {
  if (choice.source === "auto") return "Automatic";
  if (choice.source === "assignee") return "Assignee";
  return choice.field?.name ?? "A Jira field";
}

/** The board's setting as the People page reads it: the choice in force, and the field it reads. */
export type CreditInForce = Pick<PeopleCredit, "setting" | "effective_field">;

export const creditReading = (credit: CreditInForce): CreditReading => ({ source: credit.setting.source, field: credit.effective_field?.name ?? null });

/** Whom every ticket counts for, following the board's setting (null while it loads, or if it cannot be read): the note and each column's words. */
export function creditNote(credit: CreditInForce | null): string {
  return creditWords(credit && creditReading(credit));
}

/** What a choice does, in one plain line. `reads` is the field Automatic reads first (none where the site has no Programmer). */
export function choiceLine(option: Choice, reads: CreditField | null, unfilled = false): string {
  if (option.source === "auto") {
    if (reads && unfilled) return `The assignee: no finished ticket here has a ${reads.name}.`;
    return reads ? `${reads.name} in Jira where it is filled, otherwise the assignee.` : "The assignee: the site has no Programmer field.";
  }
  if (option.source === "assignee") return "The assignee in Jira now. Tickets without one count for no one.";
  return `${option.field?.name ?? "The field"} in Jira. Tickets without it count for no one.`;
}

/** A choice's coverage of the finished work: the share that counts for at least one person under it. */
export interface Coverage {
  /** 0 to 1; null with no finished work. */
  credited: number | null;
  /** "99%". */
  share: string | null;
  /** The figures, each set in Plex Mono: "471", "475". */
  creditedCount: string | null;
  finishedCount: string | null;
  /** After the figures: "finished tickets count for someone"; with no finished work, the whole line that says so. */
  words: string;
  /** The whole coverage in one sentence, for a screen reader and a test. */
  spoken: string;
}

export function coverageOf(option: CreditOption, finished: number, days: number, locale?: string): Coverage {
  if (finished === 0) {
    const none = `No work finished in the last ${days} days.`;
    return { credited: null, share: null, creditedCount: null, finishedCount: null, words: none, spoken: none };
  }
  const [creditedCount, finishedCount] = [option.credited, finished].map((value) => formatCount(value, { locale }));
  const words = `${finished === 1 ? "finished ticket" : "finished tickets"} ${option.credited === 1 ? "counts" : "count"} for someone`;
  return {
    credited: option.credited / finished,
    share: formatShare(option.credited / finished, { locale }),
    creditedCount,
    finishedCount,
    words,
    spoken: `${creditedCount} of ${finishedCount} ${words}.`,
  };
}

/** Automatic is recommended where the board fills the field it reads first. */
export function recommended(option: CreditOption): boolean {
  return option.source === "auto" && option.source_filled > 0;
}

const PROGRAMMER: CreditField = { key: "programmer", name: "Programmer" };

/** The field Automatic reads first: the setting's own while it is Automatic (none where the site has no Programmer), else Programmer. */
export function autoField(credit: PeopleCredit): CreditField | null {
  if (credit.setting.source === "auto") return credit.effective_field;
  return credit.options.find((option) => option.source === "field" && option.field?.key === PROGRAMMER.key)?.field ?? PROGRAMMER;
}

/** The toast after a change: "Tickets now count for the assignee". */
export function savedTitle(choice: Choice): string {
  if (choice.source === "assignee") return "Tickets now count for the assignee";
  if (choice.source === "field") return `Tickets now count for ${choice.field?.name ?? "the field"} in Jira`;
  return "Tickets now count automatically";
}
