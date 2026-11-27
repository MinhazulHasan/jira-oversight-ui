import type { ApiErrorCode, CreditField, PeopleCredit, PeopleCreditSaveRequest, ScorecardDays } from "@/lib/api/schemas";

import { isWork } from "./catalogue";
import { countsFor, creditTicket, eligibleFields, peopleFields, SITE_PEOPLE_FIELDS, stepOneField } from "./credit";
import { creditChoiceOf, creditRevisionOf, recordCreditChange, sameChoice, savedCreditOf, type CreditChoice } from "./credit-store";
import { meta, type Dataset } from "./dataset";
import { DAY, iso } from "./time";

/** What a refused change of the credit setting is told, in the page's words. */
export const CREDIT_WORDS = {
  stale: "Someone changed how finished work is counted on this board since you opened it. Look again, then choose.",
  notEligible: "That field isn't filled on any of this board's tickets, so it can't count finished work.",
  unknownField: "The site has no people field by that name.",
} as const;

export type CreditAnswer =
  | { ok: true; body: PeopleCredit }
  | { ok: false; status: 409 | 422; error: ApiErrorCode; message: string; issues?: { path: string; message: string }[] };

const fieldOf = (key: string | null): CreditField | null => (key === null ? null : (SITE_PEOPLE_FIELDS.find((field) => field.key === key) ?? null));

/** How each choice the board offers would credit its work finished in the period. */
function options(dataset: Dataset, finished: readonly string[]): PeopleCredit["options"] {
  const fields = peopleFields(dataset.world);
  const tickets = finished.map((key) => creditTicket(dataset.world.byKey.get(key)!, fields.get(key)));
  const filled = (field: CreditField | null) => (field === null ? 0 : tickets.filter((ticket) => (ticket.fields[field.key] ?? []).length > 0).length);
  const credited = (choice: CreditChoice) => tickets.filter((ticket) => countsFor(ticket, choice).length > 0).length;
  const automatic: CreditChoice = { source: "auto", field: null };
  return [
    { source: "auto", field: null, source_filled: filled(stepOneField(automatic)), credited: credited(automatic) },
    {
      source: "assignee",
      field: null,
      source_filled: tickets.filter((ticket) => ticket.assignee !== null).length,
      credited: credited({ source: "assignee", field: null }),
    },
    ...eligibleFields(dataset).map((field) => ({
      source: "field" as const,
      field: { ...field },
      source_filled: filled(field),
      credited: credited({ source: "field", field: field.key }),
    })),
  ];
}

/** GET /people/credit: the board's setting, the field it reads, and each choice's coverage over the period. */
export function creditView(dataset: Dataset, days: ScorecardDays): PeopleCredit {
  const board = dataset.board.key;
  const to = dataset.world.syncAt;
  const from = to - days * DAY;
  const finished = dataset.world.issues.filter((issue) => isWork(issue) && issue.doneAt !== null && issue.doneAt >= from && issue.doneAt <= to).map((issue) => issue.key);
  const choice = creditChoiceOf(board);
  const saved = savedCreditOf(board);
  return {
    meta: meta(dataset),
    period: { days, from: iso(from), to: iso(to) },
    setting: {
      source: choice.source,
      field: choice.source === "field" ? fieldOf(choice.field) : null,
      revision: creditRevisionOf(board),
      changed_by: saved?.by ?? null,
      changed_at: saved ? iso(saved.at) : null,
    },
    effective_field: stepOneField(choice),
    finished: finished.length,
    options: options(dataset, finished),
  };
}

/** PUT /people/credit: the change saved as the board's next revision, at once; the same body as GET (over 90 days, as the service's). */
export function saveCreditView(dataset: Dataset, body: PeopleCreditSaveRequest, by: string, at: number, days: ScorecardDays = 90): CreditAnswer {
  const board = dataset.board.key;
  if (body.revision !== creditRevisionOf(board)) return { ok: false, status: 409, error: "stale_revision", message: CREDIT_WORDS.stale };
  const choice: CreditChoice = { source: body.source, field: body.source === "field" ? body.field : null };
  if (choice.source === "field") {
    const known = fieldOf(choice.field);
    const eligible = known !== null && eligibleFields(dataset).some((field) => field.key === known.key);
    if (!eligible) {
      const message = known === null ? CREDIT_WORDS.unknownField : CREDIT_WORDS.notEligible;
      return { ok: false, status: 422, error: "credit_invalid", message, issues: [{ path: "field", message }] };
    }
  }
  // Choosing what already stands changes nothing: no new revision, as the service answers it.
  if (!sameChoice(choice, creditChoiceOf(board))) recordCreditChange(board, choice, by, at);
  return { ok: true, body: creditView(dataset, days) };
}
