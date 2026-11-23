import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import { Providers } from "@/components/providers";

import "./globals.css";
import { fontVariables } from "./typefaces";

export const metadata: Metadata = {
  title: {
    template: "%s · Jira Oversight",
    default: "Jira Oversight",
  },
  description:
    "Read-only oversight of delivery work in Jira.",
  applicationName: "Jira Oversight",
  // An internal instrument: never indexed, even if it is ever reachable.
  robots: { index: false, follow: false },
  formatDetection: { telephone: false, date: false, address: false, email: false },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f0eb" },
    { media: "(prefers-color-scheme: dark)", color: "#0c1015" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The per-request nonce from src/proxy.ts. Reading it also makes every page
  // render per request, which a nonce-based Content Security Policy requires.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en-GB" className={fontVariables} suppressHydrationWarning>
      <body className="min-h-dvh bg-desk text-ink">
        <Providers nonce={nonce}>{children}</Providers>
      </body>
    </html>
  );
}
