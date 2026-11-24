"use client";

import { BarList, barListTable, type BarListItem } from "@/components/charts/bar-list";
import { ChartFrame } from "@/components/charts/chart-frame";
import { Section } from "@/components/ui/section";
import { StatTile, StatTileGrid } from "@/components/ui/stat-tile";
import { useFigureLocale } from "@/components/ui/use-figures";
import type { Baseline } from "@/lib/api/schemas";
import { formatCount } from "@/lib/format";

import { ranked, statusCategoryName, windowDays } from "./labels";

/* A tile in a wrapper that names it, filling the wrapper as the grid's own child would. */
const TILE = "flex *:flex-1";

const ROW = 32;

function shareSentence(items: readonly BarListItem[], noun: string, total: number, locale?: string): string {
  const top = items[0];
  if (!top) return `No ${noun}.`;
  return `${top.label} leads with ${formatCount(top.value, { locale })} of ${formatCount(total, { locale })} issues; ${items.length === 1 ? "the only one" : `${formatCount(items.length, { locale })} ${noun} in all`}.`;
}

function Breakdown({
  title,
  description,
  category,
  noun,
  items,
  total,
  loading,
}: {
  title: string;
  description: string;
  category: string;
  noun: string;
  items: readonly BarListItem[];
  total: number;
  loading: boolean;
}) {
  const locale = useFigureLocale();
  return (
    <ChartFrame
      title={title}
      description={description}
      summary={loading ? `Loading ${title.toLowerCase()}.` : shareSentence(items, noun, total, locale)}
      state={loading ? "loading" : items.length === 0 ? "empty" : "ready"}
      loadingShape="bars"
      emptyTitle="No issues in the snapshot"
      emptyDescription={"No issues."}
      table={items.length > 0 ? barListTable(items, { category, value: "Issues", total, locale }) : undefined}
      height={loading ? 4 * ROW : Math.max(2, items.length) * ROW}
    >
      <BarList items={items} title={title} valueNoun="issues" total={total} layout="inline" />
    </ChartFrame>
  );
}

/** The project as the sync found it: how many issues, of what type, in which status category. */
export function SnapshotBlock({ data }: { data: Baseline | undefined }) {
  const locale = useFigureLocale();
  const snapshot = data?.figures.snapshot;
  const total = snapshot?.total_issues ?? 0;
  const byType: BarListItem[] = snapshot ? ranked(snapshot.by_type).map(([type, count]) => ({ id: type, label: type, value: count })) : [];
  const byCategory: BarListItem[] = snapshot
    ? ranked(snapshot.by_status_category).map(([key, count]) => ({ id: key, label: statusCategoryName(key), value: count }))
    : [];
  const closedOn = data ? windowDays(data.metadata, locale).last : null;

  return (
    <Section
      id="snapshot"
      title="Snapshot"
      description={data ? `Every issue in ${data.metadata.project} at the last sync, Epics included.` : "Every issue at the last sync, Epics included."}
    >
      <div className="flex flex-col gap-6">
        <StatTileGrid columns={2} label="Snapshot totals" labelLines="auto">
          <div id="fig-total-issues" className={TILE}>
            <StatTile
              label="Issues"
              value={snapshot ? snapshot.total_issues : null}
              state={snapshot ? "ready" : "loading"}
              footnote="Every type, as of the sync"
            />
          </div>
          <div id="fig-created-before-end" className={TILE}>
            <StatTile
              label="Created before the window closed"
              value={snapshot ? snapshot.created_before_window_end : null}
              state={snapshot ? "ready" : "loading"}
              footnote={closedOn ? `Created by the end of ${closedOn}` : undefined}
            />
          </div>
        </StatTileGrid>

        <Breakdown
          title="By type"
          description="Issues of each type"
          category="Type"
          noun="types"
          items={byType}
          total={total}
          loading={!snapshot}
        />
        <Breakdown
          title="By status category"
          description="Where every issue sits now"
          category="Status category"
          noun="categories"
          items={byCategory}
          total={total}
          loading={!snapshot}
        />
      </div>
    </Section>
  );
}
