import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PeopleView, PeopleViewFallback } from "@/components/people/people-view";
import { CopyLinkButton } from "@/components/shell/copy-link-button";
import { PageBody, PageHeader, PageSheet } from "@/components/shell/page";
import { pageByKey } from "@/lib/nav";
import { currentAskLevel } from "@/server/auth/session";
import { expectedComparison } from "@/server/comparison";

const page = pageByKey("people");

export const metadata: Metadata = { title: page.label };

/**
 * People (JO-11): how tickets are handled, person by person, next to the
 * whole board, for the people level alone (an admin, or anyone with sign-in
 * off). Anyone else gets the app's not-found page, as if there were no such
 * page, and the oversight route refuses them the figures all the same. The
 * period, the person and the sort live in the address, so Copy link shares
 * the view.
 */
export default async function PeoplePage() {
  if ((await currentAskLevel()) !== "people") notFound();
  // The shape to hold while the figures load: the comparison's table, or one person at a time (the JO-11 check, G2).
  const expected = expectedComparison();
  return (
    <PageSheet>
      <PageHeader title={page.label} purpose={page.purpose} actions={<CopyLinkButton />} />
      <PageBody>
        <Suspense fallback={<PeopleViewFallback expected={expected} />}>
          <PeopleView expected={expected} />
        </Suspense>
      </PageBody>
    </PageSheet>
  );
}
