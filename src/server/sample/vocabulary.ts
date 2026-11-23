/**
 * Words for the sample project: epics a product team might plausibly run, and
 * ticket summaries built from them. Domain-neutral on purpose, free of digits
 * (ticket text is never a source of figures), and free of people: nothing
 * here names, describes or pictures anyone.
 */

import type { Rng } from "./random";

export type IssueType = "Task" | "Bug" | "Subtask" | "Test" | "Epic";

export interface EpicDef {
  title: string;
  /** Weeks before the current week's Monday that the epic opened. */
  startWeeksAgo: number;
  /** Weeks before the current week's Monday that new work stopped; null while it is still open. */
  endWeeksAgo: number | null;
  /** How much of the team's new work it draws while open. */
  weight: number;
  /**
   * One of the two big current epics: run under pressure, so more of its work
   * starts before anyone sizes it, and effort against estimate has been
   * climbing for the last five weeks.
   */
  drifting: boolean;
  objects: readonly string[];
}

export const EPICS: readonly EpicDef[] = [
  {
    title: "Onboarding flow",
    startWeeksAgo: 51,
    endWeeksAgo: 38,
    weight: 1.0,
    drifting: false,
    objects: [
      "welcome screen", "sign-up form validation", "email verification step", "first-run checklist",
      "progress indicator", "invite link handling", "terms acceptance step", "onboarding events",
      "skip option for returning accounts", "password strength meter", "account setup wizard",
      "sample workspace", "help tooltips", "onboarding copy",
    ],
  },
  {
    title: "Account settings",
    startWeeksAgo: 49,
    endWeeksAgo: 34,
    weight: 0.8,
    drifting: false,
    objects: [
      "profile page layout", "password change form", "two-step sign-in setup", "session list",
      "language preference", "time zone setting", "account deletion request", "contact email field",
      "settings navigation", "data export request", "security log", "connected apps list",
      "settings search", "account recovery codes",
    ],
  },
  {
    title: "Search and filtering",
    startWeeksAgo: 46,
    endWeeksAgo: 26,
    weight: 1.0,
    drifting: false,
    objects: [
      "date range filter", "saved searches", "search result highlighting", "empty results state",
      "filter chips", "search index refresh job", "keyboard navigation in results", "status filter",
      "search suggestions", "result sorting", "search across archived records", "filter state in the address bar",
      "search speed on large projects", "clear-all filters control",
    ],
  },
  {
    title: "Reporting exports",
    startWeeksAgo: 42,
    endWeeksAgo: 20,
    weight: 1.0,
    drifting: false,
    objects: [
      "CSV export of the summary report", "PDF layout for the monthly report", "export column picker",
      "scheduled report delivery", "export progress indicator", "large export streaming",
      "report header with the filters applied", "export file naming", "time zone handling in exports",
      "report preview", "export audit entry", "number formatting in exports", "page breaks in printed reports",
      "export retry after a failure",
    ],
  },
  {
    title: "Notification preferences",
    startWeeksAgo: 38,
    endWeeksAgo: 22,
    weight: 0.7,
    drifting: false,
    objects: [
      "digest frequency setting", "per-channel opt-out", "quiet hours", "notification templates",
      "unsubscribe link handling", "notification batching", "email footer", "in-app notification list",
      "mark-all-as-read action", "notification grouping", "delivery retry policy", "preference migration",
      "notification preview", "bounce handling",
    ],
  },
  {
    title: "Billing and invoices",
    startWeeksAgo: 34,
    endWeeksAgo: 12,
    weight: 1.0,
    drifting: false,
    objects: [
      "invoice PDF generation", "tax number validation", "payment method form", "billing address form",
      "invoice numbering", "proration on plan change", "credit note support", "billing history page",
      "failed payment retry", "currency display", "invoice email", "tax rate table",
      "plan comparison page", "receipt download",
    ],
  },
  {
    title: "Access and permissions",
    startWeeksAgo: 30,
    endWeeksAgo: 10,
    weight: 0.9,
    drifting: false,
    objects: [
      "role editor", "permission checks on export", "read-only role", "team invitations", "access request flow",
      "permission audit report", "admin console layout", "role assignment endpoint", "default role for new members",
      "permission caching", "access denied page", "bulk role update", "service account tokens",
      "permission matrix view",
    ],
  },
  {
    title: "Audit trail",
    startWeeksAgo: 26,
    endWeeksAgo: 6,
    weight: 0.8,
    drifting: false,
    objects: [
      "audit event schema", "audit log viewer", "retention policy job", "audit export", "event filtering by type",
      "tamper-evident hashing", "audit entry for settings changes", "audit search", "clock skew handling",
      "audit log paging", "event volume alerting", "audit endpoint", "archived log access", "audit timeline view",
    ],
  },
  {
    title: "Document storage",
    startWeeksAgo: 22,
    endWeeksAgo: null,
    weight: 0.8,
    drifting: false,
    objects: [
      "file upload limits", "folder structure", "document preview", "version history", "storage quota display",
      "virus scan hook", "bulk download", "file rename", "drag-and-drop upload", "shared links", "document tags",
      "storage migration job", "thumbnail generation", "trash and restore",
    ],
  },
  {
    title: "Data import pipeline",
    startWeeksAgo: 18,
    endWeeksAgo: null,
    weight: 2.6,
    drifting: true,
    objects: [
      "CSV import mapping", "import validation report", "duplicate detection", "import scheduler",
      "error row export", "large file chunking", "import rollback", "field type inference",
      "import progress tracking", "encoding detection", "import templates", "partial import resume",
      "import throughput", "import status notifications",
    ],
  },
  {
    title: "Integrations API",
    startWeeksAgo: 16,
    endWeeksAgo: null,
    weight: 2.6,
    drifting: true,
    objects: [
      "webhook delivery", "API rate limiting", "OAuth client registration", "API paging", "webhook signature checks",
      "API versioning", "integration health page", "retry queue for webhooks", "API error format",
      "sandbox environment", "API key rotation", "event subscription endpoint", "API usage page", "integration logs",
    ],
  },
  {
    title: "Scheduling engine",
    startWeeksAgo: 12,
    endWeeksAgo: null,
    weight: 1.0,
    drifting: false,
    objects: [
      "recurring job rules", "calendar view", "time zone aware scheduling", "job conflict detection",
      "schedule preview", "missed run handling", "schedule export", "holiday calendar", "job priority queue",
      "cron expression editor", "schedule change history", "concurrency limits", "schedule templates",
      "next-run indicator",
    ],
  },
  {
    title: "Mobile layout",
    startWeeksAgo: 8,
    endWeeksAgo: null,
    weight: 0.8,
    drifting: false,
    objects: [
      "responsive navigation", "touch targets on tables", "mobile filters sheet", "small-screen charts",
      "mobile sign-in", "offline banner", "swipe actions", "mobile form layout", "safe-area padding",
      "landscape layout", "mobile print styles", "bottom sheet component", "mobile performance budget",
      "font scaling",
    ],
  },
  {
    title: "Performance tuning",
    startWeeksAgo: 4,
    endWeeksAgo: null,
    weight: 0.6,
    drifting: false,
    objects: [
      "slow query on the findings list", "page load budget", "image compression", "cache headers", "bundle size",
      "database index review", "API response time", "memory use in the import worker", "background job throughput",
      "render time of large tables", "connection pooling", "cold start time", "chart rendering cost",
      "repeated queries in reports",
    ],
  },
];

/** Work that belongs to no epic: upkeep every team does. */
export const UNPLANNED_OBJECTS: readonly string[] = [
  "dependency updates", "build pipeline warnings", "flaky end-to-end test", "setup steps in the README",
  "logging format", "error page copy", "staging environment configuration", "linting rules", "release checklist",
  "monitoring alerts", "support escalation path", "spelling on the settings page",
];

const TEMPLATES: Record<Exclude<IssueType, "Epic">, readonly string[]> = {
  Task: [
    "Add {o}", "Build {o}", "Update {o}", "Improve {o}", "Refactor {o}", "Design {o}", "Implement {o}",
    "Review {o}", "Document {o}", "Rework {o}",
  ],
  Bug: [
    "Fix {o}", "{O} fails on large inputs", "{O} shows the wrong totals", "{O} breaks in Safari", "{O} times out",
    "Error when saving {o}", "{O} ignores the time zone", "Crash in {o}", "{O} loses unsaved changes",
    "{O} misaligned on small screens",
  ],
  Subtask: [
    "Write unit tests for {o}", "Update copy for {o}", "Wire up {o}", "Add events to {o}", "Handle errors in {o}",
    "Check accessibility of {o}", "Add logging to {o}", "Clean up {o}",
  ],
  Test: [
    "Test plan for {o}", "Regression tests for {o}", "End-to-end test for {o}", "Load test for {o}",
    "Manual check of {o}", "Exploratory testing of {o}",
  ],
};

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A summary no other issue in the project has. */
export function summaryFor(
  rng: Rng,
  type: Exclude<IssueType, "Epic">,
  objects: readonly string[],
  used: Set<string>,
): string {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const object = rng.pick(objects);
    const summary = rng.pick(TEMPLATES[type]).replace("{o}", object).replace("{O}", capitalise(object));
    if (!used.has(summary)) {
      used.add(summary);
      return summary;
    }
  }
  const base = rng.pick(TEMPLATES[type]).replace("{o}", rng.pick(objects)).replace("{O}", capitalise(rng.pick(objects)));
  for (const suffix of [" (follow-up)", " (second pass)", " (clean-up)", " (edge cases)", " (part two)"]) {
    if (!used.has(base + suffix)) {
      used.add(base + suffix);
      return base + suffix;
    }
  }
  used.add(`${base} (again)`);
  return `${base} (again)`;
}
