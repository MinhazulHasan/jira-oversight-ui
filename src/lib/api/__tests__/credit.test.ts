import { describe, expect, it } from "vitest";

import { peopleCreditSaveRequestSchema, peopleCreditSchema } from "../schemas";

const META = {
  data_mode: "live",
  last_synced_at: "2026-11-25T23:00:00Z",
  projects: ["MJHDASH"],
  rules_version: "0.1.0",
  process_version: "0.1.0",
  generated_at: "2026-11-26T09:00:00Z",
  report_timezone: "Europe/London",
};

const BODY = {
  meta: META,
  period: { days: 90, from: "2026-08-27T23:00:00Z", to: "2026-11-25T23:00:00Z" },
  setting: { source: "auto", field: null, revision: 0, changed_by: null, changed_at: null },
  effective_field: { key: "programmer", name: "Programmer" },
  finished: 475,
  options: [
    { source: "auto", field: null, source_filled: 124, credited: 471 },
    { source: "assignee", field: null, source_filled: 34, credited: 471 },
    { source: "field", field: { key: "programmer", name: "Programmer" }, source_filled: 124, credited: 471 },
    { source: "field", field: { key: "testers", name: "Testers" }, source_filled: 88, credited: 471 },
  ],
};

const problems = (body: unknown) => {
  const parsed = peopleCreditSchema.safeParse(body);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join("."));
};

describe("the credit setting's body", () => {
  it("takes the service's answer, and keeps no history of changes", () => {
    const parsed = peopleCreditSchema.parse({ ...BODY, history: [] });
    expect(parsed.setting).toEqual(BODY.setting);
    expect(parsed).not.toHaveProperty("history");
  });

  it("holds Automatic, then Assignee, then each field once; a field exactly with its source; who and when together", () => {
    expect(problems(BODY)).toEqual([]);
    expect(problems({ ...BODY, options: [BODY.options[1], BODY.options[0], ...BODY.options.slice(2)] })).toContain("options");
    expect(problems({ ...BODY, options: [...BODY.options, BODY.options[3]] })).toContain("options.4");
    expect(problems({ ...BODY, setting: { ...BODY.setting, source: "field" } })).toContain("setting.field");
    expect(problems({ ...BODY, setting: { ...BODY.setting, changed_by: "Morgan Ellis" } })).toContain("setting.changed_at");
    expect(problems({ ...BODY, setting: { ...BODY.setting, source: "assignee" } })).toContain("effective_field");
    expect(problems({ ...BODY, options: [{ ...BODY.options[0], credited: 476 }, ...BODY.options.slice(1)] })).toContain("options.0");
    expect(problems({ ...BODY, period: { ...BODY.period, days: 60 } })).toContain("period.days");
  });
});

describe("a change of the credit setting, as the page sends it", () => {
  it("is a source, a field's key exactly when the source is a field, and a revision; nothing else", () => {
    expect(peopleCreditSaveRequestSchema.parse({ source: "field", field: "programmer", revision: 2 })).toEqual({ source: "field", field: "programmer", revision: 2 });
    expect(peopleCreditSaveRequestSchema.parse({ source: "assignee", revision: 0 })).toEqual({ source: "assignee", field: null, revision: 0 });
    for (const body of [
      { source: "field", field: null, revision: 0 },
      { source: "auto", field: "programmer", revision: 0 },
      { source: "field", field: "Programmer", revision: 0 },
      { source: "nobody", field: null, revision: 0 },
      { source: "auto", field: null, revision: 1.5 },
      { source: "auto", field: null, revision: 0, by: "someone" },
    ]) {
      expect(peopleCreditSaveRequestSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });
});
