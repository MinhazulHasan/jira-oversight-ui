"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

/** The briefing is made to be printed: the browser's own dialog, A4 or Letter. */
export function PrintButton() {
  return (
    <Button icon={Printer} onClick={() => window.print()}>
      Print
    </Button>
  );
}
