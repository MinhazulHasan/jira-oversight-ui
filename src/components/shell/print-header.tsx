"use client";

import { usePathname } from "next/navigation";

import { useHealth } from "@/lib/api/hooks";
import { formatDateTime } from "@/lib/format";
import { ISSUE_PAGE, pageForPath } from "@/lib/nav";
import { useNow } from "@/lib/use-now";

import { sourceLabel } from "./data-source";

/** Only on paper. */
export function PrintHeader() {
  const pathname = usePathname();
  const health = useHealth();
  const now = useNow();

  const page = pageForPath(pathname)?.label ?? (pathname.startsWith("/issues/") ? ISSUE_PAGE.label : "");
  const parts = ["Jira Oversight", page];
  if (health.data) {
    parts.push(sourceLabel(health.data));
    parts.push(health.data.last_synced_at === null ? "Not synced yet" : `Last synced ${formatDateTime(health.data.last_synced_at)}`);
  }
  if (now !== null) parts.push(`Printed ${formatDateTime(now)}`);

  return (
    <div data-print="only" className="mb-4 hidden border-b border-rule pb-2 text-xs text-ink-mid">
      {parts.filter(Boolean).join("  ·  ")}
    </div>
  );
}
