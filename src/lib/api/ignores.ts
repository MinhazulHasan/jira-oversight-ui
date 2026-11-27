import { z } from "zod";

import { FIRST_SEEN_WINDOWS, NO_EPIC, TICKET_STATES } from "./params";
import {
  boardText,
  findingId,
  IGNORE_REASON_MAX,
  ignoredBy,
  ignoreId,
  ignoreReason,
  ignoreScopeSchema,
  isoDateTime,
  issueKey,
  metaSchema,
  personId,
  ruleId,
  severitySchema,
  statusCategorySchema,
  UNASSIGNED,
  type IgnoreScope,
} from "./schemas";

/** The most findings, tickets or ignores one request names. */
export const IGNORE_TARGET_MAX = 10_000;
/** A request's body at most: room for the most ids a request names (10,000 ignore ids is about 350 KB). */
export const IGNORE_BODY_MAX_BYTES = 1024 * 1024;

const count = z.number().int().nonnegative();
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/u;

/* ------------------------------------------------------------- targets -- */

/** GET /findings's filters, as a target names them: only open findings are ignored, so no state, and no paging. */
export const ignoreQuerySchema = z.strictObject({
  rule: z.array(ruleId).max(24).optional(),
  severity: severitySchema.optional(),
  epic: z.array(z.union([issueKey, z.literal(NO_EPIC)])).max(50).optional(),
  person: z.array(z.union([personId, z.literal(UNASSIGNED)])).max(50).optional(),
  q: z.string().trim().max(100).optional(),
  first_seen: z.enum(FIRST_SEEN_WINDOWS).optional(),
  ticket: z.enum(TICKET_STATES).optional(),
});

export type IgnoreQuery = z.output<typeof ignoreQuerySchema>;

/** The filters in canonical form: lists once each and sorted, and nothing that does not narrow. */
export function canonicalIgnoreQuery(query: IgnoreQuery): IgnoreQuery {
  const list = <T extends string>(values: readonly T[] | undefined) => (values && values.length > 0 ? [...new Set(values)].sort() : undefined);
  const rule = list(query.rule);
  const epic = list(query.epic);
  const person = list(query.person);
  const q = query.q?.trim();
  return {
    ...(rule ? { rule } : {}),
    ...(query.severity ? { severity: query.severity } : {}),
    ...(epic ? { epic } : {}),
    ...(person ? { person } : {}),
    ...(q ? { q } : {}),
    ...(query.first_seen && query.first_seen !== "all" ? { first_seen: query.first_seen } : {}),
    ...(query.ticket ? { ticket: query.ticket } : {}),
  };
}

/** What an ignore acts on: findings by id, whole tickets by key, or every open finding the filters match. */
export type IgnoreTarget = { finding_ids: string[] } | { issue_keys: string[] } | { query: IgnoreQuery };

const TARGETS = {
  finding_ids: z.strictObject({ finding_ids: z.array(findingId).min(1).max(IGNORE_TARGET_MAX) }),
  issue_keys: z.strictObject({ issue_keys: z.array(issueKey).min(1).max(IGNORE_TARGET_MAX) }),
  query: z.strictObject({ query: ignoreQuerySchema }),
} as const;

const once = (values: readonly string[]) => [...new Set(values)].sort();

export const ignoreTargetSchema = z.unknown().transform((value, ctx): IgnoreTarget => {
  const record = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  const named = record ? (Object.keys(TARGETS) as (keyof typeof TARGETS)[]).filter((key) => Object.hasOwn(record, key)) : [];
  if (record === null || named.length !== 1) {
    ctx.addIssue({ code: "custom", path: [], message: "Names exactly one of finding_ids, issue_keys or query." });
    return z.NEVER;
  }
  const parsed = TARGETS[named[0]].safeParse(record);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
    return z.NEVER;
  }
  const target = parsed.data;
  if ("finding_ids" in target) return { finding_ids: once(target.finding_ids) };
  if ("issue_keys" in target) return { issue_keys: once(target.issue_keys) };
  return { query: canonicalIgnoreQuery(target.query) };
});

/* ------------------------------------------------------------ requests -- */

/** A reason as kept: plain words on one line, at most 500 characters, never an email address; blank is none. */
const reasonRequest = z
  .string()
  .transform(boardText)
  .refine((text) => [...text].length <= IGNORE_REASON_MAX, { message: `Is at most ${IGNORE_REASON_MAX} characters.` })
  .refine((text) => !EMAIL.test(text), { message: "Leave out email addresses: every admin reads the reason." })
  .transform((text) => (text === "" ? null : text));

function ticketsTakeTicketScope(body: { target: IgnoreTarget; scope: IgnoreScope }, ctx: z.RefinementCtx) {
  if ("issue_keys" in body.target && body.scope !== "ticket") {
    ctx.addIssue({ code: "custom", path: ["scope"], message: "Is ticket when the target names tickets." });
  }
}

/** POST /findings/ignore/preview: what an ignore would do now, writing nothing. */
export const ignorePreviewRequestSchema = z
  .strictObject({ target: ignoreTargetSchema, scope: ignoreScopeSchema })
  .superRefine(ticketsTakeTicketScope);

/** POST /findings/ignore: the ignore itself, with the admin's reason or none. */
export const ignoreRequestSchema = z
  .strictObject({ target: ignoreTargetSchema, scope: ignoreScopeSchema, reason: reasonRequest.nullable().optional() })
  .superRefine(ticketsTakeTicketScope)
  .transform((body) => ({ target: body.target, scope: body.scope, reason: body.reason ?? null }));

/** POST /findings/restore: the ignores to remove, each once. */
export const restoreRequestSchema = z.strictObject({
  ignore_ids: z.array(ignoreId).min(1).max(IGNORE_TARGET_MAX).transform(once),
});

/* ----------------------------------------------------------- responses -- */

export const ignorePreviewSchema = z
  .object({
    meta: metaSchema,
    /** Open findings the ignore would resolve now. */
    findings: count,
    /** The tickets they are on. */
    tickets: count,
    by_rule: z.array(z.object({ rule_id: ruleId, rule_title: z.string().min(1), findings: count })),
    /** Findings the target names that are ignored already. */
    already_ignored: count,
  })
  .superRefine((body, ctx) => {
    const seen = new Set<string>();
    body.by_rule.forEach((entry, index) => {
      if (seen.has(entry.rule_id)) ctx.addIssue({ code: "custom", path: ["by_rule", index, "rule_id"], message: "listed twice" });
      seen.add(entry.rule_id);
    });
    if (body.by_rule.reduce((sum, entry) => sum + entry.findings, 0) !== body.findings) {
      ctx.addIssue({ code: "custom", path: ["by_rule"], message: "does not add up to the findings" });
    }
  });

export const ignoreResultSchema = z
  .object({
    meta: metaSchema,
    ignored: z.object({ findings: count, tickets: count }),
    /** One per ticket and rule (or whole ticket): an ignore that already stood for one is given again, not doubled. */
    ignore_ids: z.array(ignoreId),
  })
  .refine((body) => new Set(body.ignore_ids).size === body.ignore_ids.length, { path: ["ignore_ids"], message: "names an ignore twice" });

/** The re-check a restore starts, as the service's Refresher says it; a rule settings apply state reads as well. */
export const RECHECK_STATES = ["queued", "running", "succeeded", "failed", "applied", "pending"] as const;
export const restoreRecheckSchema = z.object({
  state: z.enum(RECHECK_STATES),
  started_at: isoDateTime.nullable().default(null),
  finished_at: isoDateTime.nullable().default(null),
  message: z.string().min(1).nullable().default(null),
});

export const restoreResultSchema = z.object({
  meta: metaSchema,
  restored: count,
  recheck: restoreRecheckSchema.nullable(),
});

/** An ignore as the ignored list shows it: the ticket, what it covers, how many findings it holds now, who, when, why. */
export const ignoreRecordSchema = z
  .object({
    ignore_id: ignoreId,
    scope: ignoreScopeSchema,
    issue_key: issueKey,
    issue_summary: z.string().nullable(),
    issue_type: z.string().nullable(),
    status: z.string().nullable(),
    status_category: statusCategorySchema.nullable(),
    rule_id: ruleId.nullable(),
    rule_title: z.string().nullable(),
    findings: count,
    reason: ignoreReason.nullable(),
    by: ignoredBy.nullable(),
    at: isoDateTime,
  })
  .refine((ignore) => (ignore.scope === "ticket") === (ignore.rule_id === null), {
    path: ["rule_id"],
    message: "a rule exactly when it covers one rule",
  });

export const ignoredPageSchema = z
  .object({
    meta: metaSchema,
    items: z.array(ignoreRecordSchema),
    total: count,
    page: z.number().int().min(1),
    page_size: z.number().int().min(1).max(100),
  })
  .superRefine((body, ctx) => {
    const seen = new Set<string>();
    body.items.forEach((item, index) => {
      if (seen.has(item.ignore_id)) ctx.addIssue({ code: "custom", path: ["items", index, "ignore_id"], message: "listed twice" });
      seen.add(item.ignore_id);
    });
    if (body.items.length > body.page_size) ctx.addIssue({ code: "custom", path: ["items"], message: "more than a page" });
  });

/** Whether a restore's re-check is still to finish: the figures are read again once it has. */
export function recheckUnderWay(recheck: RestoreRecheck | null): boolean {
  return recheck !== null && (recheck.state === "queued" || recheck.state === "running");
}

export type IgnorePreviewRequest = z.output<typeof ignorePreviewRequestSchema>;
export type IgnoreRequest = z.output<typeof ignoreRequestSchema>;
export type RestoreRequest = z.output<typeof restoreRequestSchema>;
export type IgnorePreview = z.output<typeof ignorePreviewSchema>;
export type IgnoreResult = z.output<typeof ignoreResultSchema>;
export type RestoreRecheck = z.output<typeof restoreRecheckSchema>;
export type RestoreResult = z.output<typeof restoreResultSchema>;
export type IgnoreRecord = z.output<typeof ignoreRecordSchema>;
export type IgnoredPage = z.output<typeof ignoredPageSchema>;
