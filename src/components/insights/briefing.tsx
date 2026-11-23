"use client";

import { CalendarCheck } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import type { Insights } from "@/lib/api/schemas";

import { bindSentence, traceFocus } from "./bind";
import { CandidateList } from "./candidates";
import { BRIEFING_AREAS, BRIEFING_GRID } from "./layout";
import { Masthead, NotVerifiedNotice } from "./masthead";
import { candidatesOf } from "./model";
import { Narrative } from "./narrative";
import { focusRow, useRowNavigation, useTrace } from "./use-trace";

/**
 * The weekly briefing as an editorial sheet: the masthead, the narrative
 * sentence by sentence, and the ranked problems it was written from. Every
 * sentence leads to its problems and findings.
 */
export function Briefing({ insights }: { insights: Insights }) {
  const root = useRef<HTMLDivElement>(null);
  const trace = useTrace(root);
  useRowNavigation(root);

  const { sentences, candidates } = insights;
  const bound = useMemo(
    () =>
      new Map(
        sentences.map((sentence) => [
          sentence.id,
          bindSentence(sentence.text, candidatesOf(sentence, candidates), sentence.issue_keys),
        ]),
      ),
    [sentences, candidates],
  );
  const focus = useMemo(() => traceFocus(trace, sentences, bound), [trace, sentences, bound]);

  // A link to one candidate (#candidate-…) arrives before the briefing does: land on it once it is drawn.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id.startsWith("candidate-")) return;
    const row = document.getElementById(id);
    if (row) {
      row.scrollIntoView({ block: "start" });
      focusRow(row);
    }
  }, []);

  const quiet = sentences.length === 0 && candidates.length === 0;

  return (
    <div ref={root} data-briefing className="flex flex-col gap-8">
      <Masthead insights={insights} />
      {insights.verified ? null : <NotVerifiedNotice />}
      {quiet ? (
        <EmptyState
          icon={CalendarCheck}
          title="Nothing stood out this week"
        />
      ) : (
        <div className={BRIEFING_GRID}>
          <Narrative
            className={BRIEFING_AREAS.narrative}
            sentences={sentences}
            candidates={candidates}
            bound={bound}
            focus={focus}
            verified={insights.verified}
          />
          <CandidateList className={BRIEFING_AREAS.candidates} candidates={candidates} focus={focus} />
        </div>
      )}
    </div>
  );
}
