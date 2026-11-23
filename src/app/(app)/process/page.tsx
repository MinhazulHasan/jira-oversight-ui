import type { Metadata } from "next";

import { ProcessView } from "@/components/process/process-view";
import { CopyLinkButton } from "@/components/shell/copy-link-button";
import { PageBody, PageHeader, PageSheet } from "@/components/shell/page";
import { pageByKey } from "@/lib/nav";

const page = pageByKey("process");

export const metadata: Metadata = { title: page.label };

/**
 * Process: the agreed delivery process against what Jira can prove, and the
 * catalogue of rules that check it. The data regions are client components
 * (every data hook is); the frame renders on the server.
 */
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
