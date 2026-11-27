"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { getFindings } from "@/lib/api/client";
import { oversightKeys, useFindings } from "@/lib/api/hooks";
import { IGNORE_TARGET_MAX } from "@/lib/api/ignores";
import { FINDINGS_PAGE_SIZES } from "@/lib/api/params";
import { notify } from "@/lib/notify";
import type { Finding, IgnoreScope } from "@/lib/api/schemas";

import { FilterBar } from "./filter-bar";
import { FindingDrawer } from "./finding-drawer";
import { FindingsTable, type BulkActions } from "./findings-table";
import { IgnoreProvider, useIgnoreActions } from "./ignore-actions";
import { describeFilters } from "./model";
import { actionable, NO_SELECTION, SelectionProvider, type Selection, type SelectionState } from "./selection";
import {
  SEARCH_DEBOUNCE_MS,
  ignoreQueryOf,
  normaliseFindingId,
  toFindingsQuery,
  useFindingsUrl,
  useOpenFinding,
  useSettledValue,
} from "./url-state";

const NO_FINDINGS: Finding[] = [];

/** Where the focus waits when a dialog closes after its action took the control that opened it (the selection's bar). */
const resultLine = () => document.querySelector<HTMLElement>("[data-findings-result]");

export function FindingsView() {
  return (
    <IgnoreProvider fallbackFocus={resultLine}>
      <Findings />
    </IgnoreProvider>
  );
}

function Findings() {
  const [filters, setFilters] = useFindingsUrl();
  const queryClient = useQueryClient();
  const [urlId, setUrlId] = useOpenFinding();
  const { enabled, askIgnore, askRestore, askFinished } = useIgnoreActions();

  const settled = useSettledValue(filters.q, SEARCH_DEBOUNCE_MS);
  const search = filters.q.trim() === "" ? "" : settled;
  const query = toFindingsQuery(filters, search);
  const findings = useFindings(query);

  const data = findings.data;
  const items = data?.items ?? NO_FINDINGS;

  // A selection belongs to the list it was made in: another page, filter or sort starts afresh.
  const listKey = JSON.stringify(query);
  const [selection, setSelection] = useState<Selection>(NO_SELECTION);
  const [selectedFor, setSelectedFor] = useState(listKey);
  if (selectedFor !== listKey) {
    setSelectedFor(listKey);
    setSelection(NO_SELECTION);
  }
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const clear = () => setSelection(NO_SELECTION);
  const pageIds = () => new Set(items.filter(actionable).map((finding) => finding.finding_id));
  const picked = selection.kind === "rows" ? items.filter((finding) => selection.ids.has(finding.finding_id)) : items.filter(actionable);

  // Every ignored finding the filters match, read page by page: a restore names the ignores, not a filter.
  const restoreMatching = async () => {
    const all: Finding[] = [];
    try {
      for (let page = 1; all.length < Math.min(data?.total ?? 0, IGNORE_TARGET_MAX); page += 1) {
        const next = await queryClient.fetchQuery({
          queryKey: [...oversightKeys.findings(), "restore-all", { ...query, page }],
          queryFn: ({ signal }) => getFindings({ ...query, page, page_size: FINDINGS_PAGE_SIZES.max }, { signal }),
          staleTime: 0,
        });
        if (next.items.length === 0) break;
        all.push(...next.items.filter(actionable));
      }
    } catch {
      notify.warn("Couldn't restore", { description: "The matching findings could not be read. Try again." });
      return;
    }
    askRestore(all, { onDone: clear });
  };

  const ignoreRows = (rows: readonly Finding[], scope: IgnoreScope, onDone?: () => void) => {
    const open = rows.filter((finding) => finding.state === "open" && finding.issue_key !== null);
    if (open.length === 0) return;
    const keys = new Set(open.map((finding) => finding.issue_key));
    askIgnore(
      {
        target: { finding_ids: open.map((finding) => finding.finding_id) },
        scope,
        choose: true,
        ticket: keys.size === 1 ? open[0].issue_key : null,
        ruleId: open.length === 1 ? open[0].rule_id : null,
      },
      { onDone },
    );
  };

  const selectionState: SelectionState = {
    enabled,
    selection,
    rows: items,
    toggle: (finding) =>
      setSelection((current) => {
        const ids = new Set(current.kind === "rows" ? current.ids : pageIds());
        if (ids.has(finding.finding_id)) ids.delete(finding.finding_id);
        else ids.add(finding.finding_id);
        return { kind: "rows", ids };
      }),
    setPage: (on) => setSelection(on ? { kind: "rows", ids: pageIds() } : NO_SELECTION),
    menuFor,
    setMenuFor,
    actions: {
      ignore: (finding, scope) => ignoreRows([finding], scope),
      restore: (finding) => askRestore([finding]),
    },
  };

  const bulk: BulkActions | undefined = enabled
    ? {
        selection,
        onSelectMatching: () => setSelection({ kind: "matching" }),
        onClear: clear,
        onIgnore: () =>
          selection.kind === "matching"
            ? askIgnore(
                { target: { query: ignoreQueryOf(filters, search) }, scope: "finding", choose: true, ticket: null, ruleId: null },
                { onDone: clear },
              )
            : ignoreRows(picked, "finding", clear),
        onRestore: () => (selection.kind === "matching" ? void restoreMatching() : askRestore(picked, { onDone: clear })),
      }
    : undefined;

  const ignoreFinished = enabled ? askFinished : undefined;

  return (
    <SelectionProvider value={selectionState}>
      <FilterBar filters={filters} setFilters={setFilters} facets={data?.facets} />
      {data ? (
        <p hidden data-print="only" className="text-sm text-ink-mid">
          Showing {describeFilters(filters, data.meta.projects, data.facets)}.
        </p>
      ) : null}
      <FindingsTable
        findings={findings}
        filters={filters}
        setFilters={setFilters}
        openId={normaliseFindingId(urlId)}
        onOpen={(finding) => void setUrlId(finding.finding_id)}
        bulk={bulk}
        onIgnoreFinished={ignoreFinished}
      />
      <FindingDrawer
        urlId={urlId}
        items={items}
        dataMode={data?.meta.data_mode}
        lastSyncedAt={data?.meta.last_synced_at}
        onOpen={(id, history) => void setUrlId(id, { history })}
        onClose={() => void setUrlId(null)}
      />
    </SelectionProvider>
  );
}
