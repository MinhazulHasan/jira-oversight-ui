import { createHash } from "node:crypto";

import {
  ASK_DECLINES,
  ASK_MAX_LENGTH,
  noTicketsSentence,
  type AskLevel,
  type AskResponse,
  type FactSet,
  type Person,
  type PlanStep,
  type ScorecardDays,
} from "@/lib/api/schemas";

import type { PeopleComparison } from "../../env";

import { meta, type Dataset } from "../dataset";
import { directoryPeople, workPeople } from "../people";
import { iso } from "../time";
import { verify } from "../verify";
import { compose, type Piece } from "./compose";
import {
  asksAboutOverload,
  asksAboutPeople,
  asksAboutPeopleAtPeopleLevel,
  asksAboutTheFurtherSide,
  asksAboutWorkInProgress,
  asksForACount,
  asksForBacklog,
  asksForFewest,
  asksForFinishedWork,
  asksOfSomeone,
  asksPersonnel,
  asksToEvaluate,
  asksWhatTheyAreDoing,
  asksWhatTheyWorkOn,
  asksWhoHasNoTickets,
  asksWhoIsBusiest,
  asksWhoIsIdle,
  asksWhoIsOnTheBoard,
  bestMatch,
  countStateIn,
  issueKeyIn,
  loadIn,
  N_WORDS,
  namesTheRatio,
  normalise,
  orderIn,
  peopleTopic,
  ranksOnly,
  saysOnlyHowLittle,
  type Load,
} from "./match";
import {
  ambiguousFirstNameMessage,
  ambiguousNameMessage,
  boardPeopleAnswer,
  LAST_RESORT,
  looselyNamed,
  mentionedAnswer,
  namesSomeone,
  noOneCalledMessage,
  personFindingsAnswer,
  rankingAnswer,
  ticketsRankingAnswer,
  typedPeople,
  unknownName,
  verifiedPeople,
  workingOnAnswer,
} from "./people";
import {
  backlogAnswer,
  busiestAnswer,
  comparisonAnswer,
  daysIn,
  doneAnswer,
  measureIn,
  orderFor,
  OVERALL,
  scorecardAnswer,
  ticketAssigneeAnswer,
  type CompareOrder,
  type ComparedKey,
  type RankedCount,
} from "./scorecard";
import { countAnswer, ISSUE_SCRIPT, SCRIPTS, SUGGESTED_QUESTIONS, type ScriptResult } from "./scripts";

/** The most catalogue calls one question makes (the service's router MAX_CALLS). */
const MAX_CALLS = 3;

/**
 * Ask, in sample mode: the backend's pipeline with a script in the model's
 * place. A question is matched to a plan, the plan's catalogue calls run over
 * the sample project, the answer is written from those facts only, and the
 * same validator the service uses decides whether it may be shown.
 *
 * At the level this interface's server decides (team, or people for an admin
 * and with sign-in off), as the service answers: team level names no one and
 * declines any question about a person. People level names people and counts
 * their tickets and findings, by the people the question mentions (picked
 * with @, or typed in full: JO-11), and declines nothing: a question that
 * evaluates someone is answered with their scorecard, several people's side
 * by side, or everyone in order of how closely they follow the process; a
 * personnel question gets the same figures, then "The figures are above; the
 * decision is yours." The answers order and summarise; they never label
 * anyone. A mention of a member of the board who holds none of its tickets is
 * answered in code, as the service answers it: "<Name> has no tickets on this
 * board." (JO-10).
 */

export const NOT_VERIFIED_MESSAGE = "The written answer could not be verified against the facts, so only the facts are shown.";
const NOT_UNDERSTOOD_MESSAGE = "That question can't be answered from the Jira data; try one of the suggestions.";
/** A question about people no figure here answers per person (cycle time by person, say): what is answered, and @. */
export const PEOPLE_HELP_MESSAGE =
  "There is no per-person figure for that here. Ask who follows the process most closely or who has the most open breaches, or type @ to pick someone on the board.";

const FIRST_SUGGESTIONS = SUGGESTED_QUESTIONS.slice(0, 6);
const TEAM_SUGGESTIONS = ["Where do tickets get stuck most?", "Which epics have the most open breaches?", "How is effort against estimate trending?"];
/** The service's people-level suggestions lead with these (oversight/ask/service.py: PEOPLE_SUGGESTED_QUESTIONS). */
export const PEOPLE_SUGGESTIONS = ["Who follows the process most closely?", "Who has the most open breaches?", "Who finished the most work this month?"];
/** What an admin can ask instead where comparing people is turned off: raw counts stay. */
const ONE_AT_A_TIME_SUGGESTIONS = ["Who has the most open breaches?", "Who has the most open warnings?", "Which epics have the most open breaches?"];

export interface AskOptions {
  level: AskLevel;
  /** The people the question mentions, by id: checked by the route, never more than ten. */
  mentions: readonly string[];
  /** Whether people may be compared side by side (SAMPLE_PEOPLE_COMPARISON): on unless turned off. */
  comparison?: PeopleComparison;
}

function planOf(facts: readonly FactSet[]): PlanStep[] {
  return facts.map((fact) => ({ tool: fact.tool, params: fact.params }));
}

/** The same question with other people mentioned is another question; the level is the reader's, the same all session. */
function qaId(dataset: Dataset, question: string, options: AskOptions): string {
  const asked = [dataset.now, normalise(question), ...options.mentions].join("\u001f");
  return createHash("sha256").update(asked).digest("hex").slice(0, 32);
}

const declined = (message: string, suggestions: readonly string[]): ScriptResult => ({ outcome: "not_understood", message, suggestions: [...suggestions] });

/** Everyone the question mentions is on the board and holds none of its tickets: said in code, nothing planned. */
interface NoTickets {
  outcome: "no_tickets";
  people: readonly Person[];
}

/**
 * The people a question names (all on the board): picked with @, then typed in
 * full (JO-11), split into those who hold a ticket on it now and those who
 * hold none; and any typed name more than one person on the board shares.
 */
interface Mentioned {
  all: readonly Person[];
  holding: readonly Person[];
  without: readonly Person[];
  ambiguous: readonly string[];
  ambiguousFirst: { first: string; names: readonly string[] } | null;
}

/** Team level: the work and the process, and never anyone in particular. */
function teamResult(dataset: Dataset, question: string, options: AskOptions): ScriptResult {
  // Principle 8 at team level comes before any matching: a question about a person is declined however it is phrased.
  if (options.mentions.length > 0 || asksAboutPeople(question) || namesSomeone(question, dataset)) {
    return declined(ASK_DECLINES.teamLevel, TEAM_SUGGESTIONS);
  }
  if (issueKeyIn(question)) return ISSUE_SCRIPT.run(dataset, question);
  // How many open tickets, or in progress: the board's work by status category, as everywhere else.
  const counted = countStateIn(question);
  if (counted) return countAnswer(dataset, counted);
  const script = bestMatch(question, SCRIPTS);
  return script ? script.run(dataset, question) : declined(NOT_UNDERSTOOD_MESSAGE, FIRST_SUGGESTIONS);
}

/**
 * How a people-level question evaluates people, as the service reads it
 * (oversight/ask/router.py, judging): "personnel", "scorecard", or null when
 * it evaluates no one, is about no one, or ranks people by one of the people
 * view's counts ("top 5 people by breaches", "compare @A and @B by open
 * breaches"), which stays JO-09's raw-count ranking.
 */
function judging(question: string, aboutPeople: boolean): "personnel" | "scorecard" | null {
  if (!aboutPeople || !(asksToEvaluate(question) || asksPersonnel(question))) return null;
  const measure = measureIn(question);
  // "Top 5 people by breaches" (JO-09's ranking) and "rank people by backlog" (the count): a ranking by a count.
  if (ranksOnly(question) && (peopleTopic(question) !== null || asksForACount(question)) && (measure === null || measure === "open_findings_per_10")) {
    return null;
  }
  return asksPersonnel(question) ? "personnel" : "scorecard";
}

/**
 * A question's "top 5", "bottom 3", "the lowest 3", "which 3 people" or "the 5 developers": at most that many people
 * (up to 50), as the service reads it (_TOP_N); null for everyone. Which end comes first is the question's order
 * (orderIn: top is most first, bottom fewest first, where no other direction word stands).
 */
const TOP_N = new RegExp(
  String.raw`\b(?:top|bottom|highest|lowest)\s+(${N_WORDS})\b|\b(?:which|the|first)\s+(${N_WORDS})\s+(?:people|persons|developers|devs|engineers|programmers|testers|assignees|members|team\s*-?\s*members|teammates|colleagues|performers|users|staff|employees|of\s+(?:them|us|the\s+team))\b`,
);
const NUMBER_WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twenty: 20 };

function topIn(question: string): number | null {
  const match = TOP_N.exec(normalise(question));
  if (!match) return null;
  const said = match[1] ?? match[2];
  return Math.max(1, Math.min(NUMBER_WORDS[said] ?? Number(said), 50));
}

/**
 * People level: the same, and facts about people by the people the question
 * names, as the service's catalogue path routes them (oversight/ask/router.py,
 * _route_people): nothing about people is declined. A question that evaluates
 * someone gets their scorecard, several side by side, or everyone in order of
 * how closely they follow the process. Finished work, work in progress and a
 * measure named put everyone in order by it; one ticket's assignee, the people
 * view's rankings and one person's tickets and findings are as JO-09 answers
 * them. With comparison off (an organisation's choice) only setting people
 * side by side is refused, in the contract's words; one person's scorecard is
 * always there. The help is only for what no figure answers per person.
 */
function peopleResult(dataset: Dataset, question: string, mentioned: readonly Person[], comparison: PeopleComparison): ScriptResult {
  const aboutPeople = mentioned.length > 0 || asksAboutPeopleAtPeopleLevel(question) || namesSomeone(question, dataset);
  const judged = judging(question, aboutPeople);
  const personnel = judged === "personnel";
  const days = daysIn(question);
  const n = topIn(question);
  const offOr = (answer: () => ScriptResult): ScriptResult => (comparison === "off" ? declined(ASK_DECLINES.comparisonOff, ONE_AT_A_TIME_SUGGESTIONS) : answer());
  const everyoneBy = (measure: ComparedKey | RankedCount | typeof OVERALL, options: { order?: CompareOrder; members?: boolean } = {}) =>
    offOr(() => comparisonAnswer(dataset, measure, days, personnel, { ...options, n }));
  // A measure's comparison in the order the question asks (JO-14): most, highest first; fewest, lowest first; else
  // closer to the process first (orderFor turns a measure named the other way round, "who overruns the most?").
  const everyoneByMeasure = (measure: ComparedKey | typeof OVERALL) => everyoneBy(measure, { order: orderFor(question, measure) ?? "closer" });
  if (judged !== null) {
    if (mentioned.length === 1) return scorecardAnswer(dataset, mentioned, days, personnel);
    if (mentioned.length > 1) {
      // "Rank @A and @B by reopened tickets, highest first", "who is worse on reopened tickets, @A or @B?": that
      // measure's comparison, those people only, in the order asked, as the service plans it (_scorecard_calls).
      const named = scorecardMeasureIn(question, mentioned);
      if (named === null) return offOr(() => scorecardAnswer(dataset, mentioned, days, personnel));
      const only = mentioned.map((person) => person.id);
      return offOr(() => comparisonAnswer(dataset, named, days, personnel, { only, order: orderFor(withoutNames(question, mentioned), named) ?? "closer" }));
    }
    return everyoneByMeasure(measureIn(question) ?? OVERALL);
  }
  const finished = asksForFinishedWork(question);
  // "Who reopens the least work?", "who has the least work in progress?": the figure named, in the order asked, never
  // the open tickets a word of room would give (JO-14, the service's _route_people). A word of room itself still is.
  const spoken = loadIn(question);
  const load = spoken === "spare" && saysOnlyHowLittle(question) && namesAFigure(question, finished) ? null : spoken;
  if (mentioned.length > 1) return sideBySide(dataset, question, mentioned, { finished, load, days, comparison });
  if (mentioned.length === 1) {
    // A scorecard measure named ("does @A skip stages?", "time logged by @A"): their scorecard, that measure next to
    // the whole board's with the rest, never their tickets and findings (the JO-12 check).
    if (scorecardMeasureIn(question, mentioned) !== null) return scorecardAnswer(dataset, mentioned, days, personnel);
    if (asksForBacklog(question) || asksAboutOverload(question) || load === "spare" || load === "busiest") return backlogAnswer(dataset, mentioned[0]);
    if (finished) return doneAnswer(dataset, mentioned[0], days);
    if (asksWhatTheyWorkOn(question) || asksWhoIsIdle(question)) return workingOnAnswer(dataset, mentioned[0]);
    // One person's tickets ("how many open tickets does @X have?"): their open tickets, as the service answers it,
    // never their findings.
    return peopleTopic(question) === "tickets" ? backlogAnswer(dataset, mentioned[0]) : personFindingsAnswer(dataset, question, mentioned[0]);
  }
  if (aboutPeople) {
    const key = issueKeyIn(question);
    if (key) return ticketAssigneeAnswer(dataset, key);
    // A count most first, or fewest first when the question asks for the fewest (orderIn).
    const fewest = asksForFewest(question);
    const counted: CompareOrder = fewest ? "fewest" : "most";
    // Who is idle, or has nothing to do, room for more or the least work (the synonym table, JO-12 G3/G4): the count
    // fewest first, and the members who hold no ticket at all; the qualifiers and negations read first ("not idle",
    // "at full capacity", "not overloaded"), so an answer is never ordered against its question.
    if (load === "idle") return everyoneBy("in_progress", { order: "fewest", members: true });
    if (load === "active") return everyoneBy("in_progress", { order: "most" });
    if (load === "spare") return everyoneBy("open_tickets", { order: "fewest", members: true });
    if (load === "busiest") return everyoneBy("open_tickets", { order: "most" });
    // A measure named: its comparison in the order asked; the ratio only when named as one (findings alone are a count).
    // Read before work done or in progress, whose words name the tickets a rate is of ("reopened after Done", "time
    // logged on done work", "stuck tickets in progress"): the rate is the figure asked for, as the service reads it.
    const measure = measureIn(question);
    if (measure !== null && (measure !== "open_findings_per_10" || namesTheRatio(question))) return everyoneByMeasure(measure);
    if (finished) return everyoneBy("done_in_period", { order: counted });
    if (asksAboutWorkInProgress(question)) return everyoneBy("in_progress", { order: counted });
    if (asksWhoHasNoTickets(question)) return boardPeopleAnswer(dataset, "none");
    // The busiest, the most work: the open tickets, most first; and for what someone is doing ("who is doing the
    // most?"), the tickets done in the period, most first, beside them.
    if (asksWhoIsBusiest(question)) return offOr(() => busiestAnswer(dataset, days, personnel, { n, doing: asksWhatTheyAreDoing(question) }));
    // The biggest backlog, or a heavy load: the scorecard's open tickets, as one person's backlog is counted.
    if (asksForBacklog(question) || asksAboutOverload(question)) return everyoneBy("open_tickets", { order: counted });
    const topic = peopleTopic(question);
    if (topic === "tickets") return ticketsRankingAnswer(dataset, "open_tickets", fewest);
    // Findings are breaches and warnings together; tickets with findings their own figure (the service's _RANK_BY).
    if (topic === "finding") return ticketsRankingAnswer(dataset, "open_findings", fewest);
    if (topic === "tickets_with_findings") return ticketsRankingAnswer(dataset, "tickets_with_findings", fewest);
    if (topic !== null) return rankingAnswer(dataset, question);
    if (asksWhoIsOnTheBoard(question)) return boardPeopleAnswer(dataset, "any");
    if (asksAboutPeople(question) || namesSomeone(question, dataset)) return declined(PEOPLE_HELP_MESSAGE, PEOPLE_SUGGESTIONS);
  }
  if (issueKeyIn(question)) return ISSUE_SCRIPT.run(dataset, question);
  // How many open tickets, or in progress: the board's work by status category, as everywhere else.
  const counted = countStateIn(question);
  if (counted) return countAnswer(dataset, counted);
  const script = bestMatch(question, SCRIPTS);
  return script ? script.run(dataset, question) : declined(NOT_UNDERSTOOD_MESSAGE, FIRST_SUGGESTIONS);
}

/**
 * Whether a question names a figure of its own, as the service reads it (_figure_named): work finished, work in
 * progress, a rate, or the ratio named as one.
 */
function namesAFigure(question: string, finished: boolean): boolean {
  const measure = measureIn(question);
  return finished || asksAboutWorkInProgress(question) || (measure !== null && (measure !== "open_findings_per_10" || namesTheRatio(question)));
}

/** A letter, a mark, a digit or an underscore: what a name may not run into (as src/lib/names.ts finds names). */
const NAME_EDGE = "[\\p{L}\\p{M}\\p{N}_]";

/**
 * The question without the names of the people it mentions (and the @ before
 * them), longest first and in any case, as the service's router reads it
 * (oversight/ask/people.py: strip_names): a name is no topic, and stands
 * between no words ("how much time do @A and @B log").
 */
function withoutNames(question: string, people: readonly Person[]): string {
  const names = [...new Set(people.map((person) => person.name).filter((name) => name.trim().length > 0))].sort((a, b) => b.length - a.length);
  return names.reduce((text, name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return text.replace(new RegExp(`@?(?<!${NAME_EDGE})${escaped}(?!${NAME_EDGE})`, "giu"), " ");
  }, question);
}

/**
 * The scorecard measure a question about the people it mentions names, one
 * only the scorecard holds (time logged, stuck, reopened, skipped a stage,
 * estimates, effort, code review, and the ratio when it is named as one:
 * "findings per 10 tickets"), as the service's router reads it
 * (_scorecard_measure); null for none, and for findings named alone, which
 * the people view's rows count for them (their open breaches and warnings).
 */
function scorecardMeasureIn(question: string, mentioned: readonly Person[]): ComparedKey | null {
  const words = withoutNames(question, mentioned);
  const measure = measureIn(words);
  return measure === "open_findings_per_10" && !namesTheRatio(words) ? null : measure;
}

/**
 * Two to ten people side by side, by the figure the question names, as the
 * service's router plans it (_side_by_side): a scorecard measure (that
 * measure's comparison, those people only, then the board; read first, so
 * "the time they log on their done work" is time logged, not work done; with
 * comparison off, the comparison-off sentence); what they finished or have in
 * progress (their tickets, for a few people asked what they work on or with
 * comparison off; else the comparison of that count, those people only);
 * their open tickets, findings, tickets with findings or warnings (the people
 * view's rows for them: a raw count, never a comparison); their open breaches
 * and warnings when it names none of these, or both.
 */
function sideBySide(
  dataset: Dataset,
  question: string,
  mentioned: readonly Person[],
  { finished, load, days, comparison }: { finished: boolean; load: Load | null; days: ScorecardDays; comparison: PeopleComparison },
): ScriptResult {
  const ids = mentioned.map((person) => person.id);
  const measure = scorecardMeasureIn(question, mentioned);
  if (measure !== null) {
    if (comparison === "off") return declined(ASK_DECLINES.comparisonOff, ONE_AT_A_TIME_SUGGESTIONS);
    // In the order asked (JO-14): "who has more reopened tickets, @A or @B?" is the highest first.
    return comparisonAnswer(dataset, measure, days, false, { only: ids, order: orderFor(withoutNames(question, mentioned), measure) ?? "closer" });
  }
  const fewest = orderIn(withoutNames(question, mentioned)) === "fewest";
  const count = finished ? "done_in_period" : asksAboutWorkInProgress(question) || asksWhatTheyWorkOn(question) || load === "idle" || load === "active" ? "in_progress" : null;
  if (count !== null) {
    const asksWhat = /\bwork(?:s|ing)? on\b|\bdoing\b|\bbusy with\b|\bpicked up\b/.test(normalise(question));
    if (mentioned.length <= MAX_CALLS && (asksWhat || comparison === "off")) {
      const each = mentioned.map((person) => (count === "done_in_period" ? doneAnswer(dataset, person, days) : workingOnAnswer(dataset, person)));
      return combined(each);
    }
    if (comparison === "off") return declined(ASK_DECLINES.comparisonOff, ONE_AT_A_TIME_SUGGESTIONS);
    return comparisonAnswer(dataset, count, days, false, { order: fewest || load === "idle" ? "fewest" : "most", only: ids });
  }
  let topic = peopleTopic(question);
  if (topic === null && (asksForBacklog(question) || asksAboutOverload(question) || asksWhoIsBusiest(question) || load === "spare" || load === "busiest")) {
    topic = "tickets";
  }
  const words = normalise(question);
  if (topic === "finding" && /\bbreach|\bviolation/.test(words) && /\bwarning/.test(words)) topic = null;
  const lowest = fewest || load === "spare";
  if (topic === "tickets") return ticketsRankingAnswer(dataset, "open_tickets", lowest, ids);
  if (topic === "finding") return ticketsRankingAnswer(dataset, "open_findings", lowest, ids);
  if (topic === "tickets_with_findings") return ticketsRankingAnswer(dataset, "tickets_with_findings", lowest, ids);
  if (topic === "warning") return ticketsRankingAnswer(dataset, "open_warnings", lowest, ids);
  // Nothing named, or breaches: each one's open breaches and warnings, side by side.
  return mentionedAnswer(dataset, mentioned);
}

/** Several answers as one: their facts renumbered in order (F1, F2, ...), their sentences joined. */
function combined(results: readonly ScriptResult[]): ScriptResult {
  const facts: FactSet[] = [];
  const pieces: Piece[] = [];
  for (const result of results) {
    if (result.outcome !== "answered") continue;
    const renamed = new Map<object, FactSet>(result.facts.map((fact, index) => [fact, { ...fact, ref: `F${facts.length + index + 1}` }]));
    facts.push(...renamed.values());
    if (pieces.length > 0) pieces.push(" ");
    pieces.push(...result.pieces.map((piece): Piece => {
      if (typeof piece === "string") return piece;
      const fact = renamed.get(piece.fact);
      return fact ? { ...piece, fact } : piece;
    }));
  }
  return { outcome: "answered", facts, pieces };
}

/** The messages of a question nothing placed: the last resort and a name no one has are read only after them. */
const UNPLACED: readonly string[] = [NOT_UNDERSTOOD_MESSAGE, PEOPLE_HELP_MESSAGE];

/**
 * The last resort for a question about people that nothing here places
 * (JO-12, G3/G4), as the service's router.last_resort plans it: the overall
 * comparison of everyone, or the scorecards of the people it mentions, over
 * the period its words give, the figures it uses said first. Null for a
 * question about no one, and where comparing people is turned off and the
 * comparison is what it needs: the help stands.
 */
function lastResort(dataset: Dataset, question: string, mentioned: readonly Person[], comparison: PeopleComparison): ScriptResult | null {
  if (mentioned.length === 0 && !asksAboutPeopleAtPeopleLevel(question)) return null;
  if (comparison === "off" && mentioned.length !== 1) return null;
  const days = daysIn(question);
  // Closer to the process first: a direction word alone ("who writes the most comments?") is about something no figure
  // counts. A question about the other side of the process ("who makes the most mistakes?") is further from it first,
  // and the least of that closer first, as everywhere (orderFor).
  const order = asksAboutTheFurtherSide(question) ? (orderFor(question, OVERALL) ?? "closer") : "closer";
  const answer = mentioned.length > 0 ? scorecardAnswer(dataset, mentioned, days, false) : comparisonAnswer(dataset, OVERALL, days, false, { order });
  if (answer.outcome !== "answered") return answer;
  return { ...answer, pieces: [mentioned.length > 0 ? LAST_RESORT.scorecard : LAST_RESORT.overall, "\n\n", ...answer.pieces] };
}

function result(dataset: Dataset, question: string, options: AskOptions, mentioned: Mentioned | null): ScriptResult | NoTickets {
  if (!question) {
    return { outcome: "not_understood", message: `Ask a question about the work in ${dataset.board.key}, for example one of these.`, suggestions: [...FIRST_SUGGESTIONS] };
  }
  if (question.length > ASK_MAX_LENGTH) {
    return {
      outcome: "not_understood",
      message: `That is longer than a question can be (${ASK_MAX_LENGTH} characters). Ask one thing at a time.`,
      suggestions: [...FIRST_SUGGESTIONS],
    };
  }
  if (options.level === "team") return teamResult(dataset, question, options);
  // Someone mentioned who is not on the board at all: said before anything is planned, as the service says it.
  if (mentioned === null) return declined(ASK_DECLINES.unknownMention, PEOPLE_SUGGESTIONS);
  // A name typed in full that two people on the board share: the admin picks the one they mean with @.
  if (mentioned.ambiguous.length > 0) return declined(ambiguousNameMessage(mentioned.ambiguous), PEOPLE_SUGGESTIONS);
  // A first name typed on its own that two people on the board share: the same, naming who it could be.
  if (mentioned.ambiguousFirst) {
    return declined(ambiguousFirstNameMessage(mentioned.ambiguousFirst.first, mentioned.ambiguousFirst.names), PEOPLE_SUGGESTIONS);
  }
  // Everyone mentioned is a member with no tickets: nothing to plan or ask; the sentence says so.
  if (mentioned.all.length > 0 && mentioned.holding.length === 0) return { outcome: "no_tickets", people: mentioned.without };
  // Otherwise the question is answered about the people who hold tickets; the rest get a paragraph of their own.
  return peopleResult(dataset, question, mentioned.holding, options.comparison ?? "on");
}

export function askSample(dataset: Dataset, question: string, latencyMs: number, options: AskOptions = { level: "team", mentions: [] }): AskResponse {
  const asked = question.trim();
  const base = {
    meta: meta(dataset),
    qa_id: qaId(dataset, asked, options),
    question: asked,
    latency_ms: Math.max(0, Math.round(latencyMs)),
    // No model wrote a sample answer: a script did, from the same facts.
    model: null,
    asked_at: iso(dataset.now),
    // The sample has no model, so no budget to use up: no note under its answers.
    note: null,
  };
  const empty = { answer: null, citations: [], facts: [], plan: [], missing_evidence: [], message: null, suggestions: [], people: [] };
  // Everyone on the board: the people assigned its tickets now and its members who hold none. A ticket holder holds
  // work (JO-12, G5): someone who holds only Epics holds none of its tickets.
  const board = directoryPeople(dataset);
  const holders = new Set(workPeople(dataset).map((person) => person.id));
  const found = options.mentions.map((id) => board.find((person) => person.id === id));
  // Null when anyone mentioned is not on the board at all.
  const picked = found.every((person): person is Person => person !== undefined) ? found : null;
  // At people level a name typed in full is that person, as if picked with @ (JO-11); team level never reads names.
  const typed = options.level === "people" && picked ? typedPeople(asked, board) : { people: [], ambiguous: [], ambiguousFirst: null };
  const all = picked && [...picked, ...typed.people.filter((person) => !picked.some((other) => other.id === person.id))];
  const split = (people: readonly Person[]) => ({
    all: people,
    holding: people.filter((person) => holders.has(person.id)),
    without: people.filter((person) => !holders.has(person.id)),
  });
  let mentioned: Mentioned | null = all && { ...split(all), ambiguous: typed.ambiguous, ambiguousFirst: typed.ambiguousFirst };
  let outcome = result(dataset, asked, options, mentioned);
  // A first name typed in lower case where a name stands ("how is ada doing?"), read only when nothing else made sense
  // of a question that asks something of one person, as the service reads it (oversight/ask/service.py): that person,
  // as if picked with @, when only one person on the board goes by it; a name two people share asks for @.
  // What nothing placed: not understood, the help, or comparing people refused for a question that judges no one (one
  // that judges people is refused before any name is read, as the service refuses it).
  const aboutPeople = (mentioned?.holding.length ?? 0) > 0 || asksAboutPeopleAtPeopleLevel(asked) || namesSomeone(asked, dataset);
  const unplaced = (answer: ScriptResult | NoTickets) =>
    answer.outcome === "not_understood" &&
    (UNPLACED.includes(answer.message) || (answer.message === ASK_DECLINES.comparisonOff && judging(asked, aboutPeople) === null));
  let resolved = false;
  if (options.level === "people" && mentioned !== null && mentioned.all.length === 0 && unplaced(outcome) && asksOfSomeone(asked)) {
    const loose = looselyNamed(asked, board);
    if (loose.length === 1) {
      const [{ first, people }] = loose;
      resolved = true;
      if (people.length > 1) {
        outcome = declined(ambiguousFirstNameMessage(first, people.map((person) => person.name)), PEOPLE_SUGGESTIONS);
      } else {
        mentioned = { ...split(people), ambiguous: [], ambiguousFirst: null };
        outcome = result(dataset, asked, options, mentioned);
      }
    }
  }
  // Never turn an admin away (JO-12, G3/G4), as the service does once the loose name found no one: a name typed where
  // a person's name stands that no one on the board goes by is said so; any other question about people gets the
  // overall comparison (or the scorecards of the people it mentions), with a sentence first saying which figures.
  if (options.level === "people" && mentioned !== null && !resolved && unplaced(outcome)) {
    const unknown = mentioned.all.length === 0 ? unknownName(asked, board, asksOfSomeone(asked)) : null;
    if (unknown !== null) {
      outcome = declined(noOneCalledMessage(unknown), PEOPLE_SUGGESTIONS);
    } else {
      const fallback = lastResort(dataset, asked, mentioned.holding, options.comparison ?? "on");
      if (fallback !== null) outcome = fallback;
    }
  }
  // The members mentioned who hold no tickets, when others mentioned do: the answer about the others ends with them.
  const rest =
    outcome.outcome !== "no_tickets" && mentioned && mentioned.without.length > 0 && options.level === "people"
      ? `\n\n${noTicketsSentence(mentioned.without.map((person) => person.name))}`
      : "";

  /** An answer passes when its figures and its names are in its facts: then it names the people it names. */
  const answered = (answer: string, facts: FactSet[], plan: PlanStep[]): AskResponse | null => {
    // At people level a name also places the figures beside it in the rows that hold only that person's id, as the
    // service's check does (oversight/ask/service.py, verify).
    const check = verify(answer, facts, plan, options.level === "people" ? { people: board } : {});
    // Team level names no one; people level names only people its facts or mentions hold.
    const people = options.level === "people" ? verifiedPeople(answer, facts, mentioned?.all ?? [], board) : [];
    if (!check.ok || people === null) return null;
    const citations = check.bindings.map(({ start: _start, ...binding }) => binding);
    return { ...base, ...empty, outcome: "answered", answer, citations, facts, plan, people };
  };

  switch (outcome.outcome) {
    case "no_tickets": {
      // Built here, never by a model, to the letter: the whole answer, and the people it names in mention order.
      const sentence = noTicketsSentence(outcome.people.map((person) => person.name));
      return {
        ...base,
        ...empty,
        outcome: "no_data",
        answer: sentence,
        // No message: the answer says it all, and names stay in the answer, where only people level puts them.
        message: null,
        suggestions: [...PEOPLE_SUGGESTIONS],
        people: outcome.people.map((person) => ({ ...person })),
      };
    }
    case "answered": {
      const { answer, citations } = compose(rest ? [...outcome.pieces, rest] : outcome.pieces);
      const plan = planOf(outcome.facts);
      const passed = answered(answer, outcome.facts, plan);
      // The composed citations bind each figure to the very cell it was read from.
      if (passed) return { ...passed, citations };
      return { ...base, ...empty, outcome: "not_verified", facts: outcome.facts, plan, message: NOT_VERIFIED_MESSAGE };
    }
    case "not_verified": {
      const plan = planOf(outcome.facts);
      // The first draft and the stricter retry: shown only if one of them passes.
      for (const draft of outcome.drafts) {
        const passed = answered(`${draft}${rest}`, outcome.facts, plan);
        if (passed) return passed;
      }
      return { ...base, ...empty, outcome: "not_verified", facts: outcome.facts, plan, message: NOT_VERIFIED_MESSAGE };
    }
    case "no_data":
      return {
        ...base,
        ...empty,
        outcome: "no_data",
        facts: outcome.facts,
        plan: planOf(outcome.facts),
        message: outcome.message,
        suggestions: outcome.suggestions,
      };
    case "not_measurable":
      return {
        ...base,
        ...empty,
        outcome: "not_measurable",
        plan: outcome.plan,
        missing_evidence: outcome.missing,
        message: outcome.message,
        suggestions: outcome.suggestions,
      };
    case "not_understood":
      return { ...base, ...empty, outcome: "not_understood", message: outcome.message, suggestions: outcome.suggestions };
  }
}
