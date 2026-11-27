"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Tooltip } from "radix-ui";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { z } from "zod";

z.config({ jitless: true });

const MINUTE = 60_000;

function errorStatus(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "status" in error) {
    const { status } = error;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}

/** The app's query client, with its defaults (exported for the tests that hold the hooks to them). */
export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // The data is synced every 30 minutes; a minute of freshness costs nothing.
        staleTime: MINUTE,
        gcTime: 10 * MINUTE,
        // A 4xx will say the same thing the second time; a dropped connection may not.
        retry: (failureCount, error) => {
          const status = errorStatus(error);
          if (status !== undefined && status >= 400 && status < 500) return false;
          return failureCount < 2;
        },
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

// One client per server render keeps requests apart; one in the browser keeps the cache.
function getQueryClient() {
  if (typeof window === "undefined") return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}

const themeScriptProps = {
  type: typeof window === "undefined" ? "text/javascript" : "text/plain",
};

export function Providers({ nonce, children }: { nonce?: string; children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="data-theme"
      themes={["light", "dark"]}
      defaultTheme="system"
      enableSystem
      storageKey="jo-theme"
      disableTransitionOnChange
      nonce={nonce}
      scriptProps={themeScriptProps}
    >
      <QueryClientProvider client={getQueryClient()}>
        <NuqsAdapter>
          <Tooltip.Provider delayDuration={350} skipDelayDuration={150}>
            {children}
            <Toaster
              position="bottom-right"
              offset={20}
              mobileOffset={16}
              gap={8}
              visibleToasts={3}
              expand
              containerAriaLabel="Notifications"
              toastOptions={{
                unstyled: true,
                classNames: {
                  toast: "jo-toast",
                  content: "jo-toast-content",
                  title: "jo-toast-title",
                  description: "jo-toast-description",
                  actionButton: "jo-toast-action",
                },
              }}
            />
          </Tooltip.Provider>
        </NuqsAdapter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
