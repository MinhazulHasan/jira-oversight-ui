"use client";

import { EyeOff } from "lucide-react";

import { Timestamp } from "@/components/ui/timestamp";
import type { Finding } from "@/lib/api/schemas";

/** An ignored finding's own note in the drawer: who set it aside, when, why, and what the ignore covers. */
export function IgnoredBanner({ finding }: { finding: Finding }) {
  const ignore = finding.ignore;
  if (finding.state !== "ignored") return null;
  const covers =
    ignore?.scope === "ticket"
      ? `Covers every rule on ${finding.issue_key}, so its other findings are ignored too.`
      : `Covers ${finding.rule_id} on ${finding.issue_key}, now and if it fires again.`;
  return (
    <aside className="flex overflow-hidden rounded-md border border-rule-weak bg-rail" data-ignored-banner="">
      <div className="flex min-w-0 flex-1 gap-3 px-4 py-3.5">
        <EyeOff aria-hidden size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-ink-low" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="micro text-ink-low">Ignored</p>
          <p className="text-sm font-medium text-ink">
            {ignore ? (
              <>
                Ignored{ignore.by ? ` by ${ignore.by}` : ""} on <Timestamp value={ignore.at} mode="date" />
              </>
            ) : (
              "Ignored by an admin"
            )}
          </p>
          <p className={ignore?.reason ? "max-w-[68ch] text-sm text-pretty text-ink-mid" : "text-sm text-ink-low"} data-ignore-reason="">
            {ignore?.reason ? `“${ignore.reason}”` : "No reason given."}
          </p>
          <p className="text-xs text-ink-low">{covers} It counts as neither open nor fixed.</p>
        </div>
      </div>
    </aside>
  );
}
