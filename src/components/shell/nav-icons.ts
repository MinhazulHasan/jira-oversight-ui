import {
  Flag,
  Gauge,
  Layers,
  LayoutGrid,
  MessageSquareText,
  Newspaper,
  Ruler,
  ScrollText,
  SlidersHorizontal,
  UsersRound,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import type { PageKey } from "@/lib/nav";

/** Kept apart from lib/nav so the page list stays plain data the server can read. */
export const NAV_ICONS: Record<PageKey, LucideIcon> = {
  portfolio: Layers,
  overview: LayoutGrid,
  findings: Flag,
  people: UsersRound,
  ask: MessageSquareText,
  insights: Newspaper,
  process: Workflow,
  baseline: Ruler,
  access_log: ScrollText,
  usage: Gauge,
  rule_settings: SlidersHorizontal,
};
