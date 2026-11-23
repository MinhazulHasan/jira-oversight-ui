"use client";

import { useFindings } from "@/lib/api/hooks";
import type { Finding } from "@/lib/api/schemas";

import { FilterBar } from "./filter-bar";
import { FindingDrawer } from "./finding-drawer";
import { FindingsTable } from "./findings-table";
import { describeFilters } from "./model";
import {
  SEARCH_DEBOUNCE_MS,
  normaliseFindingId,
  toFindingsQuery,
  useFindingsUrl,
  useOpenFinding,
  useSettledValue,
} from "./url-state";

const NO_FINDINGS: Finding[] = [];

/**
 * The Findings page's working area: the filter row, the result line, the
 * table and the evidence drawer, all read from and written to the URL, so a
 * link (or the browser's Back) reopens exactly this view.
 */
export function FindingsView() {
  const [filters, setFilters] = useFindingsUrl();
  const [urlId, setUrlId] = useOpenFinding();

  // The field answers every key; the list is asked again once typing settles.
  // Emptying the field is a decision, not typing, so it applies at once.
  const settled = useSettledValue(filters.q, SEARCH_DEBOUNCE_MS);
  const search = filters.q.trim() === "" ? "" : settled;
  const findings = useFindings(toFindingsQuery(filters, search));

  const data = findings.data;
  const items = data?.items ?? NO_FINDINGS;

  return (
    <>
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
      />
      <FindingDrawer
        urlId={urlId}
        items={items}
        dataMode={data?.meta.data_mode}
        lastSyncedAt={data?.meta.last_synced_at}
        onOpen={(id, history) => void setUrlId(id, { history })}
        onClose={() => void setUrlId(null)}
      />
    </>
  );
}
