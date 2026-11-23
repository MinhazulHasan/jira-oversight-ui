import type { Metadata } from "next";
import { Suspense } from "react";

import { FindingsSkeleton } from "@/components/findings/findings-skeleton";
import { FindingsView } from "@/components/findings/findings-view";
import { PageBody, PageHeader, PageSheet } from "@/components/shell/page";
import { pageByKey } from "@/lib/nav";

const page = pageByKey("findings");

export const metadata: Metadata = { title: page.label };

/**
 * Findings: the working list. The header is drawn on the server; the filters,
 * the table and the evidence drawer read the URL in the browser, so every
 * view (filters, sort, page, the open finding) is a link. Export CSV and Copy
 * link sit on the result line, beside the rows they act on.
 */
export default function FindingsPage() {
  return (
    <PageSheet>
      <PageHeader title={page.label} purpose={page.purpose} />
      <PageBody className="flex flex-col gap-4">
        <Suspense fallback={<FindingsSkeleton />}>
          <FindingsView />
        </Suspense>
      </PageBody>
    </PageSheet>
  );
}
