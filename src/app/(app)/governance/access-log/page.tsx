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

/**
 * Access log (JO-12): who viewed whose figures, and when, as the oversight
 * service recorded them (scorecards, comparisons, a person's findings,
 * questions about people, person cards, and reads of the log itself).
 * Governance is people level's alone (an admin, or anyone with sign-in
 * off): anyone else gets the app's not-found page, as if there were no such
 * page, and the oversight route refuses them the entries all the same. The
 * filters live in the address, so Copy link shares the view.
 */
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
