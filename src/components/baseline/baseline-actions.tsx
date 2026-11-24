"use client";

import { Printer } from "lucide-react";

import { CopyLinkButton } from "@/components/shell/copy-link-button";
import { Button } from "@/components/ui/button";

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
