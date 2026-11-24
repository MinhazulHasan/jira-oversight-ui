import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { UsageView } from "@/components/governance/usage-view";
import { CopyLinkButton } from "@/components/shell/copy-link-button";
import { PageBody, PageHeader, PageSheet } from "@/components/shell/page";
import { pageByKey } from "@/lib/nav";
import { currentAskLevel } from "@/server/auth/session";

const page = pageByKey("usage");

export const metadata: Metadata = { title: page.label };

export default async function UsagePage() {
  if ((await currentAskLevel()) !== "people") notFound();
  return (
    <PageSheet>
      <PageHeader title={page.label} purpose={page.purpose} actions={<CopyLinkButton />} />
      <PageBody>
        <UsageView />
      </PageBody>
    </PageSheet>
  );
}
