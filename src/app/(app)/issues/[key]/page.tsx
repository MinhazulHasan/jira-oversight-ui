import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { IssueView } from "@/components/issue/issue-view";
import { PageSheet } from "@/components/shell/page";
import { issueKeyFromSegment } from "@/lib/issue-key";

/** The key as the reader typed it, upper-cased ("demo-12" is DEMO-12); null when the address cannot be read. */
async function keyFrom(params: PageProps<"/issues/[key]">["params"]): Promise<string | null> {
  const { key } = await params;
  try {
    return decodeURIComponent(key).toUpperCase();
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: PageProps<"/issues/[key]">): Promise<Metadata> {
  return { title: (await keyFrom(params)) ?? "Issue" };
}

/**
 * The Issue page. A malformed key is a 404; whether the snapshot holds the
 * issue is the data's to say, inside the page (a calm "not in the snapshot"
 * with the ways back). This page streams behind (app)/loading.tsx, so its
 * notFound() alone would go out with status 200: src/proxy.ts sends a
 * malformed key to the (missing) group first, for a real 404 status.
 */
export default async function IssuePage({ params }: PageProps<"/issues/[key]">) {
  const key = issueKeyFromSegment((await params).key);
  if (key === null) notFound();

  return (
    <PageSheet>
      <IssueView issueKey={key} />
    </PageSheet>
  );
}
