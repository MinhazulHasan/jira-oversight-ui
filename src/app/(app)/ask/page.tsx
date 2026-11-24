import type { Metadata } from "next";
import { Suspense } from "react";

import { AskView, AskViewFallback } from "@/components/ask/ask-view";
import { CopyLinkButton } from "@/components/shell/copy-link-button";
import { PageBody, PageHeader, PageSheet } from "@/components/shell/page";
import { pageByKey } from "@/lib/nav";
import { currentAskLevel } from "@/server/auth/session";

const page = pageByKey("ask");

export const metadata: Metadata = { title: page.label };

export default async function AskPage() {
  const level = await currentAskLevel();
  return (
    <PageSheet>
      <PageHeader title={page.label} purpose={page.purpose} actions={<CopyLinkButton />} />
      <PageBody>
        <Suspense fallback={<AskViewFallback />}>
          <AskView level={level} />
        </Suspense>
      </PageBody>
    </PageSheet>
  );
}
