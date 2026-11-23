"use client";

import { useEffect } from "react";

import { notify } from "@/lib/notify";

/**
 * Signing out is acknowledged like every other action: a toast, beside the
 * notice on the page that says the same and stays.
 */
export function SignedOutToast() {
  useEffect(() => {
    notify.ok("Signed out", { id: "signed-out", description: "Your session on this browser has ended." });
  }, []);
  return null;
}
