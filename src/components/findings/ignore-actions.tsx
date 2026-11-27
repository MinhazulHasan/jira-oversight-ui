"use client";

import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

import { usePeopleLevel } from "@/components/shell/people-level";
import { useFigureLocale } from "@/components/ui/use-figures";
import { getIgnored } from "@/lib/api/client";
import { ignoreKeys, useIgnoreFindings, useRestoreIgnores } from "@/lib/api/ignore-hooks";
import type { IgnorePreview, IgnoreRequest, IgnoreResult } from "@/lib/api/ignores";
import { normalizeIgnoredQuery } from "@/lib/api/params";
import type { Finding } from "@/lib/api/schemas";
import { formatCount } from "@/lib/format";
import { notify } from "@/lib/notify";

import { FinishedIgnoreDialog } from "./finished-ignore-dialog";
import { IgnoreDialog, type IgnoreAsk } from "./ignore-dialog";
import { RestoreDialog } from "./restore-dialog";

/** One toast for ignoring and restoring, replaced as they follow each other rather than stacked. */
const IGNORE_TOAST = "findings-ignore";

export interface IgnoreActions {
  /** Whether this reader may ignore and restore: an admin, or anyone with sign-in off. */
  enabled: boolean;
  /** Opens the ignore dialog; `onDone` runs once the ignore went through (a page clears its selection). */
  askIgnore: (ask: IgnoreAsk, options?: { onDone?: () => void }) => void;
  /** Restores the ignores holding these findings: one at once, several after saying what comes back. */
  askRestore: (findings: readonly Finding[], options?: { onDone?: () => void }) => void;
  /** Opens the list of rules ignored on finished tickets, to tick or untick. */
  askFinished: () => void;
  busy: boolean;
}

const NONE: IgnoreActions = { enabled: false, askIgnore: () => undefined, askRestore: () => undefined, askFinished: () => undefined, busy: false };
const IgnoreContext = createContext<IgnoreActions>(NONE);

export function useIgnoreActions(): IgnoreActions {
  return useContext(IgnoreContext);
}

const findingsWord = (count: number) => (count === 1 ? "finding" : "findings");

/** The ignore holding each finding: its id where the API gave it, else looked up among the ticket's ignores. */
export async function ignoreIdsOf(queryClient: QueryClient, findings: readonly Finding[]): Promise<string[]> {
  const ids = new Set<string>();
  const unnamed = new Map<string, Finding[]>();
  for (const finding of findings) {
    if (finding.state !== "ignored" || !finding.ignore || finding.issue_key === null) continue;
    if (finding.ignore.ignore_id) ids.add(finding.ignore.ignore_id);
    else unnamed.set(finding.issue_key, [...(unnamed.get(finding.issue_key) ?? []), finding]);
  }
  for (const [key, list] of unnamed) {
    // A ticket holds at most one ignore of its own and one for each rule: one page has them all.
    const query = normalizeIgnoredQuery({ q: key, page_size: 100 });
    const page = await queryClient.fetchQuery({ queryKey: ignoreKeys.ignored(query), queryFn: ({ signal }) => getIgnored(query, { signal }), staleTime: 0 });
    for (const finding of list) {
      const holding = page.items.find((item) => item.issue_key === key && item.rule_id === finding.ignore!.rule_id);
      if (holding) ids.add(holding.ignore_id);
    }
  }
  return [...ids];
}

export interface IgnoreProviderProps {
  children: ReactNode;
  /** What takes the focus when a dialog closes and the control that opened it is gone (the selection's bar). */
  fallbackFocus?: () => HTMLElement | null | undefined;
}

/** Ignoring and restoring for everything inside: the dialogs, the toasts with Undo, and the figures read again. */
export function IgnoreProvider({ children, fallbackFocus }: IgnoreProviderProps) {
  const enabled = usePeopleLevel();
  const locale = useFigureLocale();
  const queryClient = useQueryClient();
  const ignore = useIgnoreFindings();
  const { mutate: restoreMutate, mutateAsync: restoreAsync, isPending: restorePending } = useRestoreIgnores();
  const [finishedOpen, setFinishedOpen] = useState(false);
  const [finishedSession, setFinishedSession] = useState(0);
  const [ask, setAsk] = useState<IgnoreAsk | null>(null);
  const [session, setSession] = useState(0);
  const [ignoreOpen, setIgnoreOpen] = useState(false);
  const [restoring, setRestoring] = useState<readonly Finding[] | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const done = useRef<(() => void) | undefined>(undefined);

  const count = useCallback((value: number) => formatCount(value, { locale }), [locale]);

  const undo = useCallback(
    (ids: readonly string[]) => {
      restoreMutate(ids, {
        onSuccess: () => notify.ok("Undone", { id: IGNORE_TOAST, description: "Those findings count as open again where the rules still hold them." }),
        onError: (error) => notify.warn("Couldn't undo", { id: IGNORE_TOAST, description: `${error.message} The findings stay ignored.` }),
      });
    },
    [restoreMutate],
  );

  const askIgnore = useCallback((next: IgnoreAsk, options: { onDone?: () => void } = {}) => {
    done.current = options.onDone;
    setAsk(next);
    setFailure(null);
    setSession((value) => value + 1);
    setIgnoreOpen(true);
  }, []);

  const onIgnore = (body: IgnoreRequest, preview: IgnorePreview) => {
    setFailure(null);
    ignore.mutate(body, {
      onSuccess: (result: IgnoreResult) => {
        setIgnoreOpen(false);
        done.current?.();
        const findings = result.ignored.findings;
        const tickets = result.ignored.tickets;
        notify.ok(`Ignored ${count(findings)} ${findingsWord(findings)}`, {
          id: IGNORE_TOAST,
          description:
            findings === preview.findings
              ? `On ${count(tickets)} ${tickets === 1 ? "ticket" : "tickets"}. State: Ignored lists them.`
              : `The board changed since the preview. State: Ignored lists them.`,
          ...(result.ignore_ids.length > 0 ? { action: { label: "Undo", onClick: () => undo(result.ignore_ids) } } : {}),
        });
      },
      onError: (error) => setFailure(error.message),
    });
  };

  const runRestore = useCallback(
    async (findings: readonly Finding[], onSettled: () => void, reopened: number = findings.length) => {
      let ids: string[];
      try {
        ids = await ignoreIdsOf(queryClient, findings);
      } catch {
        ids = [];
      }
      if (ids.length === 0) {
        notify.warn("Couldn't restore", { id: IGNORE_TOAST, description: "Their ignores could not be found. Reload and try again." });
        onSettled();
        return;
      }
      const single = findings.length === 1 ? findings[0] : null;
      restoreMutate(ids, {
        onSuccess: () => {
          onSettled();
          done.current?.();
          notify.ok(single ? "Restored" : `Restored ${count(reopened)} ${findingsWord(reopened)}`, {
            id: IGNORE_TOAST,
            description: single
              ? `${single.issue_key} counts again where the rules still hold it.`
              : findings.some((finding) => finding.ignore?.scope === "ticket")
                ? "Others ignored with them on the same tickets came back too. They count again where the rules still hold them."
                : "They count again where the rules still hold them.",
          });
        },
        onError: (error) => {
          if (single) {
            onSettled();
            notify.warn("Couldn't restore", { id: IGNORE_TOAST, description: `${error.message} It stays ignored.` });
          } else setFailure(error.message);
        },
      });
    },
    [count, queryClient, restoreMutate],
  );

  const askRestore = useCallback(
    (findings: readonly Finding[], options: { onDone?: () => void } = {}) => {
      const ignored = findings.filter((finding) => finding.state === "ignored");
      if (ignored.length === 0) return;
      done.current = options.onDone;
      setFailure(null);
      if (ignored.length === 1) {
        void runRestore(ignored, () => undefined);
        return;
      }
      setRestoring(ignored);
      setRestoreOpen(true);
    },
    [runRestore],
  );

  const askFinished = useCallback(() => {
    setFinishedSession((value) => value + 1);
    setFinishedOpen(true);
  }, []);

  const value = useMemo<IgnoreActions>(
    () => (enabled ? { enabled, askIgnore, askRestore, askFinished, busy: ignore.isPending || restorePending } : NONE),
    [enabled, askIgnore, askRestore, askFinished, ignore.isPending, restorePending],
  );

  return (
    <IgnoreContext.Provider value={value}>
      {children}
      {enabled ? (
        <>
          <IgnoreDialog
            key={session}
            ask={ask}
            open={ignoreOpen}
            onOpenChange={setIgnoreOpen}
            saving={ignore.isPending}
            failure={failure}
            onIgnore={onIgnore}
            fallbackFocus={fallbackFocus}
          />
          <FinishedIgnoreDialog
            key={`finished-${finishedSession}`}
            open={finishedOpen}
            onOpenChange={setFinishedOpen}
            ignore={async (body) => (await ignore.mutateAsync(body)).ignored}
            restore={async (ids) => void (await restoreAsync(ids))}
            onSaved={(ignored, restored) =>
              notify.ok("Saved", {
                id: IGNORE_TOAST,
                description: [
                  ignored > 0 ? `${count(ignored)} ${findingsWord(ignored)} ignored` : null,
                  restored > 0 ? `${count(restored)} counting again` : null,
                ]
                  .filter(Boolean)
                  .join(", ")
                  .concat("."),
              })
            }
            fallbackFocus={fallbackFocus}
          />
          <RestoreDialog
            findings={restoring}
            open={restoreOpen}
            onOpenChange={setRestoreOpen}
            restoring={restorePending}
            failure={failure}
            onRestore={(reopened) => {
              if (restoring) void runRestore(restoring, () => setRestoreOpen(false), reopened);
            }}
            fallbackFocus={fallbackFocus}
          />
        </>
      ) : null}
    </IgnoreContext.Provider>
  );
}
