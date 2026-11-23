import type { Metadata } from "next";

import { InsightsView } from "@/components/insights/insights-view";
import { PrintButton } from "@/components/insights/print-button";
import { CopyLinkButton } from "@/components/shell/copy-link-button";
import { PageBody, PageHeader, PageSheet } from "@/components/shell/page";
import { pageByKey } from "@/lib/nav";

const page = pageByKey("insights");

export const metadata: Metadata = { title: page.label };

/** James's weekly briefing: where the system thinks things are a problem, and the evidence for each line. */
export default function InsightsPage() {
  return (
    <PageSheet>
      <PageHeader
        title={page.label}
        purpose={page.purpose}
        actions={
          <>
            <CopyLinkButton />
            <PrintButton />
          </>
        }
      />
      <PageBody>
        <InsightsView />
      </PageBody>
    </PageSheet>
  );
}
