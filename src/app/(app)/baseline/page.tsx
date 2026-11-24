import type { Metadata } from "next";

import { BaselineActions } from "@/components/baseline/baseline-actions";
import { BaselineView } from "@/components/baseline/baseline-view";
import { PageBody, PageHeader, PageSheet } from "@/components/shell/page";
import { pageByKey } from "@/lib/nav";

const page = pageByKey("baseline");

export const metadata: Metadata = { title: page.label };

export default function BaselinePage() {
  return (
    <PageSheet>
      <PageHeader title={page.label} purpose={page.purpose} actions={<BaselineActions />} />
      <PageBody>
        <BaselineView />
      </PageBody>
    </PageSheet>
  );
}
