"use client";

import { useRecheckFollower } from "@/lib/api/hooks";

import { usePeopleLevel } from "./people-level";

export function RecheckFollower() {
  return usePeopleLevel() ? <Follow /> : null;
}

function Follow() {
  useRecheckFollower();
  return null;
}
