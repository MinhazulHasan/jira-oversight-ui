"use client";

import { Section } from "@/components/ui/section";
import { Timestamp } from "@/components/ui/timestamp";
import { useFigureLocale } from "@/components/ui/use-figures";
import type { Finding } from "@/lib/api/schemas";
import { formatCount, MISSING } from "@/lib/format";
import { cn } from "@/lib/utils";

import { changelogRows, type ChangelogRow } from "./evidence";

/** A status (or a value) kept whole on its line where it fits; one longer than the column wraps inside itself. */
const WHOLE = "inline-block max-w-full";

/** From and to: on a narrow drawer the line breaks after the arrow, never inside "In Progress". */
function Change({ row }: { row: ChangelogRow }) {
  if (row.from === null && row.to === null) return <>{row.value ?? MISSING}</>;
  return (
    <>
      {row.kind === "field_change" ? <span className="text-ink-low">{row.label}: </span> : null}
      <span className={WHOLE}>{row.from ?? "none"}</span>
      {"\u00a0"}
      <span className="text-ink-low">→</span> <span className={WHOLE}>{row.to ?? "none"}</span>
    </>
  );
}

/** When and what changed are read whole: in a drawer as narrow as a phone each wraps, in balanced lines, rather than cut. */
const WRAPS = "py-1.5 leading-snug [overflow-wrap:anywhere] text-balance whitespace-normal";

export function ChangelogTable({ finding }: { finding: Finding }) {
  const locale = useFigureLocale();
  const rows = changelogRows(finding.evidence);
  const subject = finding.issue_key ?? finding.sprint?.name ?? "the finding";

  return (
    <Section title="Changelog" count={formatCount(rows.length, { locale })} headingLevel={3}>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-low">
          {finding.scope === "sprint"
            ? "This rule reads sprint figures, not a changelog."
            : "This rule has no changelog entries."}
        </p>
      ) : (
        <div className="@container overflow-hidden rounded-md border border-rule-weak">
          <table className="jo-table" data-sticky="false" data-density="compact">
            <caption className="sr-only">Changelog entries the rule read on {subject}</caption>
            <colgroup>
              <col className="w-[44%] @max-[30rem]:w-[36%]" />
              <col />
              <col className="w-[7rem]" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">
                  <span className="micro text-ink-low">When</span>
                </th>
                <th scope="col">
                  <span className="micro text-ink-low">From → to</span>
                </th>
                <th scope="col" data-numeric="true">
                  <span className="micro text-ink-low">Changelog</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className={WRAPS}>{row.at ? <Timestamp value={row.at} mode="datetime" /> : MISSING}</td>
                  <td title={`${row.label}: ${row.from ?? "none"} → ${row.to ?? "none"}`} className={cn("text-ink", WRAPS)}>
                    <Change row={row} />
                  </td>
                  <td data-numeric="true" className="text-cite">
                    {row.changelogId}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
