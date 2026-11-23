"use client";

import { ExternalLink } from "lucide-react";

import { iconButtonVariants } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useIssueTimeline } from "@/lib/api/hooks";
import type { DataMode } from "@/lib/api/schemas";
import { cn } from "@/lib/utils";

const CONTROL = iconButtonVariants({ variant: "ghost", size: "sm" });

/**
 * "Open in Jira" for a finding's issue. The finding itself carries no link:
 * the interface fills an issue's Jira address on the Issue endpoint, so in
 * live mode that is asked for (and shared with the Issue page's cache). In
 * sample mode there is no Jira to open, and the control says so on hover and
 * focus rather than disappearing.
 */
export function OpenInJira({ issueKey, dataMode }: { issueKey: string; dataMode: DataMode | undefined }) {
  const live = dataMode === "live";
  const issue = useIssueTimeline(live ? issueKey : null);
  const url = issue.data?.issue.url ?? null;

  if (url) {
    return (
      <Tooltip content={`Open ${issueKey} in Jira`}>
        <a href={url} target="_blank" rel="noopener noreferrer" aria-label="Open in Jira (new tab)" className={CONTROL}>
          <ExternalLink aria-hidden strokeWidth={1.75} />
        </a>
      </Tooltip>
    );
  }

  const reason = !live
    ? "Sample data: no Jira link"
    : issue.isPending
      ? "Finding the Jira link…"
      : "No Jira link: the Jira address is not configured";

  return (
    <Tooltip content={reason}>
      {/* aria-disabled rather than disabled, so the reason stays reachable on hover and focus. */}
      <button type="button" aria-label="Open in Jira" aria-disabled className={cn(CONTROL, "cursor-not-allowed opacity-45")}>
        <ExternalLink aria-hidden strokeWidth={1.75} />
      </button>
    </Tooltip>
  );
}
