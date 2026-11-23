"use client";

import { Printer } from "lucide-react";

import { CopyLinkButton } from "@/components/shell/copy-link-button";
import { Button } from "@/components/ui/button";

/**
 * The page's actions: the link to this view, and the report on paper (the
 * print styles lay it out for A4 and US Letter).
 */
export function BaselineActions() {
  return (
    <>
      <CopyLinkButton />
      <Button icon={Printer} onClick={() => window.print()}>
        Print
      </Button>
    </>
  );
}
