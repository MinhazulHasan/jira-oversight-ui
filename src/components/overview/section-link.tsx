import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

/** A quiet way on from a section to its full view: "All open findings →". Not printed. */
export function SectionLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button asChild variant="ghost" size="sm" className="-my-1 -mr-1.5">
      <Link href={href} data-print="hide">
        {children}
        <ArrowRight aria-hidden strokeWidth={1.75} />
      </Link>
    </Button>
  );
}
