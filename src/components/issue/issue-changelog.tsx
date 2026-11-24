"use client";

import { parseAsString, useQueryState } from "nuqs";
import { useMemo, useState } from "react";

import { SeverityMark } from "@/components/ui/badge";
import type { CsvColumn } from "@/components/ui/csv";
import { DataTable, dataTableColumns, type SortingState } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { ExportCsvButton } from "@/components/ui/export-csv-button";
import { Section } from "@/components/ui/section";
import { Timestamp } from "@/components/ui/timestamp";
import { useFigureLocale } from "@/components/ui/use-figures";
import { formatCount } from "@/lib/format";

import { ChangeDrawer, ChangeValue } from "./change-drawer";
import { citationsByChange, fieldLabel, type ChangeRow, type IssueData } from "./model";

/** The changelog entry open in the drawer lives in the URL (?change=310131), like the Findings page's drawer. */
export function useOpenChange() {
  return useQueryState("change", parseAsString.withOptions({ history: "push" }));
}

const col = dataTableColumns<ChangeRow>();

/** A changed value kept whole on its line where it fits; one longer than the column wraps inside itself. */
const WHOLE = "inline-block max-w-full [overflow-wrap:anywhere]";

const COLUMNS = col.columns([
  col.accessor("changed_at", {
    header: "When",
    cell: (info) => <Timestamp value={info.getValue()} mode="datetime" className="text-ink-mid" />,
    meta: { width: "12.5rem", cellClassName: "whitespace-normal py-1.5 leading-snug text-balance" },
  }),
  col.accessor("kind", {
    header: "Kind",
    cell: (info) => <span className="text-ink-low">{info.getValue() === "status" ? "Status" : "Field"}</span>,
    meta: { width: "5.5rem" },
  }),
  col.accessor((row) => fieldLabel(row.field), {
    id: "field",
    header: "Field",
    cell: (info) => <span className="text-ink-mid">{info.getValue()}</span>,
    meta: { width: "9rem" },
  }),
  col.accessor((row) => `${row.from ?? ""} → ${row.to ?? ""}`, {
    id: "change",
    header: "From → to",
    cell: (info) => (
      <span className="text-ink">
        <span className={WHOLE}>
          <ChangeValue value={info.row.original.from} />
        </span>
        {"\u00a0"}
        <span className="text-ink-low">→</span>{" "}
        <span className={WHOLE}>
          <ChangeValue value={info.row.original.to} />
        </span>
      </span>
    ),
    meta: { label: "From and to", cellClassName: "whitespace-normal py-1.5 leading-snug" },
  }),
  col.accessor((row) => row.cited.map((finding) => finding.rule_id).join(" ") || undefined, {
    id: "cited",
    header: "Cited by",
    cell: (info) => {
      const cited = info.row.original.cited;
      if (cited.length === 0) {
        return (
          <span className="text-ink-low">
            <span aria-hidden>—</span>
            <span className="sr-only">None</span>
          </span>
        );
      }
      return (
        <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
          {cited.map((finding) => (
            <span key={finding.finding_id} className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <SeverityMark severity={finding.state === "open" ? finding.severity : "resolved"} size={8} />
              <span className="mono text-xs text-ink-mid">{finding.rule_id}</span>
            </span>
          ))}
          <span className="sr-only">
            {cited.map((finding) => `${finding.rule_id}, ${finding.state === "open" ? finding.severity : "resolved"}`).join("; ")}
          </span>
        </span>
      );
    },
    meta: { width: "10rem", label: "Cited by findings", cellClassName: "whitespace-normal py-1.5" },
  }),
  // No column of Jira's own changelog ids (SQA): a number no reader looks up. The CSV keeps them for whoever does.
]);

const CSV_COLUMNS: CsvColumn<ChangeRow>[] = [
  { header: "When", value: (row) => row.changed_at },
  { header: "Kind", value: (row) => row.kind },
  { header: "Field", value: (row) => row.field },
  { header: "From", value: (row) => row.from },
  { header: "To", value: (row) => row.to },
  { header: "Changelog id", value: (row) => row.changelog_id },
  { header: "Cited by", value: (row) => row.cited.map((finding) => finding.rule_id).join(" ") },
];

const NO_ROWS: ChangeRow[] = [];

/** Every status and tracked-field change, oldest first, each with the findings that cite it. */
export function IssueChangelog({ data }: { data: IssueData | null }) {
  const locale = useFigureLocale();
  const [openId, setOpenId] = useOpenChange();
  const [sorting, setSorting] = useState<SortingState>([]);
  const key = data?.issue.key;

  const rows = useMemo<ChangeRow[]>(() => {
    if (!data) return NO_ROWS;
    const cited = citationsByChange(data.findings);
    return data.changes.map((change) => ({
      ...change,
      rowId: `${change.changelog_id}:${change.field}`,
      cited: cited.get(change.changelog_id) ?? [],
    }));
  }, [data]);
  const selected = rows.find((row) => row.changelog_id === openId)?.rowId ?? null;

  return (
    <Section title="Changelog" id="changelog" count={data ? formatCount(rows.length, { locale }) : undefined}>
      <DataTable
        caption={key ? `Changelog of ${key}` : "Changelog"}
        data={rows}
        columns={COLUMNS}
        getRowId={(row) => row.rowId}
        sorting={sorting}
        onSortingChange={setSorting}
        selectedRowId={selected}
        onRowOpen={(row) => void setOpenId(row.changelog_id)}
        loading={!data}
        loadingRows={6}
        minWidth="52rem"
        // On a phone the frame scrolls anyway: from and to get room to read rather than the least the table can take.
        scrollWidth="60rem"
        toolbar={
          data && rows.length > 0 ? (
            <>
              Status and tracked-field changes{sorting.length === 0 ? ", oldest first" : ""}; assignees read only{" "}
              <span className="text-ink-mid">Assigned</span> or <span className="text-ink-mid">Unassigned</span>
            </>
          ) : undefined
        }
        actions={({ rows: shown }) =>
          data ? (
            <ExportCsvButton rows={shown} columns={CSV_COLUMNS} fileName={`changelog-${key}`} rowNoun="change" size="sm" />
          ) : null
        }
        empty={
          <EmptyState
            size="compact"
            title={`No changes recorded on ${key ?? "this issue"}`}
            description="No changes since it was created."
          />
        }
      />
      {data ? <ChangeDrawer data={data} rows={rows} openId={openId} onOpenChange={(id) => void setOpenId(id)} /> : null}
    </Section>
  );
}
