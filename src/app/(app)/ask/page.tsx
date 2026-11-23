import type { Metadata } from "next";
import { Suspense } from "react";

import { AskView, AskViewFallback } from "@/components/ask/ask-view";
import { CopyLinkButton } from "@/components/shell/copy-link-button";
import { PageBody, PageHeader, PageSheet } from "@/components/shell/page";
import { pageByKey } from "@/lib/nav";
import { currentAskLevel } from "@/server/auth/session";

const page = pageByKey("ask");

export const metadata: Metadata = { title: page.label };

/**
 * Ask: a question in plain English, answered from the oversight facts. The
 * question lives in the URL (`/ask?q=…`), so Copy link shares it and the
 * command palette sends questions here.
 *
 * How far Ask answers this reader is checked here, on the server, as the
 * shell checks the admin badge: an admin (or anyone, with sign-in off) can
 * type @ and ask about people. The oversight route checks it again on every
 * question, so this only decides what the page offers.
 */
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
