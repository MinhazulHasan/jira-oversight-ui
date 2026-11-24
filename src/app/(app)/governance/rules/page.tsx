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
