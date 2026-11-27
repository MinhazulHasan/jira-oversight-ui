"use client";

import { parseAsArrayOf, parseAsString, useQueryStates } from "nuqs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AskAboutProvider } from "@/components/person-card/ask-about";
import { Skeleton } from "@/components/ui/skeleton";
import { useAsk, useHealth, usePeopleDirectory } from "@/lib/api/hooks";
import { ASK_MAX_MENTIONS, PERSON_ID_PATTERN, type AskLevel, type AskResponse, type Citation, type Person } from "@/lib/api/schemas";
import { notify } from "@/lib/notify";
import { useHydrated } from "@/lib/use-hydrated";

import { AnswerDocument, useAnswerTrace } from "./answer-document";
import { AnswerError, AnswerSkeleton, AskStart, errorSummary } from "./answer-states";
import { Connector } from "./connector";
import { readyDescription, sameQuestion } from "./describe";
import { forgetAll, freshAnswer, remember, useAskHistory, type HistoryEntry } from "./history";
import { HistoryRail } from "./history-rail";
import { Ledger, type LedgerState } from "./ledger";
import { AskPeopleProvider, peopleIndex } from "./people-in-facts";
import { QuestionBox, type MentionSource, type QuestionSeed, type SeedOutcome } from "./question-box";
import { TraceProvider } from "./trace";

const TOAST_ID = "ask-answer";
const NO_CITATIONS: readonly Citation[] = [];
const NO_ORDER: readonly number[] = [];
const NO_MENTIONS: readonly string[] = [];

const ADDRESS = {
  q: parseAsString.withDefault(""),
  m: parseAsArrayOf(parseAsString).withDefault([]),
  about: parseAsString,
};

function mentionIds(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id) => PERSON_ID_PATTERN.test(id)))].slice(0, ASK_MAX_MENTIONS);
}

const GRID = [
  "grid grid-cols-[minmax(0,1fr)] gap-x-7 gap-y-9",
  "[grid-template-areas:'ask'_'ledger'_'history']",
  "@3xl:grid-cols-[minmax(0,1fr)_minmax(19rem,23.5rem)] @3xl:grid-rows-[auto_1fr] @3xl:[grid-template-areas:'ask_ledger'_'history_ledger']",
  "@min-[66rem]:grid-cols-[10rem_minmax(0,1fr)_24.5rem] @min-[66rem]:grid-rows-1 @min-[66rem]:[grid-template-areas:'history_ask_ledger']",
  // On paper the answer comes first and its facts follow at full width.
  "print:grid-cols-[minmax(0,1fr)]! print:grid-rows-none! print:[grid-template-areas:'ask'_'ledger'_'history']!",
].join(" ");

export function AskView({ level = "team" }: { level?: AskLevel }) {
  const [address, setAddress] = useQueryStates(ADDRESS, { history: "replace", scroll: false });
  const q = address.q;
  const { mutate, isPending, isError, error, variables, data } = useAsk();
  const history = useAskHistory();
  const projects = useHealth().data?.projects;
  const hydrated = useHydrated();
  const peopleLevel = level === "people";
  const board = usePeopleDirectory({ enabled: peopleLevel });
  const [draft, setDraft] = useState<{ text: string; forQ: string } | null>(null);
  const handled = useRef<string | null>(null);
  const firstVisit = useRef(true);
  // The address before a question is sent, so a question the service's limit turns away can give the page back.
  const before = useRef(address);
  useEffect(() => {
    before.current = address;
  });
  /** A question turned away by the service's limit on questions: its words, said in the box that keeps it. */
  const [limited, setLimited] = useState<string | null>(null);

  const question = q.trim();
  // A team-level reader never sends a mention, whatever a link says.
  const asked = useMemo(() => (peopleLevel ? mentionIds(address.m) : NO_MENTIONS), [peopleLevel, address.m]);
  const shown = useMemo<AskResponse | null>(() => {
    if (!question) return null;
    const kept = history.find((entry) => sameQuestion(entry.response.question, question))?.response;
    if (kept) return kept;
    return data && variables !== undefined && sameQuestion(variables.question, question) ? data : null;
  }, [history, question, data, variables]);
  const trace = useAnswerTrace(shown);

  const send = useCallback(
    (raw: string, mentions: readonly string[] = NO_MENTIONS) => {
      const text = raw.trim();
      if (!text) return;
      const ids = peopleLevel ? mentionIds(mentions) : [];
      const previous = before.current;
      handled.current = text;
      setLimited(null);
      void setAddress({ q: text, m: ids.length > 0 ? ids : null });
      mutate(
        { question: text, mentions: ids },
        {
          onSuccess: (response) => {
            remember(response, Date.now(), ids);
            const say = response.outcome === "answered" ? notify.cite : notify.info;
            say("Answer ready", { id: TOAST_ID, description: readyDescription(response) });
          },
          onError: (failure) => {
            if (failure.code !== "ask_rate_limited") {
              notify.warn("Couldn't get an answer", { id: TOAST_ID, description: errorSummary(failure) });
              return;
            }
            setLimited(failure.message);
            notify.warn("Not asked yet", { id: TOAST_ID, description: failure.message });
            const shownBefore = previous.q.trim();
            if (!sameQuestion(shownBefore, text)) {
              handled.current = shownBefore || null;
              setDraft({ text, forQ: previous.q });
              void setAddress({ q: shownBefore || null, m: previous.m.length > 0 ? previous.m : null });
            }
          },
        },
      );
    },
    [mutate, setAddress, peopleLevel],
  );

  useEffect(() => {
    const first = firstVisit.current;
    firstVisit.current = false;
    const text = q.trim();
    if (!text || text === handled.current) return;
    handled.current = text;
    if (first && freshAnswer(text)) return;
    send(text, asked);
  }, [q, asked, send]);

  const failed = !isPending && isError && variables !== undefined && sameQuestion(variables.question, question) ? error : null;
  // A question the service's limit turned away is said in the box, never as a failed answer (nothing was asked).
  const turnedAway = failed?.code === "ask_rate_limited";
  const failure = turnedAway ? null : failed;
  // With a question in the URL and nothing yet to show, the answer is on its way: never flash the empty page.
  const phase = isPending ? "loading" : failure ? "failed" : shown ? "answer" : question && !turnedAway ? "loading" : "start";
  const ledger: LedgerState =
    phase === "answer" && shown
      ? { kind: "response", response: shown }
      : phase === "loading"
        ? { kind: "loading" }
        : phase === "failed"
          ? { kind: "failed" }
          : { kind: "idle" };

  const select = (entry: HistoryEntry) => {
    handled.current = entry.response.question.trim();
    setDraft(null);
    const ids = peopleLevel ? mentionIds(entry.mentions) : [];
    void setAddress({ q: entry.response.question, m: ids.length > 0 ? ids : null });
  };

  const clear = () => {
    forgetAll();
    handled.current = null;
    setDraft(null);
    void setAddress({ q: null, m: null });
    notify.info("Session cleared", { description: "This tab's questions and answers are forgotten." });
  };

  const about = peopleLevel && address.about && PERSON_ID_PATTERN.test(address.about) ? address.about : null;
  const fromAddress = useMemo<QuestionSeed | null>(() => (about ? { id: about } : null), [about]);
  const [askedHere, setAskedHere] = useState<QuestionSeed | null>(null);
  const askAboutHere = useCallback((person: Person) => setAskedHere({ id: person.id }), []);
  const aboutInAddress = useRef(address.about);
  useEffect(() => {
    aboutInAddress.current = address.about;
  });
  const seeded = useCallback(
    (person: Person | null, outcome: SeedOutcome) => {
      setAskedHere(null);
      if (aboutInAddress.current !== null) void setAddress({ about: null });
      if (!person) {
        notify.info("Not on this board", { description: "That person is not on this board." });
      } else if (outcome === "added") {
        notify.info("Person mentioned", { description: `${person.name} is in the question. Press Enter to ask.` });
      } else if (outcome === "already") {
        notify.info("Already in the question", { description: `${person.name} is already mentioned.` });
      }
      // No room for the name: the box has said so.
    },
    [setAddress],
  );

  // The @ list's people: everyone on the board, with the tickets that count for them.
  const directory = board.data?.people;
  // People in the facts and the plan by name and picture, never by id: the board's people, the answer's, the rows'.
  const known = useMemo(() => peopleIndex(shown, directory), [shown, directory]);
  const resolve = useCallback((id: string) => known.get(id) ?? null, [known]);
  const mention: MentionSource | undefined = peopleLevel
    ? {
        people: directory,
        // Trying again after a failure shows the loading rows (and says so), so the retry is seen and heard.
        state: board.isError && !board.isFetching ? "error" : directory ? "success" : "pending",
        retry: () => void board.refetch(),
        ids: asked,
      }
    : undefined;

  const where = hydrated && projects && projects.length > 0 ? projects.join(", ") : "Jira";

  return (
    <AskAboutProvider onAskAbout={askAboutHere}>
    <AskPeopleProvider resolve={resolve}>
    <TraceProvider
      answerId={phase === "answer" ? (shown?.qa_id ?? null) : null}
      citations={phase === "answer" ? (shown?.citations ?? NO_CITATIONS) : NO_CITATIONS}
      order={phase === "answer" ? trace.order : NO_ORDER}
    >
      <div data-ask-root className="@container">
        <div className={GRID}>
          <div className="@container flex min-w-0 flex-col gap-8 [grid-area:ask]">
            <QuestionBox
              value={draft && draft.forQ === q ? draft.text : shown || phase === "loading" ? "" : q}
              onChange={(text) => setDraft({ text, forQ: q })}
              onSubmit={send}
              busy={isPending}
              placeholder={shown || phase === "loading" ? "Ask another question" : `Ask about the work in ${where}, in plain English`}
              // The up arrow brings back the question on screen, the one being asked included.
              recall={shown?.question ?? (phase === "loading" ? question || undefined : undefined)}
              mention={mention}
              notice={limited}
              seed={askedHere ?? fromAddress}
              onSeeded={seeded}
            />
            {phase === "loading" ? <AnswerSkeleton question={(isPending ? variables?.question : undefined) ?? question} /> : null}
            {phase === "failed" && failure ? (
              <AnswerError question={question} error={failure} onRetry={() => send(question, asked)} retrying={isPending} />
            ) : null}
            {phase === "answer" && shown ? (
              <AnswerDocument
                key={shown.qa_id}
                response={shown}
                segments={trace.segments}
                describe={trace.describe}
                onAsk={(next) => send(next)}
                onAskAgain={() => send(shown.question, asked)}
                busy={isPending}
              />
            ) : null}
            {phase === "start" ? <AskStart onAsk={(next) => send(next)} busy={isPending} level={level} /> : null}
          </div>
          <Ledger state={ledger} className="[grid-area:ledger]" />
          <HistoryRail
            entries={history}
            currentId={phase === "answer" ? (shown?.qa_id ?? null) : null}
            onSelect={select}
            onClear={clear}
            className="[grid-area:history] @min-[66rem]:sticky @min-[66rem]:top-[calc(var(--topbar-h)+1rem)] @min-[66rem]:self-start"
          />
        </div>
      </div>
      <Connector />
    </TraceProvider>
    </AskPeopleProvider>
    </AskAboutProvider>
  );
}

/** While the page's URL state is read: the question box and the empty ledger, in their final places. */
export function AskViewFallback() {
  return (
    <div aria-hidden className="@container">
      <div className="grid gap-7 @min-[66rem]:grid-cols-[10rem_minmax(0,1fr)_24.5rem]">
        <Skeleton className="hidden h-3 w-24 @min-[66rem]:block" still />
        <div className="raised h-[5.75rem]" />
        <div className="hidden h-[22rem] rounded-lg border border-rule-weak bg-rail @min-[66rem]:block" />
      </div>
    </div>
  );
}
