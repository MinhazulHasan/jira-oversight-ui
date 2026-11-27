"use client";

import { useIsFetching } from "@tanstack/react-query";
import { parseAsNumberLiteral, useQueryState, useQueryStates } from "nuqs";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { oversightKeys, usePeopleProof } from "@/lib/api/hooks";
import { SCORECARD_DAYS, SCORECARD_DEFAULT_DAYS } from "@/lib/api/schemas";
import { cn } from "@/lib/utils";

import { BOARD, cellId, proofUrlParsers, type ProofTarget } from "./model";
import { ProofSheet } from "./proof-sheet";

export interface ProofApi {
  /** Opens the tickets behind a figure; `from` is the control focus goes back to when they close. */
  open: (target: ProofTarget, from: HTMLElement | null) => void;
}

const ProofContext = createContext<ProofApi | null>(null);

/** The proof's opener where the People page offers it; null elsewhere, where a figure stays plain text. */
export function useProof(): ProofApi | null {
  return useContext(ProofContext);
}

/** The first shown control that stands for a figure: the table's cell on a wide screen, the list's on a phone. */
function shownCell(target: ProofTarget): HTMLElement | null {
  const cells = document.querySelectorAll<HTMLElement>(`[data-proof-cell="${cellId(target)}"]`);
  return [...cells].find((cell) => cell.getClientRects().length > 0) ?? null;
}

/** The page's period, as the People page reads it from the address. */
const daysParser = parseAsNumberLiteral(SCORECARD_DAYS).withDefault(SCORECARD_DEFAULT_DAYS);

/** The People page's proof: every figure in it opens the tickets behind it, over the page's period. */
export function ProofProvider({ children }: { children: ReactNode }) {
  const [days] = useQueryState("days", daysParser);
  const [url, setUrl] = useQueryStates(proofUrlParsers, { history: "push", scroll: false });
  const opener = useRef<HTMLElement | null>(null);
  const target: ProofTarget | null = url.proof
    ? { measure: url.proof, person: url.proof_person !== null && url.proof_person !== BOARD ? url.proof_person : null }
    : null;

  const api = useMemo<ProofApi>(
    () => ({
      open: (next, from) => {
        opener.current = from;
        void setUrl({ proof: next.measure, proof_person: next.person ?? BOARD });
      },
    }),
    [setUrl],
  );
  // Its tickets are asked for as the page loads, not after it: the sheet below waits for the page, the request does not.
  usePeopleProof(target ? { days, measure: target.measure, person: target.person } : null);
  // A sheet opened from a link waits until the page's own figures are in, so the whole page is hidden behind it.
  const loading = useIsFetching({ queryKey: oversightKeys.people(), predicate: (query) => !query.queryKey.includes("proof") });
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (loading > 0) return;
    const frame = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(frame);
  }, [loading]);
  const close = useCallback(() => void setUrl({ proof: null, proof_person: null }), [setUrl]);
  // A proof key the page does not know opens nothing, so it leaves the address.
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search);
    if (url.proof === null && (raw.has("proof") || raw.has("proof_person"))) void setUrl({ proof: null, proof_person: null }, { history: "replace" });
  }, [url.proof, setUrl]);
  // Back to the figure that opened it; opened from a link, to the cell that shows the figure.
  const returnFocus = useCallback((closed: ProofTarget) => {
    const from = opener.current;
    opener.current = null;
    if (from?.isConnected) from.focus({ preventScroll: true });
    else shownCell(closed)?.focus();
  }, []);

  return (
    <ProofContext.Provider value={api}>
      {children}
      <ProofSheet target={settled ? target : null} days={days} onClose={close} onReturnFocus={returnFocus} />
    </ProofContext.Provider>
  );
}

/** The look of a figure that opens its tickets: a quiet ground on hover, the figure underlined, the kit's ring. */
const PROOF_BUTTON =
  "pressable -mx-1.5 -my-1 inline-flex max-w-[calc(100%+0.75rem)] min-w-0 cursor-pointer items-center rounded-[5px] px-1.5 py-1 text-right align-middle hover:bg-hover active:bg-pressed [&_[data-figure-value]]:decoration-cite-line [&_[data-figure-value]]:decoration-1 [&_[data-figure-value]]:underline-offset-[3px] hover:[&_[data-figure-value]]:underline focus-visible:[&_[data-figure-value]]:underline";

export interface ProofButtonProps {
  target: ProofTarget;
  /** What a screen reader hears: "Ada Brooks, Open tickets stuck in a status, 78%, 7 of 9: show tickets". */
  label: string;
  children: ReactNode;
  /** The table's column, for its arrow keys. */
  column?: number;
  tabIndex?: number;
  className?: string;
}

/** A figure as a button that opens the tickets behind it; plain text where no proof is offered. */
export function ProofButton({ target, label, children, column, tabIndex, className }: ProofButtonProps) {
  const proof = useProof();
  if (!proof) return <>{children}</>;
  return (
    <button
      type="button"
      aria-label={label}
      aria-haspopup="dialog"
      data-proof-cell={cellId(target)}
      data-proof-col={column}
      tabIndex={tabIndex}
      onClick={(event) => {
        // The figure's own press: the row around it (which chooses a person) never hears it.
        event.stopPropagation();
        proof.open(target, event.currentTarget);
      }}
      onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
        if (event.key === "Enter" || event.key === " ") event.stopPropagation();
      }}
      className={cn(PROOF_BUTTON, className)}
    >
      {children}
    </button>
  );
}
