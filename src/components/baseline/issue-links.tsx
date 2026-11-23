"use client";

import { BarList, barListTable, type BarListItem } from "@/components/charts/bar-list";
import { ChartFrame } from "@/components/charts/chart-frame";
import { KeyValueList, type KeyValueItem } from "@/components/ui/key-value";
import { Section } from "@/components/ui/section";
import { useFigureLocale } from "@/components/ui/use-figures";
import type { Baseline } from "@/lib/api/schemas";
import { formatCount } from "@/lib/format";

import { ranked } from "./labels";

const ROW = 32;

type IssueLinks = Baseline["figures"]["issue_links"];

function linkFacts(links: IssueLinks, locale?: string): KeyValueItem[] {
  const hosts = ranked(links.remote_links_by_host);
  return [
    { id: "issues", label: "Issues with links", value: formatCount(links.issues_with_issue_links, { locale }), mono: true },
    { id: "links", label: "Links between issues", value: formatCount(links.issue_links, { locale }), mono: true },
    { id: "remote", label: "Links to other systems", value: formatCount(links.remote_links, { locale }), mono: true },
    ...hosts.map(([host, count]) => ({
      id: `host-${host}`,
      label: <span className="pl-3">{host}</span>,
      value: formatCount(count, { locale }),
      mono: true,
    })),
  ];
}

/** How issues point at each other in Jira, by link type, and whether anything links out to other systems. */
export function IssueLinksBlock({ data }: { data: Baseline | undefined }) {
  const locale = useFigureLocale();
  const links = data?.figures.issue_links;
  const items: BarListItem[] = links
    ? ranked(links.issue_links_by_title).map(([title, count]) => ({ id: title, label: title, value: count }))
    : [];
  const state = !links ? "loading" : items.length === 0 ? "empty" : "ready";
  const top = items[0];

  return (
    <Section
      id="issue-links"
      title="Issue links"
      count={links ? formatCount(links.issue_links, { locale }) : undefined}
      description={
        links
          ? `${formatCount(links.issues_with_issue_links, { locale })} issues carry ${formatCount(links.issue_links, { locale })} links.`
          : "Links between issues."
      }
    >
      <div className="flex flex-col gap-5">
        <ChartFrame
          title="Links by type"
          description="Issue links, largest first"
          summary={
            top && links
              ? `${top.label} is the most common link, ${formatCount(top.value, { locale })} of ${formatCount(links.issue_links, { locale })}.`
              : "No issue links to show."
          }
          table={items.length > 0 ? barListTable(items, { category: "Link type", value: "Links", locale }) : undefined}
          state={state}
          loadingShape="bars"
          emptyTitle="No issue links"
          emptyDescription={`No issue links to another.`}
          height={state === "loading" ? 5 * ROW : Math.max(2, items.length) * ROW}
        >
          <BarList items={items} title="Links by type" valueNoun="links" layout="inline" />
        </ChartFrame>
        {links ? <KeyValueList items={linkFacts(links, locale)} labelWidth="minmax(0,60%)" /> : null}
      </div>
    </Section>
  );
}
