import type { Metadata } from "next";

import { ProcessView } from "@/components/process/process-view";
import { CopyLinkButton } from "@/components/shell/copy-link-button";
import { PageBody, PageHeader, PageSheet } from "@/components/shell/page";
import { pageByKey } from "@/lib/nav";

const page = pageByKey("process");

export const metadata: Metadata = { title: page.label };

export default function ProcessPage() {
  return (
    <PageSheet>
      <PageHeader title={page.label} purpose={page.purpose} actions={<CopyLinkButton />} />
      <PageBody>
        <ProcessView />
      </PageBody>
    </PageSheet>
  );
}
