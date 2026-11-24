import type { Metadata } from "next";
import { Suspense } from "react";

import { PortfolioView, PortfolioViewFallback } from "@/components/portfolio/portfolio-view";
import { CopyLinkButton } from "@/components/shell/copy-link-button";
import { PageBody, PageHeader, PageSheet } from "@/components/shell/page";
import { pageByKey } from "@/lib/nav";

const page = pageByKey("portfolio");

export const metadata: Metadata = { title: page.label };

export default function PortfolioPage() {
  return (
    <PageSheet>
      <PageHeader title={page.label} purpose={page.purpose} actions={<CopyLinkButton />} />
      <PageBody>
        <Suspense fallback={<PortfolioViewFallback />}>
          <PortfolioView />
        </Suspense>
      </PageBody>
    </PageSheet>
  );
}
