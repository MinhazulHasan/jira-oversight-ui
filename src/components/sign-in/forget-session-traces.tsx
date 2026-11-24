"use client";

import { useEffect } from "react";

import { forgetAll } from "@/components/ask/history";

/** On the sign-in pages nobody is signed in. */
export function ForgetSessionTraces() {
  useEffect(() => {
    forgetAll();
  }, []);
  return null;
}
