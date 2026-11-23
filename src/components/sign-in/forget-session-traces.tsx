"use client";

import { useEffect } from "react";

import { forgetAll } from "@/components/ask/history";

/**
 * On the sign-in pages nobody is signed in: whatever the last session left in
 * this tab (its Ask questions and answers) is forgotten, whether it ended by
 * signing out, by expiring, or by a refused sign-in.
 */
export function ForgetSessionTraces() {
  useEffect(() => {
    forgetAll();
  }, []);
  return null;
}
