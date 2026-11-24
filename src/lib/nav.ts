export type PageKey =
  | "portfolio"
  | "overview"
  | "findings"
  | "people"
  | "ask"
  | "insights"
  | "process"
  | "baseline"
  | "access_log"
  | "usage"
  | "rule_settings";

export interface NavPage {
  key: PageKey;
  href: string;
  label: string;
  /** One line on what the page answers (docs/DESIGN.md section 6). */
  purpose: string;
  /** The letter that follows `g` to go to this page. */
  chord: string;
  group: "oversight" | "reference" | "governance";
  /** Extra words the command palette should match. */
  keywords: string[];
  level?: "people";
}

export const NAV_PAGES: readonly NavPage[] = [
  {
    key: "portfolio",
    href: "/portfolio",
    label: "Portfolio",
    purpose: "Every synced board at a glance.",
    chord: "h",
    group: "oversight",
    keywords: ["home", "boards", "all boards", "projects", "command centre", "attention"],
  },
  {
    key: "overview",
    href: "/",
    label: "Overview",
    purpose: "Open breaches, warnings and trends for this board.",
    chord: "o",
    group: "oversight",
    keywords: ["home", "dashboard", "summary", "hot spots"],
  },
  {
    key: "findings",
    href: "/findings",
    label: "Findings",
    purpose: "Every breach and warning, with its evidence.",
    chord: "f",
    group: "oversight",
    keywords: ["breaches", "warnings", "rules", "evidence"],
  },
  {
    key: "people",
    href: "/people",
    label: "People",
    purpose: "How each person handles tickets, against the board.",
    chord: "e",
    group: "oversight",
    keywords: ["scorecard", "scorecards", "person", "compare", "assignees", "process"],
    level: "people",
  },
  {
    key: "ask",
    href: "/ask",
    label: "Ask",
    purpose: "Ask a question about this board.",
    chord: "a",
    group: "oversight",
    keywords: ["question", "query", "ai"],
  },
  {
    key: "insights",
    href: "/insights",
    label: "Insights",
    purpose: "The latest weekly briefing.",
    chord: "i",
    group: "oversight",
    keywords: ["briefing", "weekly", "summary", "narrative"],
  },
  {
    key: "process",
    href: "/process",
    label: "Process",
    purpose: "The agreed process and the rules that check it.",
    chord: "p",
    group: "reference",
    keywords: ["stages", "rules", "catalogue", "workflow"],
  },
  {
    key: "baseline",
    href: "/baseline",
    label: "Baseline",
    purpose: "The snapshot the rules were measured against.",
    chord: "b",
    group: "reference",
    keywords: ["snapshot", "report"],
  },
  {
    // Governance: accountability for person-level figures, for people level alone, like People.
    key: "access_log",
    href: "/governance/access-log",
    label: "Access log",
    purpose: "Who viewed whose figures, and when.",
    chord: "l",
    group: "governance",
    keywords: ["audit", "governance", "gdpr", "accountability", "who viewed", "log"],
    level: "people",
  },
  {
    key: "usage",
    href: "/governance/usage",
    label: "Usage",
    purpose: "Ask use against the daily budget.",
    chord: "u",
    group: "governance",
    keywords: ["governance", "budget", "tokens", "ai", "model", "rate limit", "cost"],
    level: "people",
  },
  {
    // an admin's settings for the board's rules, for people level alone, like the rest of Governance.
    key: "rule_settings",
    href: "/governance/rules",
    label: "Rule settings",
    purpose: "Turn rules on or off and set thresholds for this board.",
    chord: "r",
    group: "governance",
    keywords: ["rules", "thresholds", "configure", "settings", "severity", "governance"],
    level: "people",
  },
];

export const NAV_GROUPS: readonly { id: NavPage["group"]; label: string }[] = [
  { id: "oversight", label: "Oversight" },
  { id: "reference", label: "Reference" },
  { id: "governance", label: "Governance" },
];

/** Governance's own address: its first page, the access log. */
export const GOVERNANCE_PATH = "/governance";

/** The issue page is not in the rail, but it still needs a name and a purpose. */
export const ISSUE_PAGE = {
  label: "Issue",
  purpose: "One issue: timeline, changelog and findings.",
} as const;

/** The pages a reader is offered: every page, less the people-level ones for a team-level reader. */
export function navPagesFor(peopleLevel: boolean): readonly NavPage[] {
  return peopleLevel ? NAV_PAGES : NAV_PAGES.filter((page) => page.level !== "people");
}

export function pageByKey(key: PageKey): NavPage {
  const page = NAV_PAGES.find((p) => p.key === key);
  if (!page) throw new Error(`Unknown page: ${key}`);
  return page;
}

/** The rail item that owns a path. The issue page and unknown paths own none; Governance's own address is its first page. */
export function pageForPath(pathname: string): NavPage | undefined {
  if (pathname === "/") return pageByKey("overview");
  if (pathname === GOVERNANCE_PATH || pathname === `${GOVERNANCE_PATH}/`) return pageByKey("access_log");
  return NAV_PAGES.find(
    (p) => p.href !== "/" && (pathname === p.href || pathname.startsWith(`${p.href}/`)),
  );
}

/** The page `g` then this letter goes to, among the pages this reader is offered. */
export function pageForChord(letter: string, peopleLevel = false): NavPage | undefined {
  const key = letter.toLowerCase();
  return navPagesFor(peopleLevel).find((p) => p.chord === key);
}
