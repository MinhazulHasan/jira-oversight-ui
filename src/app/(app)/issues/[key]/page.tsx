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

export default async function IssuePage({ params }: PageProps<"/issues/[key]">) {
  const key = issueKeyFromSegment((await params).key);
  if (key === null) notFound();

  return (
    <PageSheet>
      <IssueView issueKey={key} />
    </PageSheet>
  );
}
