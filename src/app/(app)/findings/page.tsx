import type { Metadata } from "next";
import { Suspense } from "react";

import { FindingsSkeleton } from "@/components/findings/findings-skeleton";
import { FindingsView } from "@/components/findings/findings-view";
import { PageBody, PageHeader, PageSheet } from "@/components/shell/page";
import { pageByKey } from "@/lib/nav";

const page = pageByKey("findings");

export const metadata: Metadata = { title: page.label };

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
