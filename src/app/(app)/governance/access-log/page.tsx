import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { AccessLogView, AccessLogViewFallback } from "@/components/governance/access-log-view";
import { CopyLinkButton } from "@/components/shell/copy-link-button";
import { PageBody, PageHeader, PageSheet } from "@/components/shell/page";
import { pageByKey } from "@/lib/nav";
import { currentAskLevel } from "@/server/auth/session";

const page = pageByKey("access_log");

export const metadata: Metadata = { title: page.label };

export default async function AccessLogPage() {
  if ((await currentAskLevel()) !== "people") notFound();
  return (
    <PageSheet>
      <PageHeader title={page.label} purpose={page.purpose} actions={<CopyLinkButton />} />
      <PageBody>
        <Suspense fallback={<AccessLogViewFallback />}>
          <AccessLogView />
        </Suspense>
      </PageBody>
    </PageSheet>
  );
}
