import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AddRuleButton, AddRuleProvider } from "@/components/governance/rule-settings/add-rule";
import { RuleSettingsView } from "@/components/governance/rule-settings/rule-settings-view";
import { CopyLinkButton } from "@/components/shell/copy-link-button";
import { PageBody, PageHeader, PageSheet } from "@/components/shell/page";
import { pageByKey } from "@/lib/nav";
import { currentAskLevel } from "@/server/auth/session";

const page = pageByKey("rule_settings");

export const metadata: Metadata = { title: page.label };

/**
 * Rule settings (JO-15): an admin turns the board's rules on or off and sets
 * their severity and thresholds, with a preview of what a change would do,
 * every change recorded (who, when, why) and the latest one undone in a
 * press. Since JO-20 an admin also adds rules of the board's own ("Add rule"
 * in the header, which an AI can draft from their words), edits and deletes
 * them. People level's alone, like the rest of Governance: anyone else gets
 * the app's not-found page, and the oversight route refuses them the settings
 * all the same. The board is the one picked in the top bar.
 */
export default async function RuleSettingsPage() {
  if ((await currentAskLevel()) !== "people") notFound();
  return (
    <PageSheet>
      <AddRuleProvider>
        <PageHeader
          title={page.label}
          purpose={page.purpose}
          actions={
            <>
              <AddRuleButton />
              <CopyLinkButton />
            </>
          }
        />
        <PageBody>
          <RuleSettingsView />
        </PageBody>
      </AddRuleProvider>
    </PageSheet>
  );
}
