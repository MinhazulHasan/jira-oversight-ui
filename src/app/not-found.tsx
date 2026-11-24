import type { Metadata } from "next";
import Link from "next/link";

import { BrandMark } from "@/components/shell/brand-mark";

export const metadata: Metadata = { title: "Page not found" };

export default function RootNotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="sheet flex w-full max-w-[520px] flex-col items-start gap-5 p-8">
        <BrandMark size={32} />
        <div className="flex flex-col gap-2">
          <p className="micro text-ink-low">Not found &middot; 404</p>
          <h1 className="text-h font-semibold tracking-[-0.015em] text-ink">Nothing at this address</h1>
          <p className="text-base text-ink-mid">
            The link may be out of date or mistyped.
          </p>
        </div>
        <Link
          href="/"
          className="pressable inline-flex h-9 items-center rounded-sm bg-cite px-3.5 text-sm font-medium text-cite-ink hover:bg-cite-hot"
        >
          Go to Overview
        </Link>
      </div>
    </main>
  );
}
