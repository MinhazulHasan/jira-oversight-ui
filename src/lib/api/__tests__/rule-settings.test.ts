import { describe, expect, it } from "vitest";

import findingsJson from "../../../../docs/sample-responses/findings.json";
import previewJson from "../../../../docs/sample-responses/rule-settings-preview.json";
import settingsJson from "../../../../docs/sample-responses/rule-settings.json";
import rulesJson from "../../../../docs/sample-responses/rules.json";
import {
  API_ERROR_CODES,
  findingSchema,
  REASON_EMAIL_REMOVED,
  RULE_PARAM_REGISTRY,
  RULE_SETTINGS_REASON_MAX,
  ruleSchema,
  ruleSettingsChangeSchema,
  ruleSettingsFieldChangeSchema,
  ruleSettingsPreviewRequestSchema,
  ruleSettingsPreviewSchema,
  ruleSettingsSaveRequestSchema,
  ruleSettingsSchema,
  rulesSchema,
  SIGNED_IN_USER,
  withinDecimals,
  type RuleSettings,
  type RuleSettingsPreview,
} from "../schemas";

/*
 * The JO-15 contract: the bodies the page sends (held to the service's bounds
 * before anything is forwarded) and the three answers it reads, each refusing
 * a body that contradicts itself.
 */

const settings = ruleSettingsSchema.parse(settingsJson);
const preview = ruleSettingsPreviewSchema.parse(previewJson);

/** The documented settings with a change on top: revision 1, by an admin, R-EFF-01's threshold moved to 2. */
function changed(overrides: Partial<RuleSettings> = {}): unknown {
  const entry = {
    change_id: "a".repeat(32),
    at: "2026-11-04T14:31:00.000Z",
    revision: 1,
    by: { hash: "b".repeat(32), name: "Morgan Ellis" },
    reason: "Agreed with the team",
    undo_of: null,
    changes: [{ rule_id: "R-EFF-01", field: "params.threshold", from: 1.5, to: 2 }],
  };
  const rules = settings.rules.map((rule) =>
    rule.rule_id === "R-EFF-01" ? { ...rule, customised: true, params: rule.params.map((param) => ({ ...param, value: 2 })) } : rule,
  );
  return {
    ...settings,
    revision: 1,
    updated_at: entry.at,
    updated_by: entry.by.name,
    apply: { state: "applied", applied_revision: 1, started_at: entry.at, finished_at: entry.at, message: null, result: { opened: 0, closed: 4 } },
    rules,
    history: [entry],
    ...overrides,
  };
}

const issuePaths = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  result.success ? [] : (result.error?.issues ?? []).map((issue) => issue.path.map(String).join("."));

describe("the thresholds an admin may change (JO-15, section 1)", () => {
  it("are the registry's, with the service's bounds and steps", () => {
    const bounds = Object.fromEntries(
      Object.entries(RULE_PARAM_REGISTRY).map(([check, specs]) => [check, specs.map(({ name, min, max, step }) => [name, min, max, step])]),
    );
    expect(bounds).toEqual({
      estimate_after_start: [["grace_hours", 0, 168, 0.5]],
      effort_ratio_at_least: [["threshold", 0.1, 10, 0.05]],
      stuck_in_status: [["pct", 50, 99, 1]],
      no_evidence_after_percentile: [["pct", 50, 99, 1]],
      sprint_at_risk: [
        ["days_left", 0, 14, 0.5],
        ["not_started_share", 0.05, 0.95, 0.05],
      ],
    });
  });

  it("are finite numbers within the bounds, both ends included, with at most four decimals", () => {
    const change = (threshold: unknown) => ruleSettingsChangeSchema.safeParse({ rule_id: "R-EFF-01", params: { threshold } });
    for (const value of [0.1, 10, 1.5, 1.2345, 0.35]) expect(change(value).success, String(value)).toBe(true);
    for (const value of [0.09, 10.01, 1.23456, Number.NaN, Number.POSITIVE_INFINITY, "2", true, null]) {
      expect(change(value).success, String(value)).toBe(false);
    }
    const out = ruleSettingsChangeSchema.safeParse({ rule_id: "W-SPR-01", params: { not_started_share: 0.99 } });
    expect(out.success ? null : out.error.issues[0].message).toBe("Must be from 0.05 to 0.95.");
    expect(withinDecimals(0.3)).toBe(true);
    expect(withinDecimals(0.1 + 0.2)).toBe(true);
    expect(withinDecimals(1.00001)).toBe(false);
  });

  it("are only the registry's: a structural param (a stage, an evidence source) is never one", () => {
    expect(issuePaths(ruleSettingsChangeSchema.safeParse({ rule_id: "W-REV-01", params: { stage: 3 } }))).toEqual(["params.stage"]);
    expect(issuePaths(ruleSettingsChangeSchema.safeParse({ rule_id: "W-REV-01", params: { pct: 80 } }))).toEqual([]);
  });
});

describe("a change, as the page sends it", () => {
  it("names a rule and any of on or off, the severity and thresholds; or a reset alone", () => {
    expect(ruleSettingsChangeSchema.safeParse({ rule_id: "W-AGE-01", enabled: false }).success).toBe(true);
    expect(ruleSettingsChangeSchema.safeParse({ rule_id: "R-EST-02", severity: "breach", params: { grace_hours: 2 } }).success).toBe(true);
    expect(ruleSettingsChangeSchema.safeParse({ rule_id: "R-EFF-01", reset: true }).success).toBe(true);
    expect(issuePaths(ruleSettingsChangeSchema.safeParse({ rule_id: "R-EFF-01", reset: true, enabled: true }))).toEqual(["reset"]);
    expect(issuePaths(ruleSettingsChangeSchema.safeParse({ rule_id: "R-EFF-01" }))).toEqual([""]);
    expect(issuePaths(ruleSettingsChangeSchema.safeParse({ rule_id: "R-EFF-01", params: {} }))).toEqual(["params"]);
    expect(ruleSettingsChangeSchema.safeParse({ rule_id: "R-EFF-01", severity: "info" }).success).toBe(false);
    expect(ruleSettingsChangeSchema.safeParse({ rule_id: "R-EFF-01", enabled: "yes" }).success).toBe(false);
    expect(ruleSettingsChangeSchema.safeParse({ rule_id: "EFF", enabled: true }).success).toBe(false);
    // Strict: a field the contract does not name is refused, never passed on.
    expect(ruleSettingsChangeSchema.safeParse({ rule_id: "R-EFF-01", enabled: true, title: "x" }).success).toBe(false);
  });

  it("comes one per rule, at least one, in a preview that names nothing else", () => {
    const one = { rule_id: "R-EFF-01", params: { threshold: 2 } };
    expect(ruleSettingsPreviewRequestSchema.safeParse({ changes: [one] }).success).toBe(true);
    expect(issuePaths(ruleSettingsPreviewRequestSchema.safeParse({ changes: [] }))).toEqual(["changes"]);
    expect(issuePaths(ruleSettingsPreviewRequestSchema.safeParse({ changes: [one, { ...one, params: { threshold: 3 } }] }))).toEqual([
      "changes.1.rule_id",
    ]);
    expect(ruleSettingsPreviewRequestSchema.safeParse({ changes: [one], revision: 0 }).success).toBe(false);
    expect(ruleSettingsPreviewRequestSchema.safeParse({ changes: Array.from({ length: 65 }, () => one) }).success).toBe(false);
  });

  it("is saved against a revision, with an optional reason of at most 500 characters and no email address, and an undo's change id", () => {
    const save = (body: Record<string, unknown>) => ruleSettingsSaveRequestSchema.safeParse({ revision: 3, changes: [{ rule_id: "W-AGE-01", enabled: false }], ...body });
    expect(save({}).success).toBe(true);
    expect(save({ reason: null }).success).toBe(true);
    expect(save({ reason: "é".repeat(RULE_SETTINGS_REASON_MAX) }).success).toBe(true);
    // Characters as the service counts them: an emoji is one, though JavaScript's length says two.
    expect(save({ reason: "📈".repeat(RULE_SETTINGS_REASON_MAX) }).success).toBe(true);
    expect(issuePaths(save({ reason: "x".repeat(RULE_SETTINGS_REASON_MAX + 1) }))).toEqual(["reason"]);
    expect(issuePaths(save({ reason: "Agreed with lead@example.org" }))).toEqual(["reason"]);
    expect(save({ undo_of: "c".repeat(32) }).success).toBe(true);
    expect(issuePaths(save({ undo_of: "not-a-change" }))).toEqual(["undo_of"]);
    expect(issuePaths(save({ revision: -1 }))).toEqual(["revision"]);
    expect(issuePaths(save({ revision: 1.5 }))).toEqual(["revision"]);
    expect(save({ project: "DEMO" }).success).toBe(false);
  });
});

describe("GET /rules/settings and a save's answer", () => {
  it("parse the documented body exactly: revision 0, applied, every catalogue rule, no history", () => {
    expect(ruleSettingsSchema.parse(settingsJson)).toStrictEqual(settingsJson);
    expect(settings.revision).toBe(0);
    expect(settings.apply.state).toBe("applied");
    expect(settings.rules.map((rule) => rule.rule_id)).toEqual((rulesJson as { rules: { rule_id: string }[] }).rules.map((rule) => rule.rule_id));
    expect(settings.history).toEqual([]);
  });

  it("say when and by whom exactly when the settings were changed, and the newest change is the board's revision", () => {
    expect(ruleSettingsSchema.safeParse(changed()).success).toBe(true);
    expect(issuePaths(ruleSettingsSchema.safeParse(changed({ updated_at: null })))).toContain("updated_at");
    expect(issuePaths(ruleSettingsSchema.safeParse(changed({ revision: 2, apply: { ...settings.apply, applied_revision: 2 } })))).toContain(
      "history.0.revision",
    );
    const twice = changed() as RuleSettings;
    const older = { ...twice.history[0], change_id: "d".repeat(32), revision: 2 };
    expect(issuePaths(ruleSettingsSchema.safeParse({ ...twice, history: [twice.history[0], older] }))).toContain("history.1.revision");
  });

  it("hold the apply state to the revision applied: applied once it is reached, pending until then", () => {
    const at = (state: string, applied: number) =>
      ruleSettingsSchema.safeParse(changed({ apply: { state, applied_revision: applied, started_at: null, finished_at: null, message: null, result: null } as never }));
    expect(at("applied", 1).success).toBe(true);
    expect(at("applied", 0).success).toBe(false);
    expect(at("pending", 0).success).toBe(true);
    expect(at("pending", 1).success).toBe(false);
    expect(at("running", 0).success).toBe(true);
    expect(at("failed", 0).success).toBe(true);
  });

  it("refuse a rule that says it is customised when nothing differs from the catalogue, or a rule listed twice", () => {
    const [first, ...rest] = settings.rules;
    expect(issuePaths(ruleSettingsSchema.safeParse({ ...settings, rules: [{ ...first, customised: true }, ...rest] }))).toContain("rules.0.customised");
    expect(issuePaths(ruleSettingsSchema.safeParse({ ...settings, rules: [first, first, ...rest] }))).toContain("rules.1.rule_id");
  });

  it("pass on a value rules.yaml set outside the bounds (the page says so), but not bounds that cross", () => {
    const outside = settings.rules.map((rule) =>
      rule.rule_id === "W-AGE-01" ? { ...rule, params: rule.params.map((param) => ({ ...param, value: 40, default: 40 })) } : rule,
    );
    expect(ruleSettingsSchema.safeParse({ ...settings, rules: outside }).success).toBe(true);
    const crossed = settings.rules.map((rule) =>
      rule.rule_id === "W-AGE-01" ? { ...rule, params: rule.params.map((param) => ({ ...param, min: 99, max: 50 })) } : rule,
    );
    expect(issuePaths(ruleSettingsSchema.safeParse({ ...settings, rules: crossed }))).toContain("rules.8.params.0.max");
  });

  it("never carry an email address: a viewer named by one reads as a signed-in user, and one in a reason is taken out", () => {
    const body = changed() as RuleSettings;
    const entry = { ...body.history[0], by: { hash: "b".repeat(32), name: "lead@example.org" }, reason: "Asked by lead@example.org today" };
    const parsed = ruleSettingsSchema.parse({ ...body, updated_by: "lead@example.org", history: [entry] });
    expect(parsed.updated_by).toBe(SIGNED_IN_USER);
    expect(parsed.history[0].by.name).toBe(SIGNED_IN_USER);
    expect(parsed.history[0].reason).toBe(`Asked by ${REASON_EMAIL_REMOVED} today`);
    expect(JSON.stringify(parsed)).not.toContain("@");
  });

  it("record each field with its effective values before and after, of the field's own kind, and never a change that changes nothing", () => {
    const field = (change: Record<string, unknown>) => ruleSettingsFieldChangeSchema.safeParse({ rule_id: "R-EFF-01", ...change });
    expect(field({ field: "enabled", from: true, to: false }).success).toBe(true);
    expect(field({ field: "severity", from: "breach", to: "warning" }).success).toBe(true);
    expect(field({ field: "params.threshold", from: 1.5, to: 2 }).success).toBe(true);
    expect(field({ field: "enabled", from: 1, to: 0 }).success).toBe(false);
    expect(field({ field: "params.threshold", from: "1.5", to: 2 }).success).toBe(false);
    expect(field({ field: "params.threshold", from: 2, to: 2 }).success).toBe(false);
    // JO-20 adds a custom rule's own fields (its title, description, what it looks at, the rule as a whole); a field
    // no rule has is refused, and a param is one kind of value on both sides.
    expect(field({ field: "name", from: "a", to: "b" }).success).toBe(false);
    expect(field({ field: "params.statuses", from: ["To Do"], to: 3 }).success).toBe(false);
  });
});

describe("POST /rules/settings/preview's answer", () => {
  it("parses the documented body exactly: what each rule's open findings would do", () => {
    expect(ruleSettingsPreviewSchema.parse(previewJson)).toStrictEqual(previewJson);
    for (const impact of preview.impact) expect(impact.would_close + impact.would_stay).toBe(impact.open_now);
    expect(preview.totals.would_close).toBe(preview.impact.reduce((sum, impact) => sum + impact.would_close, 0));
  });

  it("refuses counts that do not add up, totals that are not the sum, a rule twice and examples that are not tickets or sprints", () => {
    const [impact] = preview.impact;
    const body = (change: Partial<RuleSettingsPreview>) => ruleSettingsPreviewSchema.safeParse({ ...preview, ...change });
    expect(issuePaths(body({ impact: [{ ...impact, would_stay: impact.would_stay + 1 }] }))).toContain("impact.0.would_stay");
    expect(issuePaths(body({ totals: { would_open: 1, would_close: 0 } }))).toContain("totals");
    expect(issuePaths(body({ impact: [impact, impact] }))).toContain("impact.1.rule_id");
    const examples = (keys: string[]) => body({ impact: [{ ...impact, examples: { open: keys, close: [] } }], totals: { ...preview.totals } });
    expect(issuePaths(examples(["DEMO-1", "sprint:26"]))).not.toContain("impact.0.examples.open.0");
    expect(issuePaths(examples(["https://jira.example/browse/DEMO-1"]))).toContain("impact.0.examples.open.0");
    expect(issuePaths(examples(["DEMO-1", "DEMO-2", "DEMO-3", "DEMO-4", "DEMO-5", "DEMO-6"]))).toContain("impact.0.examples.open");
  });
});

describe("the rest of the contract JO-15 touches", () => {
  it("GET /rules lists every rule with whether it runs on the board and whether its settings are the board's own", () => {
    const rules = rulesSchema.parse(rulesJson);
    expect(rules.rules.every((rule) => rule.enabled && !rule.customised)).toBe(true);
    const [first] = (rulesJson as { rules: Record<string, unknown>[] }).rules;
    const { enabled: _enabled, ...withoutEnabled } = first;
    expect(ruleSchema.safeParse(withoutEnabled).success).toBe(false);
    expect(ruleSchema.safeParse({ ...first, enabled: false, customised: true }).success).toBe(true);
  });

  it("a finding resolved because the rule settings changed says so, never as cleared", () => {
    const [open] = (findingsJson as { items: Record<string, unknown>[] }).items;
    const closed = { ...open, state: "resolved", resolved_at: "2026-11-04T14:31:00.000Z", resolved_why: "settings_changed" };
    expect(findingSchema.parse(closed).resolved_why).toBe("settings_changed");
    expect(findingSchema.safeParse({ ...closed, resolved_why: "aged_out" }).success).toBe(false);
  });

  it("the route's codes name a conflict, a refusal of settings and a change from elsewhere", () => {
    expect(API_ERROR_CODES).toEqual(expect.arrayContaining(["rule_settings_conflict", "rule_settings_invalid", "forbidden"]));
  });
});
