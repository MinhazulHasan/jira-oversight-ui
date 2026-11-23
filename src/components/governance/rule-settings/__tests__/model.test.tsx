import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { renderKit } from "@/components/ui/__tests__/kit";
import { NumberField, readNumber, stepValue } from "@/components/ui/number-field";
import { Switch } from "@/components/ui/switch";
import { ruleSettingsSchema, type RuleSettings, type RuleSettingsApply, type RuleSettingsHistoryEntry } from "@/lib/api/schemas";

import settingsJson from "../../../../../docs/sample-responses/rule-settings.json";
import { APPLY_WORDS, SettingsStatus } from "../apply-status";
import {
  definitionKey,
  describeExample,
  EMPTY_FORM,
  firstProblem,
  formDraftRule,
  formFromAiDraft,
  formFromRule,
  formProblems,
  withCheck,
} from "../custom-rule-form";
import {
  appliesWords,
  blockingProblems,
  changeCount,
  crossRuleProblems,
  definitionWords,
  draftOf,
  draftProblems,
  editsOf,
  fieldBounds,
  fieldText,
  fieldValue,
  fieldWords,
  paramWords,
  placeWords,
  requestChanges,
  ruleChangeWords,
  settingsWords,
  undoChanges,
  numberParams,
  ONE_CHANGE_WORDS,
  undoneIn,
  type Draft,
  type NewRule,
} from "../model";
import { newRuleImpacts } from "../review-dialog";

import { BUGS, twoRules, UNTOUCHED } from "./custom-board";

/*
 * The rule settings page's arithmetic (JO-15), and the two controls it adds to
 * the kit: a threshold's field, read leniently and stepped as a native number
 * field steps, and the On/Off switch. JO-20 adds a board's own rules: the
 * changes a custom rule's draft makes, their undo and words, and the "New
 * rule" sheet's form.
 */

const settings = ruleSettingsSchema.parse(settingsJson);
const rules = settings.rules;
const saved = draftOf(settings);
const param = (ruleId: string, name: string) => numberParams(rules.find((rule) => rule.rule_id === ruleId)!).find((candidate) => candidate.name === name)!;

/** The saved draft with one rule's fields replaced. */
function drafted(ruleId: string, change: Partial<Draft[string]>): Draft {
  return { ...saved, [ruleId]: { ...saved[ruleId], ...change, params: { ...saved[ruleId].params, ...change.params } } };
}

describe("a threshold's field", () => {
  it("shows a share as a whole percentage and reads it back as a fraction; everything else as it travels", () => {
    const share = param("W-SPR-01", "not_started_share");
    expect(fieldText(share, 0.3)).toBe("30");
    expect(fieldValue(share, "35")).toBe(0.35);
    expect(fieldBounds(share)).toEqual({ min: 5, max: 95, step: 5 });
    const ratio = param("R-EFF-01", "threshold");
    expect(fieldText(ratio, 1.5)).toBe("1.5");
    expect(fieldValue(ratio, " 2,25 ")).toBe(2.25);
    expect(fieldValue(ratio, "2x")).toBeNull();
    expect(fieldValue(ratio, "")).toBeNull();
  });

  it("says each value in its unit's words", () => {
    expect(paramWords({ unit: "ratio" }, 1.5, "en-GB")).toBe("1.5×");
    expect(paramWords({ unit: "hours" }, 0.5, "en-GB")).toBe("0.5 h");
    // A percentile as the share of finished work it is above, never "p90" (SQA).
    expect(paramWords({ unit: "percentile" }, 90, "en-GB")).toBe("90%");
    expect(paramWords({ unit: "days" }, 1, "en-GB")).toBe("1 day");
    expect(paramWords({ unit: "days" }, 2.5, "en-GB")).toBe("2.5 days");
    expect(paramWords({ unit: "share" }, 0.35, "en-GB")).toBe("35%");
    expect(paramWords({ unit: "ratio" }, 1234.5, "de-DE")).toBe("1.234,5×");
  });
});

describe("the draft", () => {
  it("counts a field as changed only when its value is, however it is typed", () => {
    expect(editsOf(rules, saved, drafted("R-EFF-01", { params: { threshold: "1.50" } }))).toEqual([]);
    expect(editsOf(rules, saved, drafted("R-EFF-01", { params: { threshold: "2" } }))).toEqual([{ ruleId: "R-EFF-01", field: "params.threshold" }]);
    expect(editsOf(rules, saved, drafted("R-EFF-01", { params: { threshold: "" } }))).toEqual([{ ruleId: "R-EFF-01", field: "params.threshold" }]);
    expect(editsOf(rules, saved, drafted("W-AGE-01", { enabled: false, severity: "breach" }))).toEqual([
      { ruleId: "W-AGE-01", field: "enabled" },
      { ruleId: "W-AGE-01", field: "severity" },
    ]);
  });

  it("sends each rule's changed fields, and a rule set back to the catalogue as a reset", () => {
    const draft = drafted("W-SPR-01", { params: { not_started_share: "40" } });
    expect(requestChanges(rules, saved, draft)).toEqual([{ rule_id: "W-SPR-01", params: { not_started_share: 0.4 } }]);
    // The board had made R-EFF-01 its own (2×); the draft puts the catalogue's back.
    const own = { ...saved, "R-EFF-01": { ...saved["R-EFF-01"], params: { threshold: "2" } } };
    const customised = rules.map((rule) => (rule.rule_id === "R-EFF-01" ? { ...rule, customised: true, params: rule.params.map((p) => (p.kind === "number" ? { ...p, value: 2 } : p)) } : rule));
    expect(requestChanges(customised, own, saved)).toEqual([{ rule_id: "R-EFF-01", reset: true }]);
    expect(requestChanges(rules, saved, saved)).toEqual([]);
  });
});

describe("what holds a save back", () => {
  it("is a problem in a field the draft changes, never one in a field left as it was", () => {
    // rules.yaml set W-AGE-01's percentile outside the bounds: said where it stands, but no other change is held back.
    const outside = rules.map((rule) => (rule.rule_id === "W-AGE-01" ? { ...rule, params: rule.params.map((p) => (p.kind === "number" ? { ...p, value: 40, default: 40 } : p)) } : rule));
    const base = draftOf({ rules: outside });
    const draft: Draft = { ...base, "R-EST-02": { ...base["R-EST-02"], severity: "breach" } };
    expect([...blockingProblems(outside, base, draft, "en-GB").keys()]).toEqual([]);
    const moved = { ...draft, "W-AGE-01": { ...draft["W-AGE-01"], params: { pct: "45" } } };
    expect([...blockingProblems(outside, base, moved, "en-GB")]).toEqual([["W-AGE-01.params.pct", "Must be from 50% to 99%."]]);
  });

  it("is the cross-rule rule for a pair the draft touches, said on the threshold moved, or on the warning's", () => {
    const warning = drafted("W-EFF-01", { params: { threshold: "1.5" } });
    expect([...crossRuleProblems(rules, warning, { base: saved, locale: "en-GB" })]).toEqual([
      ["W-EFF-01.params.threshold", "Must stay below R-EFF-01's 1.5× while both are on: the warning comes first."],
    ]);
    const breach = drafted("R-EFF-01", { params: { threshold: "0.8" } });
    expect([...crossRuleProblems(rules, breach, { base: saved, locale: "en-GB" })]).toEqual([
      ["R-EFF-01.params.threshold", "Must stay above W-EFF-01's 0.8× while both are on."],
    ]);
    // Turning the breach back on beside a warning already at its level: said on the warning's threshold.
    const both = { ...breach, "R-EFF-01": { ...breach["R-EFF-01"], params: { threshold: "1.5" }, enabled: true }, "W-EFF-01": warning["W-EFF-01"] };
    const before = { ...both, "R-EFF-01": { ...both["R-EFF-01"], enabled: false } };
    expect([...crossRuleProblems(rules, both, { base: before, locale: "en-GB" }).keys()]).toEqual(["W-EFF-01.params.threshold"]);
    // A pair the draft leaves alone is never held against another change.
    expect(crossRuleProblems(rules, { ...warning, "R-EST-02": { ...warning["R-EST-02"], enabled: false } }, { base: warning, locale: "en-GB" }).size).toBe(0);
  });
});

describe("the history's words", () => {
  const entry: RuleSettingsHistoryEntry = {
    change_id: "a".repeat(32),
    at: "2026-11-04T14:31:00.000Z",
    revision: 2,
    by: { hash: "local", name: "Local (sign-in off)" },
    reason: null,
    undo_of: null,
    changes: [
      { rule_id: "W-AGE-01", field: "enabled", from: true, to: false },
      { rule_id: "W-SPR-01", field: "params.days_left", from: 2, to: 3 },
      { rule_id: "W-SPR-01", field: "params.not_started_share", from: 0.3, to: 0.4 },
      { rule_id: "R-EST-02", field: "severity", from: "warning", to: "breach" },
    ],
  };

  it("say each field and its values plainly", () => {
    expect(fieldWords(rules, entry.changes[0], "en-GB")).toEqual({ label: "On this board", from: "On", to: "Off" });
    expect(fieldWords(rules, entry.changes[1], "en-GB")).toEqual({ label: "Days left in the sprint", from: "2 days", to: "3 days" });
    expect(fieldWords(rules, entry.changes[2], "en-GB")).toEqual({ label: "Share of issues not started", from: "30%", to: "40%" });
    expect(fieldWords(rules, entry.changes[3], "en-GB")).toEqual({ label: "Severity", from: "Warning", to: "Breach" });
  });

  it("undo each field back to what it was, one change per rule", () => {
    expect(undoChanges(entry)).toEqual([
      { rule_id: "W-AGE-01", enabled: true },
      { rule_id: "W-SPR-01", params: { days_left: 2, not_started_share: 0.3 } },
      { rule_id: "R-EST-02", severity: "warning" },
    ]);
    const undo = { ...entry, change_id: "b".repeat(32), revision: 3, undo_of: entry.change_id };
    expect(undoneIn([undo, entry], entry)).toBe(3);
    expect(undoneIn([undo, entry], undo)).toBeNull();
  });

  it("name where a refusal stands: the rule by id and title, and its field by label; nothing for a place no rule's", () => {
    expect(placeWords(rules, "R-EFF-01.params.threshold")).toEqual({ ruleId: "R-EFF-01", title: "Effort far beyond the estimate", label: "Effort ratio" });
    expect(placeWords(rules, "W-AGE-01.enabled")).toEqual({ ruleId: "W-AGE-01", title: "Stuck in a status", label: "On this board" });
    expect(placeWords(rules, "R-EST-02.severity")?.label).toBe("Severity");
    // The rule as a whole, its thresholds as a whole, or a key its change does not take: the rule alone.
    for (const path of ["R-EFF-01", "R-EFF-01.params", "R-EFF-01.title", "R-EFF-01.rule_id"]) expect(placeWords(rules, path)?.label, path).toBeNull();
    expect(placeWords(rules, "reason")).toBeNull();
    expect(placeWords(rules, "(settings)")).toBeNull();
  });
});

describe("the number field", () => {
  function Field({ onChange = () => {} }: { onChange?: (value: string) => void }) {
    const [value, setValue] = useState("1.5");
    return (
      <NumberField
        label="Effort ratio"
        value={value}
        onValueChange={(next) => {
          setValue(next);
          onChange(next);
        }}
        min={0.1}
        max={10}
        step={0.05}
        suffix="×"
      />
    );
  }

  it("is a spin button with its bounds, stepped by the arrow keys (ten steps with Shift, or a page), and Home and End", async () => {
    const user = userEvent.setup();
    renderKit(<Field />);
    const input = screen.getByRole("spinbutton", { name: "Effort ratio" });
    expect(input).toHaveAttribute("aria-valuemin", "0.1");
    expect(input).toHaveAttribute("aria-valuemax", "10");
    expect(input).toHaveAttribute("aria-valuenow", "1.5");
    await user.click(input);
    await user.keyboard("{ArrowUp}");
    expect(input).toHaveValue("1.55");
    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
    expect(input).toHaveValue("1.05");
    await user.keyboard("{PageUp}");
    expect(input).toHaveValue("1.55");
    await user.keyboard("{End}");
    expect(input).toHaveValue("10");
    await user.keyboard("{ArrowUp}");
    expect(input).toHaveValue("10");
    await user.keyboard("{Home}");
    expect(input).toHaveValue("0.1");
  });

  it("holds the text as typed, and says nothing of a value it cannot read", async () => {
    const changed = vi.fn();
    const user = userEvent.setup();
    renderKit(<Field onChange={changed} />);
    const input = screen.getByRole("spinbutton", { name: "Effort ratio" });
    await user.clear(input);
    await user.type(input, "abc");
    expect(input).toHaveValue("abc");
    expect(input).not.toHaveAttribute("aria-valuenow");
    expect(changed).toHaveBeenLastCalledWith("abc");
  });

  it("steps onto the grid its step makes, never past the bounds, and reads a decimal comma", () => {
    const bounds = { min: 0.1, max: 10, step: 0.05 };
    expect(stepValue(1.52, 1, 1, bounds)).toBe(1.55);
    expect(stepValue(1.52, -1, 1, bounds)).toBe(1.5);
    expect(stepValue(null, 1, 1, bounds)).toBe(0.1);
    expect(stepValue(9.99, 1, 10, bounds)).toBe(10);
    expect(stepValue(30, 1, 1, { min: 5, max: 95, step: 5 })).toBe(35);
    expect(readNumber("1,5")).toBe(1.5);
    expect(readNumber(".5")).toBe(0.5);
    expect(readNumber("1.5.2")).toBeNull();
    expect(readNumber("1e3")).toBeNull();
  });
});

describe("the switch", () => {
  it("is a switch named by what labels it, which Space toggles", async () => {
    function On() {
      const [checked, setChecked] = useState(true);
      return <Switch checked={checked} onCheckedChange={setChecked} label="Stuck in a status: on this board" />;
    }
    const user = userEvent.setup();
    renderKit(<On />);
    const toggle = screen.getByRole("switch", { name: "Stuck in a status: on this board" });
    expect(toggle).toBeChecked();
    toggle.focus();
    await user.keyboard(" ");
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    expect(toggle).toBeChecked();
  });
});

describe("where the settings stand", () => {
  function status(apply: Partial<RuleSettingsApply>): RuleSettings {
    const change = { change_id: "a".repeat(32), at: "2026-11-04T14:31:00.000Z", revision: 1, by: { hash: "local", name: "Local (sign-in off)" }, reason: null, undo_of: null, changes: [{ rule_id: "W-AGE-01", field: "enabled", from: true, to: false }] };
    return {
      ...settings,
      revision: 1,
      updated_at: change.at,
      updated_by: change.by.name,
      apply: { state: "pending", applied_revision: 0, started_at: null, finished_at: null, message: null, result: null, ...apply },
      history: [change],
    };
  }

  it("says in a chip whether the findings reflect them, with what the re-check did or why it could not", () => {
    expect(APPLY_WORDS).toEqual({ applied: "Applied", running: "Re-checking…", pending: "Will apply at the next sync", failed: "Couldn't re-check" });
    const pending = "The board's findings still show its earlier settings until the next sync applies these.";
    const { rerender } = renderKit(<SettingsStatus settings={status({ state: "pending", message: pending })} boardName="Demo project" />);
    const region = document.querySelector<HTMLElement>("[data-settings-status]")!;
    expect(region.querySelector("[data-apply]")).toHaveTextContent("Will apply at the next sync");
    expect(region).toHaveTextContent(pending);
    rerender(<SettingsStatus settings={status({ state: "failed", message: "The re-check failed: the next sync applies the settings anyway." })} boardName="Demo project" />);
    expect(region.querySelector("[data-apply]")).toHaveTextContent("Couldn't re-check");
    expect(region).toHaveTextContent("The re-check failed: the next sync applies the settings anyway.");
    rerender(<SettingsStatus settings={status({ state: "applied", applied_revision: 1, result: { opened: 2, closed: 5 } })} boardName="Demo project" />);
    expect(region.querySelector("[data-apply]")).toHaveTextContent("Applied");
    expect(region).toHaveTextContent("5 closed, 2 opened");
    expect(region).toHaveAttribute("role", "status");
    // Never an email address, an account id or a zone's name: the board, the revision, the time on the 12-hour clock, a name.
    // Date first, as every time on screen reads (SQA).
    expect(region.textContent).toMatch(/Revision 1 · , last changed .+\d{4}, \d{1,2}:\d{2}\s[AP]M by Local \(sign-in off\)/);
    expect(region.textContent).not.toMatch(/GMT|UTC|BST|Europe\//);
  });
});

describe("a board's own rules (JO-20)", () => {
  const custom = twoRules();
  const own = custom.rules;
  const savedOwn = draftOf(custom);
  const checks = custom.checks;
  const checkNamed = (name: string) => checks.find((check) => check.name === name)!;
  const added: NewRule = {
    key: "draft-1",
    rule: {
      enabled: true,
      severity: "warning",
      params: { days: "45" },
      custom: { title: "Open over 45 days", description: "", check: "open_longer_than", choices: {}, categories: ["indeterminate"], issueTypes: null },
    },
  };

  it("sends a definition edited as an edit, a deletion as a delete, and new rules last, in the order added", () => {
    const draft: Draft = {
      ...savedOwn,
      "R-EFF-01": { ...savedOwn["R-EFF-01"], params: { threshold: "2" } },
      "R-CUS-01": { ...savedOwn["R-CUS-01"], params: { hours: "96" }, custom: { ...savedOwn["R-CUS-01"].custom!, title: "Bugs in review" } },
    };
    const extras = { added: [added], deleted: ["W-CUS-01"] };
    expect(requestChanges(own, savedOwn, draft, extras, checks)).toEqual([
      { rule_id: "R-EFF-01", params: { threshold: 2 } },
      { op: "edit", rule_id: "R-CUS-01", title: "Bugs in review", params: { hours: 96 } },
      { op: "delete", rule_id: "W-CUS-01" },
      {
        op: "create",
        rule: { title: "Open over 45 days", check: "open_longer_than", params: { days: 45 }, applies_to: { status_category: ["indeterminate"], issue_type: null }, severity: "warning" },
      },
    ]);
    // A rule marked for deletion counts once, whatever its fields say, and holds nothing back.
    const deleting = { ...draft, "W-CUS-01": { ...savedOwn["W-CUS-01"], enabled: false, custom: { ...savedOwn["W-CUS-01"].custom!, title: "Gone" } } };
    const edits = editsOf(own, savedOwn, deleting, extras);
    expect(edits).toEqual([
      { ruleId: "R-EFF-01", field: "params.threshold" },
      { ruleId: "R-CUS-01", field: "title" },
      { ruleId: "R-CUS-01", field: "params.hours" },
    ]);
    expect(changeCount(edits, extras)).toBe(5);
    expect(blockingProblems(own, savedOwn, deleting, "en-GB", extras).size).toBe(0);
  });

  it("holds a save back while a custom rule's definition and its switch or severity change in one draft: a save changes it one way", () => {
    const edited = { ...savedOwn["R-CUS-01"], custom: { ...savedOwn["R-CUS-01"].custom!, title: "Bugs in review" } };
    for (const both of [{ ...edited, enabled: false }, { ...edited, severity: "warning" as const }]) {
      const draft: Draft = { ...savedOwn, "R-CUS-01": both };
      expect([...blockingProblems(own, savedOwn, draft, "en-GB")]).toEqual([["R-CUS-01.enabled", ONE_CHANGE_WORDS]]);
      expect(draftProblems(own, draft, { base: savedOwn }).get("R-CUS-01.enabled")).toBe(ONE_CHANGE_WORDS);
    }
    expect(ONE_CHANGE_WORDS).toBe("Save the edit first, then change its On/Off or severity.");
    // Its numbers alone travel with its switch, as any rule's thresholds do.
    const numbers: Draft = { ...savedOwn, "R-CUS-01": { ...savedOwn["R-CUS-01"], enabled: false, params: { hours: "96" } } };
    expect(blockingProblems(own, savedOwn, numbers, "en-GB").size).toBe(0);
    expect(requestChanges(own, savedOwn, numbers)).toEqual([{ rule_id: "R-CUS-01", enabled: false, params: { hours: 96 } }]);
  });

  it("sends a custom rule's switch or severity alone as any rule's setting, and a choice changed as an edit", () => {
    const off: Draft = { ...savedOwn, "R-CUS-01": { ...savedOwn["R-CUS-01"], enabled: false, severity: "warning" } };
    expect(requestChanges(own, savedOwn, off)).toEqual([{ rule_id: "R-CUS-01", enabled: false, severity: "warning" }]);
    const statuses: Draft = {
      ...savedOwn,
      "R-CUS-01": { ...savedOwn["R-CUS-01"], custom: { ...savedOwn["R-CUS-01"].custom!, choices: { statuses: ["To Do", "In Progress"] } } },
    };
    expect(requestChanges(own, savedOwn, statuses)).toEqual([{ op: "edit", rule_id: "R-CUS-01", params: { statuses: ["To Do", "In Progress"] } }]);
    expect(editsOf(own, savedOwn, statuses)).toEqual([{ ruleId: "R-CUS-01", field: "params.statuses" }]);
  });

  it("undoes a rule added by deleting it, one deleted by bringing it back, and an edit by editing it back", () => {
    expect(undoChanges({ changes: [{ rule_id: "R-CUS-01", field: "rule", from: null, to: BUGS }] })).toEqual([{ op: "delete", rule_id: "R-CUS-01" }]);
    expect(undoChanges({ changes: [{ rule_id: "W-CUS-01", field: "rule", from: UNTOUCHED, to: null }] })).toEqual([{ op: "restore", rule_id: "W-CUS-01" }]);
    const edited: Parameters<typeof undoChanges>[0] = {
      changes: [
        { rule_id: "R-CUS-01", field: "title", from: BUGS.title, to: "Bugs in review" },
        { rule_id: "R-CUS-01", field: "description", from: null, to: "Why it matters." },
        { rule_id: "R-CUS-01", field: "params.statuses", from: ["In Progress"], to: ["To Do"] },
        { rule_id: "R-CUS-01", field: "params.hours", from: 72, to: 96 },
        { rule_id: "R-CUS-01", field: "applies_to", from: BUGS.applies_to, to: { status_category: ["new"], issue_type: null } },
      ],
    };
    expect(undoChanges(edited)).toEqual([
      {
        op: "edit",
        rule_id: "R-CUS-01",
        title: BUGS.title,
        description: null,
        applies_to: BUGS.applies_to,
        params: { statuses: ["In Progress"], hours: 72 },
      },
    ]);
    // Its switch and a number changed in one save (a setting change): set back the same way.
    const switched: Parameters<typeof undoChanges>[0] = {
      changes: [
        { rule_id: "R-CUS-01", field: "enabled", from: true, to: false },
        { rule_id: "R-CUS-01", field: "params.hours", from: 72, to: 96 },
      ],
    };
    expect(undoChanges(switched)).toEqual([{ rule_id: "R-CUS-01", enabled: true, params: { hours: 72 } }]);
  });

  it("say a rule added, deleted or brought back in a sentence, with its definition in a line", () => {
    expect(ruleChangeWords({ from: null, to: BUGS })).toBe("Added rule “Bugs in progress over 3 days”");
    expect(ruleChangeWords({ from: null, to: BUGS }, { restore: true })).toBe("Brought back rule “Bugs in progress over 3 days”");
    expect(ruleChangeWords({ from: UNTOUCHED, to: null })).toBe("Deleted rule “Untouched for 10 days”");
    // In an undo's question, what the undo will do (the change it makes: the one undone, the other way round).
    expect(ruleChangeWords({ from: BUGS, to: null }, { undo: true })).toBe("Deletes rule “Bugs in progress over 3 days”");
    expect(ruleChangeWords({ from: null, to: UNTOUCHED }, { undo: true })).toBe("Brings back rule “Untouched for 10 days”");
    expect(ruleChangeWords({ from: true, to: false })).toBeNull();
    expect(definitionWords(BUGS, checks, "en-GB")).toBe("Time in a status · Stays in “In Progress” for over 3 days · Bug · In progress · Breach");
    expect(definitionWords(UNTOUCHED, checks, "en-GB")).toBe("No updates · No change in Jira for 10 days · All types · In progress · Warning");
  });

  it("say a custom rule's own fields by their labels, and a new rule's refusal by its name", () => {
    expect(fieldWords(own, { rule_id: "R-CUS-01", field: "title", from: "Bugs", to: "Bugs in review" })).toEqual({ label: "Name", from: "“Bugs”", to: "“Bugs in review”" });
    expect(fieldWords(own, { rule_id: "R-CUS-01", field: "description", from: null, to: "Why." })).toEqual({ label: "Description", from: "None", to: "“Why.”" });
    expect(
      fieldWords(own, { rule_id: "R-CUS-01", field: "applies_to", from: BUGS.applies_to, to: { status_category: ["new", "indeterminate"], issue_type: null } }),
    ).toEqual({ label: "Applies to", from: "Bug · In progress", to: "All types · To do and In progress" });
    expect(fieldWords(own, { rule_id: "R-CUS-01", field: "params.statuses", from: ["In Progress"], to: ["To Do", "In Progress"] })).toEqual({
      label: "Statuses",
      from: "In Progress",
      to: "To Do and In Progress",
    });
    expect(placeWords(own, "R-CUS-01.title")).toEqual({ ruleId: "R-CUS-01", title: "Bugs in progress over 3 days", label: "Name" });
    expect(placeWords(own, "draft-1.title", [added])).toEqual({ ruleId: "New", title: "Open over 45 days", label: "Name" });
    expect(placeWords(own, "draft-2.title", [added])).toBeNull();
  });

  it("say a check's settings as its row reads them", () => {
    expect(settingsWords("time_in_status_over", { statuses: ["To Do", "In Progress"], hours: 36 }, undefined, "en-GB")).toBe("Stays in “To Do” or “In Progress” for over 36 h");
    expect(settingsWords("open_longer_than", { days: 1 }, undefined, "en-GB")).toBe("Open for over 1 day");
    expect(settingsWords("missing_field", { field: "epic" }, checkNamed("missing_field"))).toBe("No epic");
    expect(settingsWords("missing_field", { field: "sprint" }, checkNamed("missing_field"))).toBe("In no sprint");
    expect(settingsWords("effort_ratio_at_least", { threshold: 2 }, undefined, "en-GB")).toBe("Effort ≥ 2× the estimate");
    expect(settingsWords("sprint_at_risk", { days_left: 2, not_started_share: 0.3 }, undefined, "en-GB")).toBe("≤ 2 days left and > 30% not started");
    expect(settingsWords("reopened", {})).toBe("");
    expect(appliesWords({ status_category: [], issue_type: null }, "sprint")).toBe("The active sprint");
  });

  it("match the preview's new rules to the draft's in the order the request lists them", () => {
    const impact = (ruleId: string) => ({ rule_id: ruleId, measurable: true, open_now: 0, would_open: 1, would_close: 0, would_stay: 0, examples: { open: [], close: [] }, note: null });
    const second: NewRule = { ...added, key: "draft-2" };
    const matched = newRuleImpacts([impact("R-EFF-01"), impact("R-CUS-03"), impact("W-CUS-02")], own, [added, second]);
    expect([...matched].map(([ruleId, item]) => [ruleId, item.key])).toEqual([
      ["R-CUS-03", "draft-1"],
      ["W-CUS-02", "draft-2"],
    ]);
  });
});

describe("the New rule form (JO-20)", () => {
  const custom = twoRules();
  const checks = custom.checks;
  const checkNamed = (name: string) => checks.find((check) => check.name === name)!;
  const onBoard = { checks, issueTypes: custom.issue_types, rules: custom.rules.map((rule) => ({ rule_id: rule.rule_id, title: rule.title })) };

  it("sets a check's settings to its defaults when it is picked, and a sprint's rule to look at no statuses or types", () => {
    expect(withCheck(EMPTY_FORM, checkNamed("time_in_status_over"))).toMatchObject({
      check: "time_in_status_over",
      numbers: { hours: "72" },
      choices: { statuses: [] },
      categories: ["indeterminate"],
    });
    expect(withCheck(EMPTY_FORM, checkNamed("missing_field"))).toMatchObject({ choices: { field: "assignee" }, categories: ["indeterminate"] });
    expect(withCheck({ ...EMPTY_FORM, issueTypes: ["Bug"] }, checkNamed("sprint_at_risk"))).toMatchObject({
      numbers: { days_left: "2", not_started_share: "30" },
      categories: [],
      issueTypes: null,
    });
  });

  it("takes the AI's draft as the admin would have typed it, and leaves a check the board does not offer unpicked", () => {
    const drafted = {
      title: "Bugs in review",
      description: null,
      check: "time_in_status_over",
      params: { statuses: ["In Progress"] },
      applies_to: { status_category: ["indeterminate" as const], issue_type: ["Bug"] },
      severity: "warning" as const,
    };
    expect(formFromAiDraft(drafted, checks)).toMatchObject({
      title: "Bugs in review",
      check: "time_in_status_over",
      // A param the draft left out takes the check's default.
      numbers: { hours: "72" },
      choices: { statuses: ["In Progress"] },
      categories: ["indeterminate"],
      issueTypes: ["Bug"],
      severity: "warning",
    });
    expect(formFromAiDraft({ ...drafted, check: "velocity_drop" }, checks)).toMatchObject({ title: "Bugs in review", check: "", numbers: {}, severity: "warning" });
  });

  it("says what is wrong at each field, a number's own problem first, and the focus goes to the first the form asks for", () => {
    expect([...formProblems(EMPTY_FORM, onBoard, {}, "en-GB")]).toEqual([
      ["title", "Give it a name of 3 to 80 characters."],
      ["check", "Pick what to check."],
    ]);
    const timed = { ...withCheck({ ...EMPTY_FORM, title: "bugs in progress over 3 DAYS" }, checkNamed("time_in_status_over")), numbers: { hours: "0" } };
    const problems = formProblems(timed, onBoard, {}, "en-GB");
    expect([...problems]).toEqual([
      ["params.hours", "Must be from 1 h to 8,760 h."],
      ["title", "Another rule on this board has this name."],
      ["params.statuses", "Pick at least one status."],
    ]);
    expect(firstProblem(problems, checkNamed("time_in_status_over"))).toBe("title");
    const later = new Map([
      ["description", "x"],
      ["params.hours", "y"],
      ["params.statuses", "z"],
    ]);
    expect(firstProblem(later, checkNamed("time_in_status_over"))).toBe("params.statuses");
    // Its own name is no clash when a rule is edited.
    const fine = { ...timed, title: BUGS.title, numbers: { hours: "72" }, choices: { statuses: ["In Progress"] } };
    expect(formProblems(fine, onBoard, { ruleId: "R-CUS-01" }, "en-GB").size).toBe(0);
  });

  it("tells a change to what the rule flags from a change to its name, description or seriousness", () => {
    const check = checkNamed("time_in_status_over");
    const drafted = { ...withCheck({ ...EMPTY_FORM, title: "Bugs in progress too long" }, check), choices: { statuses: ["In Progress"] } };
    const key = definitionKey(drafted, check);
    expect(definitionKey({ ...drafted, title: "Bugs stuck in progress", description: "Why", severity: "warning" }, check)).toBe(key);
    // A number is the same number however it is typed.
    expect(definitionKey({ ...drafted, numbers: { hours: "72.0" } }, check)).toBe(key);
    for (const changed of [
      { numbers: { hours: "48" } },
      { numbers: { hours: "" } },
      { choices: { statuses: ["To Do"] } },
      { categories: ["new", "indeterminate"] as const },
      { issueTypes: ["Bug"] },
    ]) {
      expect(definitionKey({ ...drafted, ...changed }, check), JSON.stringify(changed)).not.toBe(key);
    }
  });

  it("offers a request to draft from on the board's own names", () => {
    expect(describeExample(checks, custom.issue_types)).toBe("Bugs in progress for more than 3 days");
    const statuses = [
      { value: "To Do", label: "To Do", category: "new" as const },
      { value: "Code Review", label: "Code Review", category: "indeterminate" as const },
      { value: "In Progress", label: "In Progress", category: "indeterminate" as const },
    ];
    const reviewing = checks.map((check) =>
      check.name === "time_in_status_over" ? { ...check, params: check.params.map((param) => (param.kind === "statuses" ? { ...param, options: statuses } : param)) } : check,
    );
    expect(describeExample(reviewing, ["Story", "Bug"])).toBe("Bugs in Code Review for more than 3 days");
    expect(describeExample(reviewing, ["Story", "Task"])).toBe("Tickets in Code Review for more than 3 days");
    // A board that offers no status: a request any board can draft from.
    expect(describeExample([], ["Task"])).toBe("Tickets open for more than 30 days");
  });

  it("puts the form in the draft trimmed, and reads a rule in the draft back into the form", () => {
    const rule = formDraftRule({ ...EMPTY_FORM, title: "  Reopened bugs ", description: "  ", check: "reopened", categories: ["done"] });
    expect(rule).toEqual({
      enabled: true,
      severity: "breach",
      params: {},
      custom: { title: "Reopened bugs", description: "", check: "reopened", choices: {}, categories: ["done"], issueTypes: null },
    });
    expect(formFromRule(rule)).toEqual({ ...EMPTY_FORM, title: "Reopened bugs", check: "reopened", categories: ["done"] });
  });
});
