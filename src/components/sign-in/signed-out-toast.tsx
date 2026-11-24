"use client";

import { useEffect } from "react";

import { notify } from "@/lib/notify";

/** Signing out is acknowledged like every other action. */
export function SignedOutToast() {
  useEffect(() => {
    notify.ok("Signed out", { id: "signed-out", description: "Your session on this browser has ended." });
  }, []);
  return null;
}
