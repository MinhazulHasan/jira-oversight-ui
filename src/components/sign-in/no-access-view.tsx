import { signInPath, type NoAccessReason } from "@/lib/sign-in";

import { ATLASSIAN_LOGOUT_URL, NO_ACCESS_FALLBACK, NO_ACCESS_REFUSALS } from "./copy";
import { ExternalTextLink, PrimaryLink, SignInHeading, SignInSheet } from "./sign-in-sheet";

/** /no-access. */
export function NoAccessView({ reason }: { reason: NoAccessReason | null }) {
  const refusal = reason ? NO_ACCESS_REFUSALS[reason] : NO_ACCESS_FALLBACK;

  return (
    <SignInSheet>
      <SignInHeading eyebrow="No access" title={refusal.title} purpose={refusal.body} />
      <div className="flex flex-col gap-2 rounded-md border border-rule-weak bg-rail px-4 py-3.5">
        <h2 className="micro text-ink-low">To use a different Atlassian account</h2>
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-ink-mid">
          <li>
            Sign out of Atlassian at <ExternalTextLink href={ATLASSIAN_LOGOUT_URL}>id.atlassian.com</ExternalTextLink>.
          </li>
          <li>
            Come back here and choose <span className="font-medium text-ink">{refusal.action}</span>.
          </li>
        </ol>
      </div>
      <PrimaryLink href={signInPath()}>{refusal.action}</PrimaryLink>
      <p className="text-xs text-ink-low">You are not signed in to Jira Oversight.</p>
    </SignInSheet>
  );
}
