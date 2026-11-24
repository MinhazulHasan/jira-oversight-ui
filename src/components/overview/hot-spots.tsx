"use client";

import { ChartFrame } from "@/components/charts/chart-frame";
import type { ChartTableData } from "@/components/charts/chart-table";
import { Legend } from "@/components/charts/legend";
import { StackedBarList, stackedBarTable, type StackedBarItem } from "@/components/charts/stacked-bar-list";
import { Section } from "@/components/ui/section";
import { useFigureLocale } from "@/components/ui/use-figures";
import type { HotSpot, Overview } from "@/lib/api/schemas";
import { formatCount, formatDelta, formatShare, MISSING } from "@/lib/format";

import { counted } from "./copy";
import { hotSpotHref, OPEN_FINDINGS_HREF } from "./links";
import { SectionLink } from "./section-link";

/** A row with its name over its bar is about 51 px; the contract sends at most five. */
const ROW_HEIGHT = 51;
const MAX_SPOTS = 5;

const LEGEND = [
  { id: "breach", label: "Breaches", severity: "breach" as const },
  { id: "warning", label: "Warnings", severity: "warning" as const },
];

export function hotSpotItems(spots: readonly HotSpot[]): StackedBarItem[] {
  return spots.map((spot) => ({
    id: spot.epic_key ?? "none",
    label: spot.epic_title,
    meta: spot.epic_key ?? undefined,
    values: { breach: spot.open_breaches, warning: spot.open_warnings },
    href: hotSpotHref(spot),
  }));
}

/** Open findings now against the end of last week, from the weekly series. */
function weekChange(spot: HotSpot): number | null {
  const last = spot.series.at(-1)?.value;
  const before = spot.series.at(-2)?.value;
  return typeof last === "number" && typeof before === "number" ? last - before : null;
}

function hotSpotTable(spots: readonly HotSpot[], locale: string | undefined): ChartTableData {
  const base = stackedBarTable(hotSpotItems(spots), { category: "Epic", locale });
  return {
    columns: [...base.columns, { header: "Issues", numeric: true }, { header: "Change vs last week", numeric: true }],
    rows: base.rows.map((row, index) => {
      const change = weekChange(spots[index]);
      return [...row, formatCount(spots[index].issues, { locale }), change === null ? MISSING : formatDelta(change, { locale })];
    }),
  };
}

function epicName(spot: HotSpot): string {
  return spot.epic_key ? `${spot.epic_key} ${spot.epic_title}` : "Work outside every epic";
}

function summarise(spots: readonly HotSpot[], locale: string | undefined): string {
  const lead = spots[0];
  return `${epicName(lead)} has the most open findings: ${counted(lead.open_breaches, "breach", "breaches", locale)} and ${counted(lead.open_warnings, "warning", "warnings", locale)}, in ${counted(lead.issues, "issue", "issues", locale)}.`;
}

/** How much of everything open sits in the epics shown. */
function concentration(data: Overview, locale: string | undefined): string | null {
  const open = data.totals.open_breaches.current + data.totals.open_warnings.current;
  const held = data.hot_spots.reduce((sum, spot) => sum + spot.open_breaches + spot.open_warnings, 0);
  if (open === 0 || held === 0) return null;
  const lead = data.hot_spots.length === 1 ? "It holds" : "Together they hold";
  return `${lead} ${formatShare(held / open, { locale })} of the ${formatCount(open, { locale })} open findings.`;
}

export function HotSpots({ data, className }: { data?: Overview; className?: string }) {
  const locale = useFigureLocale();
  const spots = data?.hot_spots ?? [];
  const projects = data?.meta.projects.join(", ") ?? "";
  const state = !data ? "loading" : spots.length === 0 ? "empty" : "ready";

  return (
    <Section id="hot-spots" title="Hot spots" actions={<SectionLink href={OPEN_FINDINGS_HREF}>All open findings</SectionLink>} className={className}>
      <ChartFrame
        title="Open findings by epic"
        description={
          spots.length === MAX_SPOTS || state === "loading"
            ? "Top five, most breaches first"
            : "Most breaches first"
        }
        summary={state === "ready" ? summarise(spots, locale) : state === "empty" ? `No open findings in ${projects}.` : "Loading the hot spots."}
        legend={<Legend items={LEGEND} />}
        table={state === "ready" ? hotSpotTable(spots, locale) : undefined}
        state={state}
        loadingShape="bars"
        height={ROW_HEIGHT * (state === "ready" ? spots.length : MAX_SPOTS)}
        emptyTitle="No open findings in any epic"
        footnote={data && state === "ready" ? concentration(data, locale) : undefined}
      >
        <StackedBarList items={hotSpotItems(spots)} title="Open findings by epic" layout="stacked" />
      </ChartFrame>
    </Section>
  );
}
