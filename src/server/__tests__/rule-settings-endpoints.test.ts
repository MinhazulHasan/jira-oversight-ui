// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resolveGet, resolvePost, RULE_SETTINGS_REFUSED, ruleSettingsPost, settingsProblemPath, type Resolution } from "../endpoints";

const none = new URLSearchParams();

function accepted(resolution: Resolution) {
  if (!resolution.ok) throw new Error(`refused: ${resolution.status} ${resolution.message}`);
  return resolution.value;
}

function refused(resolution: Resolution) {
  if (resolution.ok) throw new Error(`accepted: ${resolution.value.upstream}`);
  return resolution;
}

describe("GET rules/settings", () => {
  it("is the board's settings, at team level until the handler decides, with no parameters", () => {
    expect(accepted(resolveGet(["rules", "settings"], none))).toEqual({ route: { name: "rule_settings", level: "team" }, upstream: "rules/settings" });
    for (const query of ["project=AIL", "level=people", "revision=3"]) {
      const refusal = refused(resolveGet(["rules", "settings"], new URLSearchParams(query)));
      expect([refusal.status, refusal.error]).toEqual([400, "bad_request"]);
    }
    expect(refused(resolveGet(["rules", "settings", "preview"], none)).status).toBe(404);
  });
});

describe("POST rules/settings and rules/settings/preview", () => {
  it("are told apart by their path, and no other path under rules takes a body", () => {
    expect(ruleSettingsPost(["rules", "settings"])).toBe("rule_settings_save");
    expect(ruleSettingsPost(["rules", "settings", "preview"])).toBe("rule_settings_preview");
    for (const path of [["rules"], ["rules", "preview"], ["rules", "settings", "save"], ["rules", "settings", "preview", "x"]]) {
      expect(ruleSettingsPost(path)).toBeNull();
    }
    expect(refused(resolvePost(["rules", "settings", "save"], none, { changes: [] })).status).toBe(404);
    expect(refused(resolvePost(["rules"], none, { changes: [] })).status).toBe(404);
  });

  it("forward a preview's changes rebuilt from what was checked: what each change names, and nothing else", () => {
    const body = {
      changes: [
        { rule_id: "R-EFF-01", params: { threshold: 2 }, reset: false },
        { rule_id: "W-AGE-01", enabled: false },
        { rule_id: "R-EST-02", reset: true },
      ],
    };
    expect(accepted(resolvePost(["rules", "settings", "preview"], none, body))).toEqual({
      route: {
        name: "rule_settings_preview",
        level: "team",
        body: { changes: [{ rule_id: "R-EFF-01", params: { threshold: 2 } }, { rule_id: "W-AGE-01", enabled: false }, { rule_id: "R-EST-02", reset: true }] },
      },
      upstream: "rules/settings/preview",
    });
  });

  it("forward a save with its revision, its reason trimmed (left out when blank) and the change it undoes", () => {
    const changes = [{ rule_id: "R-EST-02", severity: "breach", params: { grace_hours: 2.5 } }];
    const save = (extra: Record<string, unknown>) => accepted(resolvePost(["rules", "settings"], none, { revision: 4, changes, ...extra }));
    expect(save({ reason: "  Agreed with the team  " }).route).toEqual({
      name: "rule_settings_save",
      level: "team",
      body: { revision: 4, changes, reason: "Agreed with the team" },
    });
    expect(save({ reason: "   " }).route).toMatchObject({ body: { revision: 4, changes } });
    expect(save({ reason: null }).route).toMatchObject({ body: { revision: 4, changes } });
    expect("reason" in (save({ reason: "   " }).route as { body: object }).body).toBe(false);
    expect(save({ undo_of: "f".repeat(32), reason: "Undo of revision 3" }).route).toMatchObject({
      body: { revision: 4, changes, reason: "Undo of revision 3", undo_of: "f".repeat(32) },
    });
    expect(save({}).upstream).toBe("rules/settings");
  });

  it("refuse a body the contract does not allow with 422 rule_settings_invalid, each problem at its setting", () => {
    const refusal = refused(
      resolvePost(["rules", "settings"], none, {
        revision: 2,
        changes: [
          { rule_id: "R-EFF-01", params: { threshold: 12 } },
          { rule_id: "W-SPR-01", reset: true, enabled: false },
          { rule_id: "R-EFF-01", enabled: false },
        ],
        reason: "x".repeat(501),
      }),
    );
    expect([refusal.status, refusal.error, refusal.message]).toEqual([422, "rule_settings_invalid", RULE_SETTINGS_REFUSED]);
    expect(refusal.issues).toEqual(
      expect.arrayContaining([
        { path: "R-EFF-01.params.threshold", message: "Must be from 0.1 to 10." },
        { path: "W-SPR-01.reset", message: expect.stringMatching(/goes alone/) },
        { path: "R-EFF-01.rule_id", message: "Is named twice: one change per rule." },
        { path: "reason", message: "is at most 500 characters" },
      ]),
    );
  });

  it("refuse what is not a change at all: no changes, no body, a field it does not know, a revision that is not a whole number", () => {
    for (const body of [{ revision: 0, changes: [] }, null, "changes", { revision: 0, changes: [{ rule_id: "R-EFF-01", enabled: true }], level: "people" }, { revision: "3", changes: [{ rule_id: "R-EFF-01", enabled: true }] }]) {
      const refusal = refused(resolvePost(["rules", "settings"], none, body));
      expect([refusal.status, refusal.error], JSON.stringify(body)).toEqual([422, "rule_settings_invalid"]);
    }
    expect(refused(resolvePost(["rules", "settings", "preview"], none, { changes: [{ rule_id: "R-EFF-01", enabled: true }], revision: 3 })).status).toBe(422);
  });

  it("take no query parameters: the board is the top bar's pick, never the address's", () => {
    const refusal = refused(resolvePost(["rules", "settings"], new URLSearchParams("project=AIL"), { revision: 0, changes: [{ rule_id: "W-AGE-01", enabled: false }] }));
    expect([refusal.status, refusal.error]).toEqual([400, "bad_request"]);
  });

  it("leave Ask and Sync now as they were", () => {
    expect(accepted(resolvePost(["ask"], none, { question: "Where do tickets get stuck most?" })).route.name).toBe("ask");
    expect(accepted(resolvePost(["refresh"], none, null)).route.name).toBe("refresh_start");
  });
});

describe("a problem's place", () => {
  it("is the rule a change names, then the field: 'R-EFF-01.params.threshold'; the request's own fields by name", () => {
    const body = { changes: [{ rule_id: "R-EFF-01" }, { rule_id: "W-SPR-01" }] };
    expect(settingsProblemPath(body, ["changes", 1, "params", "days_left"])).toBe("W-SPR-01.params.days_left");
    expect(settingsProblemPath(body, ["changes", 0])).toBe("R-EFF-01");
    expect(settingsProblemPath(body, ["reason"])).toBe("reason");
    expect(settingsProblemPath(body, [])).toBe("(settings)");
    // A change that names no rule well is placed by its index.
    expect(settingsProblemPath({ changes: [{ rule_id: "nope" }] }, ["changes", 0, "rule_id"])).toBe("changes.0.rule_id");
  });
});
