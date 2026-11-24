"use client";

import { requestBoardPicker } from "@/components/shell/board-switcher";
import { useFigureLocale } from "@/components/ui/use-figures";
import { formatCount } from "@/lib/format";

/** The Portfolio's line about the boards not synced yet. */
export function NotSyncedLine({ count, synced }: { count: number | undefined; synced: number }) {
  const locale = useFigureLocale();
  if (!count) return null;
  const boards = count === 1 ? "board" : "boards";
  const verb = count === 1 ? "isn’t" : "aren’t";

  return (
    <p className="text-sm text-ink-mid" data-portfolio-not-synced="">
      <span className="mono text-ink">{formatCount(count, { locale })}</span> {synced > 0 ? `more ${boards}` : boards} in Jira {verb} synced
      yet.{" "}
      <button
        type="button"
        onClick={requestBoardPicker}
        className="pressable rounded-[4px] font-medium text-ink underline decoration-rule-strong underline-offset-[3px] hover:decoration-ink"
      >
        Choose a board
      </button>
    </p>
  );
}
