import type { Metadata } from "next";
import { Suspense } from "react";

import { PortfolioView, PortfolioViewFallback } from "@/components/portfolio/portfolio-view";
import { CopyLinkButton } from "@/components/shell/copy-link-button";
import { PageBody, PageHeader, PageSheet } from "@/components/shell/page";
import { pageByKey } from "@/lib/nav";

const page = pageByKey("portfolio");

export const metadata: Metadata = { title: page.label };

/**
 * Portfolio (JO-12): every board at a glance, the admin's landing page after
 * signing in. One row per board, each with its Overview's own figures, and
 * the oldest open breaches across them. It names no one, so it is everyone's;
 * the oversight route holds it to the boards the reader may open before
 * anything reaches the browser. The sort lives in the address, so Copy link
 * shares the view.
 */
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
