import type { Metadata } from "next";

import { OverviewView } from "@/components/overview/overview-view";
import { CopyLinkButton } from "@/components/shell/copy-link-button";
import { PageBody, PageHeader, PageSheet } from "@/components/shell/page";
import { pageByKey } from "@/lib/nav";

const page = pageByKey("overview");

export const metadata: Metadata = { title: page.label };

/**
 * Overview: where the work stands and where it is going wrong, on one
 * screen. The frame renders on the server; the figures load in the browser
 * through the data hooks, each region holding its final shape meanwhile.
 */
export default function OverviewPage() {
  return (
    <PageSheet>
      <PageHeader title={page.label} purpose={page.purpose} actions={<CopyLinkButton />} />
      <PageBody>
        <OverviewView />
      </PageBody>
    </PageSheet>
  );
}
