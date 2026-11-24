"use client";

import { useEffect } from "react";

import { BrandMark } from "@/components/shell/brand-mark";

import "./globals.css";
import { fontVariables } from "./typefaces";

export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en-GB" className={fontVariables}>
      <body className="min-h-dvh bg-desk text-ink">
        <main className="flex min-h-dvh items-center justify-center p-6">
          <div
            role="alert"
            className="sheet flex w-full max-w-[520px] flex-col items-start gap-5 p-8"
          >
            <BrandMark size={32} />
            <div className="flex flex-col gap-2">
              <p className="micro text-ink-low">Something went wrong</p>
              <h1 className="text-h font-semibold tracking-[-0.015em] text-ink">
                Jira Oversight could not start
              </h1>
              <p className="text-base text-ink-mid">
                Try again.
              </p>
            </div>
            <button
              type="button"
              onClick={() => retry()}
              className="pressable inline-flex h-9 items-center rounded-sm bg-cite px-3.5 text-sm font-medium text-cite-ink hover:bg-cite-hot"
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
