/** Matching a typed question to one of the sample's scripted questions. The */

export function normalise(question: string): string {
  return question
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9'\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Concepts, each a pattern over normalised text. Named so scripts read as sentences. */
const CONCEPTS = {
  stuck: /\b(stuck|bottlenecks?|wait(s|ing|ed)?|longest|time in status|sit(s|ting)? (longest|the longest|idle))\b/,
  epic: /\bepics?\b/,
  breach: /\b(breach(es)?|hot ?spots?|worst|most (problems|findings))\b/,
  estimate: /\b(estimat\w*|sized?|sizing|story points?|pointed)\b/,
  start: /\b(start\w*|began|begin\w*|picked up|before (work|it|they|development))\b/,
  skip: /\b(straight|skip\w*|directly|jump\w*|bypass\w*)\b/,
  done: /\b(done|finished|closed|completed?)\b/,
  trend: /\b(trend\w*|over time|week(s|ly)?|month(s|ly)?|changing|rising|falling|going up|going down)\b/,
  effort: /\b(effort|logged|time spent|over ?run\w*|over (the |their |our )?estimates?)\b/,
  measure: /\b(measur\w*|not tracked|untracked|trackable)\b/,
  rule: /\brules?\b/,
  review: /\b(code ?reviews?|review\w*|pull requests?)\b/,
  test: /\b(test\w*|qa|quality assurance)\b/,
  reopen: /\b(re-?open\w*|came back|bounced back)\b/,
  recent: /\b(this week|last (7|seven) days|past (7|seven) days|past week|recent(ly)?|lately|today|yesterday)\b/,
  cycle: /\b(cycle time|lead time|how long|take to (finish|complete)|turnaround)\b/,
  burn: /\b(burn\w*|used up|used (the )?most|consum\w*|eaten)\b/,
  open: /\b(open|in progress|in flight|ongoing|still|unfinished|not (yet )?(done|finished))\b/,
} as const satisfies Record<string, RegExp>;

type Concept = keyof typeof CONCEPTS;

/** Questions about individuals. Oversight reports at team and process level */
const PERSON =
  /\b(who|whom|whose|developers?|engineers?|person|people|individuals?|programmers?|testers?|employees?|staff|colleagues?|team members?|somebody|someone|anybody|by name)\b/;

export function asksAboutPeople(text: string): boolean {
  return PERSON.test(normalise(text));
}

/** At people level, the words that make a question about people (a mention */
const ABOUT_PEOPLE =
  /\b(?:who|whom|whose|developers?|devs|engineers?|programmers?|testers?|person|people|individuals?|team\s*-?\s*members?|members?|teammates?|colleagues?|staff|employees?|users?|everyone|everybody|anyone|anybody|someone|somebody|performers?|per\s+person|by\s+person|by\s+name|each\s+person|headcount)\b/;
const PEOPLE_AS_A_GROUP = /\b(?:assignees?|dev|(?:the\s+)?team|squad|the\s+others|the\s+rest|each\s+other)\b/;

export function asksAboutPeopleAtPeopleLevel(text: string): boolean {
  const words = normalise(text);
  return ABOUT_PEOPLE.test(words) || (PEOPLE_AS_A_GROUP.test(words) && asksToEvaluate(text));
}

const EVALUATIVE =
  /\b(?:slow\w*|fast\w*|quick\w*|best|worst|better|worse|good|bad|badly|great|poor(?:ly)?|productiv\w*|unproductive|perform\w*|underperform\w*|effort\w*|hard(?:er|est|ly)?|hard[\s-]?work\w*|slack(?:er|ers|ing|ed)|weak\w*|strong\w*|efficien\w*|inefficien\w*|diligen\w*|careful\w*|conscientious\w*|judge\w*|rating|rated|doing (?:well|badly|ok|okay|fine)|how (?:is|are|was|were|has|have)\b.*\bdoing|sincer\w*|insincer\w*|follow(?:s|ing|ed)?\s+(?:the\s+)?(?:agile|process)\w*|pull(?:s|ing)?\s+(?:their|his|her)\s+(?:own\s+)?weight|struggl\w*|(?:fall(?:s|ing|en)?|fell|running|lagging|is|are|was|were|get(?:s|ting)?|got)\s+behind|need(?:s|ed|ing)?\s+(?:\w+\s+){0,2}?(?:help|support|attention|coaching|mentoring)|mvps?|most\s+valuable|valuable|(?:rock|super)?stars?|standouts?|stand(?:s|ing)?\s+out|outperform\w*|lagg(?:ing|ed|ards?)|lags?|complian\w*|non-?complian\w*|compl(?:y|ies|ied|ying)|adher\w*|deviat\w*|stray\w*|non-?conform\w*|(?:further|furthest|farthest|closest|closer)\s+(?:away\s+)?(?:from|to)\s+(?:the\s+|our\s+)?(?:agile\s+)?process|(?:ignor|break|bend|skirt|flout|disregard)\w*\s+(?:the\s+|our\s+|their\s+)?(?:agile\s+)?(?:process|workflow|rules?)|rank\w*|top|bottom|scorecards?|compar\w*|versus|vs|side[\s-]by[\s-]side)\b/;

export function asksToEvaluate(text: string): boolean {
  return EVALUATIVE.test(normalise(text));
}

/** Personnel words: firing (sacking, letting go, dismissing, laying off, */
const PERSONNEL =
  /\b(?:fire|fired|fires|firing|sack\w*|dismiss\w*|terminat\w*|let\s+(?:\S+\s+){0,3}?go|laid\s+off|lay(?:s|ing)?\s+(?:\S+\s+){0,3}?off|made\s+redundant|make\s+(?:\S+\s+){0,3}?redundant|redundanc(?:y|ies)|demot\w*|(?:should|could|must|can|do|would|shall)\s+(?:we|i|you)\s+replace|be\s+replaced|replac(?:e|ing)\s+(?:him|her|them)|promot\w*|reward\w*|bonus\w*|appraisal\w*|performance\s+reviews?|pay\s+(?:rise|raise|increase)|(?:get|gets|give|deserves?|earn|earns|got)\s+(?:\S+\s+){0,2}?(?:raise|rise)|deserv\w*|blam\w*|fault\w*|trust\w*|disciplin\w*|probation\w*|lazy|lazi\w*|attitude\w*|competen\w*|incompeten\w*|skill\w*|reliab\w*|unreliab\w*|useless\w*|careless\w*|dishonest\w*|stupid\w*|idiot\w*|hopeless\w*|worthless\w*|pathetic\w*)\b/;

export function asksPersonnel(text: string): boolean {
  return PERSONNEL.test(normalise(text));
}

const RANKING_WORD = /^(?:rank\w*|top|bottom|compar\w*|versus|vs|side[\s-]by[\s-]side)$/;

/** Whether the only evaluating words a question holds are ranking words: a raw-count ranking when it names a count. */
export function ranksOnly(text: string): boolean {
  const words = normalise(text);
  const found = [...words.matchAll(new RegExp(EVALUATIVE.source, "g"))].map((match) => match[0]);
  return found.length > 0 && found.every((word) => RANKING_WORD.test(word)) && !PERSONNEL.test(words);
}

export function peopleTopic(text: string): "breach" | "warning" | "finding" | "tickets" | "tickets_with_findings" | null {
  const words = normalise(text);
  if (/\bbreach|\bviolation/.test(words) && /\bwarning/.test(words)) return "finding";
  if (/\b(?:tickets?|issues?)\s+(?:with|that\s+have|having)\s+(?:any\s+|open\s+)?(?:findings?|problems?|breaches|warnings)\b/.test(words)) {
    return "tickets_with_findings";
  }
  if (/\bbreach|\bviolation/.test(words)) return "breach";
  if (/\bwarning/.test(words)) return "warning";
  if (/\bfinding|\bproblems?\b|\bbroken rules?\b|\bflagged\b/.test(words)) return "finding";
  if (/\bworking on\b|\bwork(?:load)?\b|\btickets?\b|\bissues?\b|\bassigned\b|\bholds?\b|\bholding\b|\bbusy\b/.test(words)) return "tickets";
  return null;
}

/** The word lists below are the service's (oversight/ask/router.py), read alike */

/** "What is @X's backlog?": their open tickets, as "working on" is their tickets in progress. */
const BACKLOG = /\b(?:backlog|to[\s-]?do|open work|outstanding|on (?:their|his|her) plate)\b/;

export function asksForBacklog(text: string): boolean {
  return BACKLOG.test(normalise(text));
}

/** A heavy load ("who is overloaded?", "who is over capacity?"): the open tickets, most first; one person's, their backlog. */
const OVERLOAD =
  /\boverload\w*|\boverwhelm\w*|\bswamped\b|\bsnowed under\b|\bstretched(?: too)? thin\b|\btoo much (?:work|on)\b|\b(?:heaviest|biggest|largest) (?:load|workload)\b|\b(?:over|at|beyond|out of) capacity\b|\bno (?:spare )?capacity\b/;

export function asksAboutOverload(text: string): boolean {
  return OVERLOAD.test(normalise(text));
}

const SPARE_ROOM =
  /\bnothing to do\b|\b(?:spare|free|most) capacity\b|\bcapacity\b|\bbandwidth\b|\bunder-?(?:used|utili[sz]ed|loaded|work\w*|employ\w*|occupied)\b|\b(?:lightest|smallest|least) (?:load|workload)\b|\blightest\b|\bon the bench\b|\broom for more\b|\bavailab(?:le|ility)\b|\bquietest\b|\bfree\s+(?:to|for)\b|\b(?:take|taking|took|handle|pick)\s+(?:on\s+|up\s+)?(?:more|extra|another|additional)\b|\b(?:least|less|not(?:\s+very)?)\s+busy\b|n't(?:\s+very)?\s+busy\b|\bleast\s+loaded\b|\b(?:spare|free)\s+(?:time|cycles?)\b|\blight(?:ly)?\s+(?:on\s+(?:work|load|tickets|tasks)|loaded)\b|\blight\s+(?:work)?load\b|\b(?:got|has|have|had)\s+(?:the\s+)?least\s+on\b/;
const SPARE_HOW_MUCH =
  /\b(?:do|does|doing|did)\s+(?:the\s+)?least\b|\bwork(?:s|ing|ed)?\s+(?:the\s+)?least\b|\bleast\s+(?:work|tasks|to\s+do|going\s+on|on\s+(?:their|his|her)\s+plate)\b|\bfewest\s+tasks\b|\b(?:has|have|got|holds?)\s+(?:the\s+)?(?:least|fewest)$/;
const SPARE = new RegExp(`${SPARE_ROOM.source}|${SPARE_HOW_MUCH.source}`);

export function asksAboutSpareCapacity(text: string): boolean {
  return SPARE.test(normalise(text));
}

const NO_ROOM =
  /\b(?:no|zero|little|limited|least|full)\s+(?:spare\s+|free\s+)?(?:capacity|bandwidth|room)\b|\b(?:at|near|nearing|reached|reaching|hit|hitting|over|beyond|out\s+of)\s+(?:(?:their|his|her|full)\s+)?capacity\b|\b(?:not|never)\s+(?:very\s+)?available\b|n't\s+(?:very\s+)?available\b|\bunavailable\b|\b(?:can't|cant|cannot|can\s+not|couldn't|could\s+not|unable\s+to)\s+(?:take|handle|pick)\s+(?:on\s+|up\s+)?(?:any\s+)?(?:more|extra|another|additional)\b|\bmaxed(?:\s+out)?\b|\bflat\s+out\b|\bover-?worked\b|\bover-?stretched\b|\b(?:got|has|have|had)\s+(?:the\s+)?most\s+on\b/;
/** A negation (or "least") before a load word turns it round, as the service reads it. */
const NEGATED = String.raw`(?:\bnot|n't|\bnever|\bleast)\s+(?:very\s+|too\s+|that\s+)?`;
const NOT_OVERLOADED = new RegExp(`${NEGATED}(?:overload\\w*|overwhelm\\w*|swamped|snowed\\s+under|stretched|over-?worked|over-?stretched)\\b`);
const NOT_UNDERWORKED = new RegExp(`${NEGATED}under-?(?:used|utili[sz]ed|loaded|work\\w*|employ\\w*|occupied)\\b`);
const NOT_IDLE = new RegExp(`${NEGATED}idle\\b`);

/** Which way a question about how much work people have points, its qualifiers and negations read first (the service's _load). */
export type Load = "active" | "idle" | "busiest" | "spare";

export function loadIn(text: string): Load | null {
  const words = normalise(text);
  if (NOT_IDLE.test(words)) return "active";
  if (IDLE.test(words)) return "idle";
  if (NOT_UNDERWORKED.test(words) || NO_ROOM.test(words)) return "busiest";
  if (NOT_OVERLOADED.test(words) || (SPARE.test(words) && !OVERLOAD.test(words))) return "spare";
  return null;
}

export function saysOnlyHowLittle(text: string): boolean {
  const words = normalise(text);
  return SPARE_HOW_MUCH.test(words) && !SPARE_ROOM.test(words) && !NOT_OVERLOADED.test(words);
}

/** The most: the busiest, doing the most, the most work, over capacity aside: */
const BUSIEST =
  /\bbusiest\b|\bbusy\b|\bmost\s+(?:busy|loaded|work|tasks|going\s+on|on\s+(?:their|his|her)\s+plate)\b|\b(?:do|does|doing|did)\s+(?:the\s+)?most\b|\bwork(?:s|ing|ed)?\s+(?:the\s+)?most\b|\b(?:has|have|got|holds?)\s+(?:the\s+)?most$/;
const DOING = /(?<!\bto )\b(?:do|does|doing|did)\b/;

export function asksWhoIsBusiest(text: string): boolean {
  return BUSIEST.test(normalise(text));
}

export function asksWhatTheyAreDoing(text: string): boolean {
  return DOING.test(normalise(text));
}

/** Idle: nothing in progress now, fewest first, and the members who hold no ticket at all. */
const IDLE =
  /\bidle\b|\bnot (?:doing|working on) anything\b|\bnothing (?:in progress|on the go)\b|\bnothing to work on\b|\bno (?:tickets?|work|issues?) in progress\b/;

export function asksWhoIsIdle(text: string): boolean {
  return IDLE.test(normalise(text));
}

export function countStateIn(text: string): "open" | "in_progress" | null {
  const words = normalise(text);
  if (!/\bhow many\b|\bcount\b|\bnumber of\b/.test(words) || !/\b(?:tickets?|issues?|work items?)\b/.test(words)) return null;
  if (/\bopen\b|\bnot (?:yet )?done\b|\bunfinished\b|\boutstanding\b/.test(words)) return "open";
  if (/\bin progress\b|\bwip\b/.test(words)) return "in_progress";
  return null;
}

export const N_WORDS = String.raw`(?:\d{1,2}|two|three|four|five|six|seven|eight|nine|ten|twenty)`;
const MOST = String.raw`(?<!\bat )\bmost\b(?!\s+closely)|\bmore\b(?!\s+closely)|\b(?:highest|largest|biggest|greatest|maximum)\b|\b(?:higher|larger|bigger|greater)\b|\bdescending\b|\bhigh\s+to\s+low\b`;
const FEWEST = String.raw`(?<!\bat )\bleast\b|\b(?:fewest|lowest|smallest|minimum)\b|\b(?:fewer|less|lower|smaller)\b|\bascending\b|\blow\s+to\s+high\b`;
const TOP = new RegExp(String.raw`\btop\s+${N_WORDS}\b|\bat\s+the\s+(?:very\s+)?top\b`);
const BOTTOM = new RegExp(String.raw`\bbottom\s+${N_WORDS}\b|\bat\s+the\s+(?:very\s+)?bottom\b`);

export type AskedOrder = "most" | "fewest";

/** The direction words of a normalised question, in order: where each stands and which way it points. */
function directionWords(words: string): { start: number; end: number; kind: AskedOrder }[] {
  const found = (source: string, kind: AskedOrder) => [...words.matchAll(new RegExp(source, "g"))].map((hit) => ({ start: hit.index, end: hit.index + hit[0].length, kind }));
  return [...found(MOST, "most"), ...found(FEWEST, "fewest")].sort((a, b) => a.start - b.start);
}

export function orderNear(text: string, near: RegExp | null): AskedOrder | null {
  const words = normalise(text);
  const found = directionWords(words);
  if (found.length === 0) {
    const top = TOP.exec(words);
    const bottom = BOTTOM.exec(words);
    if (top && (!bottom || top.index < bottom.index)) return "most";
    return bottom ? "fewest" : null;
  }
  if (found.every((hit) => hit.kind === found[0].kind)) return found[0].kind;
  for (let index = 0; index + 1 < found.length; index += 1) {
    const [hit, next] = [found[index], found[index + 1]];
    if (hit.kind !== next.kind && /^\s+to\s+(?:the\s+)?$/.test(words.slice(hit.end, next.start))) return hit.kind;
  }
  const named = near ? near.exec(words) : null;
  if (!named) return found[0].kind;
  const [from, to] = [named.index, named.index + named[0].length];
  const gap = (hit: { start: number; end: number }) => (hit.end <= from ? [from - hit.end, 0] : [Math.max(0, hit.start - to), 1]);
  return [...found].sort((a, b) => gap(a)[0] - gap(b)[0] || gap(a)[1] - gap(b)[1])[0].kind;
}

export function orderIn(text: string): AskedOrder | null {
  return orderNear(text, null);
}

const FURTHER =
  /\b(?:worst|worse|weak(?:est|er)?|poor(?:est|er|ly)?|bad(?:ly)?|slow(?:est|er|ly)?|underperform\w*|lagg\w*|lags?|struggl\w*|(?:fall(?:s|ing|en)?|fell|running|lagging|is|are|was|were|get(?:s|ting)?|got)\s+behind|need(?:s|ed|ing)?\s+(?:\w+\s+){0,2}?(?:help|support|attention|coaching|mentoring|improv\w*)|troubl\w*|difficult(?:y|ies)|problems?\s+(?:with|in|at|on|over|\w+ing)|mistakes?|(?:further|furthest|farthest)\s+(?:away\s+)?from|deviat\w*|stray\w*|non-?complian\w*|non-?conform\w*|(?:ignor|break|bend|skirt|flout|disregard)\w*\s+(?:the\s+|our\s+|their\s+)?(?:agile\s+)?(?:process|workflow|rules?)|lazy|laz(?:ier|iest|iness)|slack(?:er|ers|ing|ed)|unproductive|inefficien\w*|careless\w*|unreliab\w*|incompeten\w*|useless\w*|hopeless\w*|(?:not|n't|never)\s+(?:\w+\s+)?pull\w*\s+(?:their|his|her)\s+(?:own\s+)?weight)\b/g;
/** A negation at most two words before a measure's words, or before a word of the other side of the process. */
export const NEGATION_BEFORE = /(?:\bnot|\bnever|\bno|\bwithout|n't|\bmissing|\black(?:s|ing)?|\bfail(?:s|ed|ing)?\s+to|\bforg[eo]t(?:s|ten)?\s+to)\s+(?:\w+\s+){0,2}$/;

export function asksAboutTheFurtherSide(text: string): boolean {
  const words = normalise(text);
  return [...words.matchAll(FURTHER)].some((hit) => !NEGATION_BEFORE.test(words.slice(0, hit.index)));
}

/** Who has the least: a count, fewest first ("at least five" is no such question): the order above, fewest. */
export function asksForFewest(text: string): boolean {
  return orderIn(text) === "fewest";
}

const RATIO = /\bper\s+(?:10|ten)\b|\b(?:findings?|breach(?:es)?|warnings?)\s+(?:per\s+(?:open\s+)?(?:tickets?|issues?)|ratio|rate|density)\b/;

export function namesTheRatio(text: string): boolean {
  return RATIO.test(normalise(text));
}

/** Work someone finished or contributed (and not work still to finish): their tickets done in the period, or everyone by that count. */
const FINISHED =
  /\b(?:clos(?:e|es|ed|ing)|done|finish\w*|complet(?:e|es|ed|ing)|resolv(?:e|es|ed|ing)|deliver(?:s|ed|ing)?|shipp?(?:ed|ing)?|contribut\w*)\b/;
const NOT_FINISHED = /\b(?:not|never)\s+(?:yet\s+)?(?:been\s+)?(?:done|finished|closed|completed?|resolved)\b/;

export function asksForFinishedWork(text: string): boolean {
  const words = normalise(text);
  const topic = peopleTopic(text);
  return FINISHED.test(words) && !/\bopen\b/.test(words) && !NOT_FINISHED.test(words) && (topic === null || topic === "tickets");
}

/** "Who has the most tickets in progress?": everyone by that count. */
export function asksAboutWorkInProgress(text: string): boolean {
  return /\b(?:in progress|wip)\b/.test(normalise(text));
}

/** "Who is on this board?", "List the members": everyone on it, those who hold its tickets and its members who hold none. */
export function asksWhoIsOnTheBoard(text: string): boolean {
  return /\b(?:on|in|of) (?:this|the) (?:board|team|project)\b|\bwho works? (?:here|on (?:this|the) board)\b|\bmembers?\b|\bmembership\b|\broster\b|\bheadcount\b|\bwho (?:is|are) here\b/.test(
    normalise(text),
  );
}

/** "Which people have no tickets?": the board's members who hold none of its tickets, as the @ list shows them. */
export function asksWhoHasNoTickets(text: string): boolean {
  return /\bno tickets?\b|\bwithout (?:any |a )?tickets?\b|\bnothing assigned\b|\bno (?:work|issues?) assigned\b/.test(normalise(text));
}

/** Whether a question asks about one of the counts people can be put in order by: a backlog, a load, work in progress, finished work, who is idle or has nothing to do. */
export function asksForACount(text: string): boolean {
  return (
    asksForBacklog(text) ||
    asksAboutOverload(text) ||
    asksAboutSpareCapacity(text) ||
    asksWhoIsIdle(text) ||
    NO_ROOM.test(normalise(text)) ||
    // The busiest too, so "top 3 busiest people" is the open tickets, most first, never the overall comparison.
    asksWhoIsBusiest(text) ||
    asksAboutWorkInProgress(text) ||
    asksForFinishedWork(text)
  );
}

/** Whether a question asks something of one person in its own words, as the */
export function asksOfSomeone(text: string): boolean {
  return asksToEvaluate(text) || asksPersonnel(text) || asksForACount(text) || asksWhatTheyWorkOn(text) || FINISHED.test(normalise(text)) || peopleTopic(text) !== null;
}

/** "Who has the most open breaches?": a ranking of people by their open findings, the one count the people view ranks. */
const RANKING = /\b(who|whose|which (person|people|developers?|engineers?|team members?|assignees?|one))\b.*\b(most|highest|largest|biggest)\b/;
const FINDINGS = /\b(breach\w*|warn\w*|findings?)\b/;

export function asksForRanking(text: string): boolean {
  const words = normalise(text);
  return RANKING.test(words) && FINDINGS.test(words);
}

/** "What is @X working on?": their work in progress, not their findings. */
const WORKING = /\b(?:work(?:s|ing)? on|doing|in progress|busy with|picked up)\b/;

export function asksWhatTheyWorkOn(text: string): boolean {
  return WORKING.test(normalise(text));
}

/** The severity a question narrows to: breaches, warnings, or (both or neither named) every open finding. */
export function severityIn(text: string): "breach" | "warning" | null {
  const words = normalise(text);
  const breach = /\bbreach/.test(words);
  const warning = /\bwarn/.test(words);
  return breach === warning ? null : breach ? "breach" : "warning";
}

/** An issue key anywhere in the question, upper-cased: "what happened to demo-12" means DEMO-12. */
export function issueKeyIn(question: string): string | null {
  const match = /\b([A-Za-z][A-Za-z0-9_]{1,19})-(\d{1,9})\b/.exec(question);
  return match ? `${match[1].toUpperCase()}-${Number(match[2])}` : null;
}

function bigrams(text: string): Map<string, number> {
  const compact = ` ${text.replace(/'/g, "")} `;
  const pairs = new Map<string, number>();
  for (let index = 0; index < compact.length - 1; index += 1) {
    const pair = compact.slice(index, index + 2);
    pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
  }
  return pairs;
}

/** Sørensen–Dice over letter pairs: 1 for the same text, about 0.8 for a typo or two. */
function similarity(a: string, b: string): number {
  const left = bigrams(normalise(a));
  const right = bigrams(normalise(b));
  let shared = 0;
  let total = 0;
  for (const count of left.values()) total += count;
  for (const count of right.values()) total += count;
  for (const [pair, count] of left) shared += Math.min(count, right.get(pair) ?? 0);
  return total === 0 ? 0 : (2 * shared) / total;
}

export interface Matchable {
  id: string;
  /** The question as the suggestions write it. */
  question: string;
  /** Other ways people ask it. */
  phrasings: readonly string[];
  /** Any one set, all present, is a match; a longer set is a closer one. */
  concepts: readonly (readonly Concept[])[];
  /** Concepts that rule the script out: "reopened this week" is not "reopened". */
  unless?: readonly Concept[];
}

/** How close a question needs to be to a phrasing, letter pair by letter pair. */
const FUZZY_THRESHOLD = 0.72;

/** The best-matching script, or null when nothing is close enough to answer honestly. */
export function bestMatch<T extends Matchable>(question: string, scripts: readonly T[]): T | null {
  const text = normalise(question);
  if (!text) return null;
  const present = new Set((Object.keys(CONCEPTS) as Concept[]).filter((concept) => CONCEPTS[concept].test(text)));

  let best: { script: T; score: number } | null = null;
  for (const script of scripts) {
    if (script.unless?.some((concept) => present.has(concept))) continue;
    let score = 0;
    for (const set of script.concepts) {
      if (set.every((concept) => present.has(concept))) score = Math.max(score, set.length);
    }
    const closest = Math.max(...[script.question, ...script.phrasings].map((phrasing) => similarity(text, phrasing)));
    // A near-identical phrasing beats any concept count; a typo-ridden one still counts as one concept.
    if (closest >= 0.9) score = Math.max(score, 10);
    else if (closest >= FUZZY_THRESHOLD) score = Math.max(score, 1 + closest);
    if (score > 0 && (best === null || score > best.score)) best = { script, score };
  }
  return best?.script ?? null;
}
