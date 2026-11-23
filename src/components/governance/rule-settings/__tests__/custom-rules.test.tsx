import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, configure, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { renderKit } from "@/components/ui/__tests__/kit";
import type { CustomRuleDefinition, RuleSettings, RuleSettingsChange, RuleSettingsSaveRequest } from "@/lib/api/schemas";
import { notify } from "@/lib/notify";

import draftJson from "../../../../../docs/sample-responses/rule-settings-draft.json";
import newRulePreviewJson from "../../../../../docs/sample-responses/rule-settings-preview-new-rule.json";
import { AddRuleButton, AddRuleProvider } from "../add-rule";
import { DRAFTED_WORDS_HINT } from "../custom-rule-sheet";
import { RuleSettingsView } from "../rule-settings-view";

import { board, BUGS, entry, ownRule, twoRules, UNTOUCHED } from "./custom-board";

/*
 * A board's own rules on the rule settings page (JO-20), against a stand-in
 * for the service that answers as the contract says: "Add rule" in the
 * header and the "New rule" sheet; the AI's draft of the admin's words, every
 * outcome of it said in a live region; the form checked at each field as the
 * service checks it; the rule in the draft as "New" until the review saves
 * it; a saved rule edited (its check locked) and deleted, each taken back
 * before saving; a refusal of a new rule put right in its sheet; and the
 * history's words and Undo for each.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/governance/rules",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const PROJECTS = {
  default: "DEMO",
  projects: [{ key: "DEMO", name: "Demo project", issues: 1150, last_synced_at: "2026-11-04T14:28:00.000Z", synced: true, type: "software" }],
};

/** A whole page, typed into key by key: under a full run's load, a sheet or a read may take a few seconds to arrive. */
const PAGE_TEST = { timeout: 30_000 };

beforeAll(() => {
  configure({ asyncUtilTimeout: 5_000 });
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
});

afterEach(() => {
  document.cookie = "jo-board=; max-age=0; path=/";
});

/* -------------------------------------------------------- the service --- */

type Answer = { status?: number; body: unknown };

interface Service {
  settings: RuleSettings;
  draft: (body: { text: string }) => Answer;
  preview: (body: { changes: RuleSettingsChange[] }) => Answer;
  save: (body: RuleSettingsSaveRequest) => Answer;
  calls: { method: string; path: string; body: unknown }[];
}

/** A draft that came to nothing: why, in the service's words. */
const undrafted = (outcome: "not_supported" | "not_understood" | "unavailable", note: string): Answer => ({
  body: { ...draftJson, outcome, draft: null, explanation: null, note, problems: [] },
});

/** The oversight route, answering from `settings`, and every call it was asked. */
function service(overrides: Partial<Omit<Service, "calls">> = {}): Service {
  const stand: Service = {
    settings: board([]),
    draft: () => ({ body: draftJson }),
    preview: () => ({ body: newRulePreviewJson }),
    save: () => ({ body: stand.settings }),
    calls: [],
    ...overrides,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const path = url.pathname.replace(/^\/api\/oversight\//, "");
      const method = init?.method ?? "GET";
      const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      stand.calls.push({ method, path, body });
      const answer: Answer =
        path === "projects"
          ? { body: PROJECTS }
          : path === "rules/settings" && method === "GET"
            ? { body: stand.settings }
            : path === "rules/settings/draft"
              ? stand.draft(body as { text: string })
              : path === "rules/settings/preview"
                ? stand.preview(body as { changes: RuleSettingsChange[] })
                : path === "rules/settings"
                  ? stand.save(body as RuleSettingsSaveRequest)
                  : { status: 404, body: { error: "not_found", message: "There is no such endpoint." } };
      return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200, headers: { "content-type": "application/json" } });
    }),
  );
  return stand;
}

const posted = (stand: Service, path: string) => stand.calls.filter((call) => call.method === "POST" && call.path === path).map((call) => call.body);
const reads = (stand: Service) => stand.calls.filter((call) => call.method === "GET" && call.path === "rules/settings").length;

/** The page as the app lays it out: "Add rule" in the header, the settings below it. */
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderKit(
    <QueryClientProvider client={client}>
      <AddRuleProvider>
        <header>
          <AddRuleButton />
        </header>
        <RuleSettingsView />
      </AddRuleProvider>
    </QueryClientProvider>,
  );
}

const row = (ruleId: string) => document.querySelector<HTMLElement>(`[data-rule="${ruleId}"]`)!;
const newRow = (key: string) => document.querySelector<HTMLElement>(`[data-new-rule="${key}"]`);
const bar = () => screen.queryByRole("region", { name: "Unsaved changes" });
const addRule = () => document.querySelector<HTMLButtonElement>("[data-add-rule]")!;

async function ready() {
  await screen.findByRole("heading", { name: "Hard and fast rules" });
  await waitFor(() => expect(addRule()).toBeEnabled());
}

/** The "New rule" sheet, from the header's "Add rule". */
async function openNewRule(user: ReturnType<typeof userEvent.setup>) {
  await user.click(addRule());
  return screen.findByRole("dialog", { name: "New rule" });
}

/** Picks an option from a list in the sheet: a Select's or a Combobox's, by the trigger's name. */
async function pick(user: ReturnType<typeof userEvent.setup>, sheet: HTMLElement, trigger: RegExp | string, option: string) {
  await user.click(within(sheet).getByRole(typeof trigger === "string" ? "combobox" : "button", { name: trigger }));
  await user.click(await screen.findByRole("option", { name: new RegExp(`^${option}`) }));
}

/* --------------------------------------------------------------- tests --- */

describe("adding a rule", PAGE_TEST, () => {
  it("drafts it with AI from the admin's words, puts it in the draft as New, previews what it would raise, and saves it as a create", async () => {
    const stand = service({
      save: (body) => {
        const create = body.changes[0] as { op: "create"; rule: CustomRuleDefinition };
        stand.settings = board([ownRule("R-CUS-01", create.rule, 2)], [entry(1, [{ rule_id: "R-CUS-01", field: "rule", from: null, to: create.rule }])]);
        return { body: stand.settings };
      },
    });
    const ok = vi.spyOn(notify, "ok");
    const user = userEvent.setup();
    renderPage();
    await ready();
    const custom = screen.getByRole("region", { name: /Custom rules/ });
    expect(custom).toHaveTextContent("No custom rules yet");

    const sheet = await openNewRule(user);
    expect(sheet).toHaveTextContent("For Demo project only. Nothing is saved until you review and save.");
    const status = within(sheet).getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("The AI fills in the form. You check it before adding it.");
    // The example to draft from is on the board's own names: DEMO has bugs, and In Progress, and no review status.
    const words = within(sheet).getByRole("textbox", { name: /Describe it/ });
    expect(words).toHaveAttribute("placeholder", "Bugs in progress for more than 3 days");
    await user.type(words, "  Bugs in progress for more than 3 days ");
    const before = reads(stand);
    await user.click(within(sheet).getByRole("button", { name: "Draft with AI" }));
    await waitFor(() => expect(status).toHaveTextContent("Drafted by AI. Check it before you add it."));
    expect(status).toHaveTextContent("Flags bugs that stay in progress for more than 3 days.");
    // The words as plain text, and nothing read again: a draft saves nothing.
    expect(posted(stand, "rules/settings/draft")).toEqual([{ text: "Bugs in progress for more than 3 days" }]);
    expect(reads(stand)).toBe(before);

    // The form as the AI filled it, for the admin to check.
    expect(within(sheet).getByRole("textbox", { name: "Name" })).toHaveValue("Bugs in progress too long");
    expect(within(sheet).getByRole("combobox", { name: "What to check" })).toHaveTextContent("Time in a status");
    expect(sheet).toHaveTextContent("Flags work that has sat in one of these statuses past the limit.");
    expect(within(sheet).getByRole("button", { name: "Statuses In Progress" })).toBeInTheDocument();
    expect(sheet).not.toHaveTextContent("The board's own statuses.");
    expect(within(sheet).getByRole("spinbutton", { name: "Time in the status" })).toHaveValue("72");
    expect(sheet).toHaveTextContent("From 1 h to 8,760 h. That is 3 days.");
    expect(within(sheet).getByRole("checkbox", { name: "In progress" })).toBeChecked();
    expect(within(sheet).getByRole("checkbox", { name: "To do" })).not.toBeChecked();
    expect(within(sheet).getByRole("button", { name: "Issue types Bug" })).toBeInTheDocument();
    expect(within(sheet).getByRole("radio", { name: "Breach" })).toBeChecked();

    await user.click(within(sheet).getByRole("button", { name: "Add to changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "New rule" })).toBeNull());
    // The focus is back on the button that opened the sheet.
    await waitFor(() => expect(addRule()).toHaveFocus());
    expect(ok).toHaveBeenCalledWith("Rule added to your changes", expect.objectContaining({ description: "Review and save to add it to Demo project." }));
    const fresh = newRow("draft-1")!;
    expect(fresh).toHaveTextContent(/^Custom New\s*Bugs in progress too long\s*Time in a status/);
    expect(fresh).toHaveTextContent("Stays in “In Progress” for over 3 days");
    expect(fresh).toHaveTextContent("Bug · In progress");
    expect(bar()).toHaveTextContent("1 unsaved change");

    await user.click(within(bar()!).getByRole("button", { name: "Review and save" }));
    const dialog = await screen.findByRole("dialog", { name: "Review and save" });
    expect(dialog).toHaveTextContent("1 change to Demo project’s rule settings.");
    const listed = dialog.querySelector<HTMLElement>('[data-change-new="draft-1"]')!;
    expect(listed).toHaveTextContent("New rule Bugs in progress too long");
    expect(listed).toHaveTextContent(/What it checks\s*Time in a status/);
    expect(listed).toHaveTextContent(/Settings\s*Stays in “In Progress” for over 3 days/);
    expect(listed).toHaveTextContent(/Applies to\s*Bug · In progress/);
    expect(listed).toHaveTextContent(/Reported as\s*Breach/);
    const create = { op: "create", rule: { title: draftJson.draft.title, check: BUGS.check, params: BUGS.params, applies_to: BUGS.applies_to, severity: "breach" } };
    expect(posted(stand, "rules/settings/preview")).toEqual([{ changes: [create] }]);
    const impact = (await within(dialog).findByRole("table")).querySelector<HTMLElement>('[data-impact="draft-1"]')!;
    expect(impact).toHaveTextContent("New Bugs in progress too long");
    expect(impact).toHaveTextContent("Would raise 2 findings now.");

    await user.click(within(dialog).getByRole("button", { name: "Save and re-check" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review and save" })).toBeNull());
    expect(posted(stand, "rules/settings")).toEqual([{ revision: 0, changes: [create] }]);
    // Saved: the rule has its id, its badge and its check, and the history says it was added.
    await waitFor(() => expect(row("R-CUS-01")).not.toBeNull());
    expect(row("R-CUS-01")).toHaveTextContent("R-CUS-01 Custom");
    expect(row("R-CUS-01")).toHaveTextContent("Time in a status");
    expect(newRow("draft-1")).toBeNull();
    expect(bar()).toBeNull();
    const added = document.querySelector<HTMLElement>('[data-revision="1"] [data-rule-change="R-CUS-01"]')!;
    expect(added).toHaveTextContent("R-CUS-01 Added rule “Bugs in progress too long”");
    expect(added).toHaveTextContent("Time in a status · Stays in “In Progress” for over 3 days · Bug · In progress · Breach");
  });

  it("says what came of each draft in a live region, and leaves the form as it was when nothing was drafted", async () => {
    const stand = service({
      draft: ({ text }) => {
        if (text.startsWith("What")) return undrafted("not_supported", 'No check can test that. The closest is "Time in a status".');
        if (text.startsWith("Bugs")) return undrafted("not_understood", "Say what a ticket must not do, and for how long.");
        if (text.startsWith("Tickets")) return undrafted("unavailable", "Today's AI budget is used up. You can still add a rule by hand.");
        return { status: 503, body: { error: "upstream_unavailable", message: "The oversight service cannot be reached right now." } };
      },
    });
    const user = userEvent.setup();
    renderPage();
    await ready();
    const sheet = await openNewRule(user);
    const describe = within(sheet).getByRole("textbox", { name: /Describe it/ });
    const status = within(sheet).getByRole("status");
    await user.type(within(sheet).getByRole("textbox", { name: "Name" }), "My own rule");

    // Too short to draft from: said, and nothing sent.
    await user.type(describe, "ab");
    await user.click(within(sheet).getByRole("button", { name: "Draft with AI" }));
    expect(status).toHaveTextContent("Write at least 3 characters to draft from.");
    expect(describe).toHaveAttribute("aria-invalid", "true");
    expect(describe).toHaveFocus();
    expect(posted(stand, "rules/settings/draft")).toEqual([]);
    // Words that name someone never go to the AI: said, and nothing sent; typing again clears it.
    for (const text of ["Tickets assigned to sam@example.com open 3 days", "Work of 5b10ac8d82e05b22cc7d4ef5 in review"]) {
      await user.clear(describe);
      await user.type(describe, text);
      await user.click(within(sheet).getByRole("button", { name: "Draft with AI" }));
      expect(status).toHaveTextContent("Leave out email addresses and account IDs.");
      expect(describe).toHaveAttribute("aria-invalid", "true");
    }
    await user.type(describe, " ");
    expect(status).not.toHaveTextContent("Leave out email addresses");
    expect(posted(stand, "rules/settings/draft")).toEqual([]);

    const draftFrom = async (text: string) => {
      await user.clear(describe);
      await user.type(describe, text);
      await user.click(within(sheet).getByRole("button", { name: "Draft with AI" }));
    };
    await draftFrom("What is the weather in London?");
    await waitFor(() => expect(status).toHaveTextContent("Can't make that rule."));
    expect(status).toHaveTextContent('No check can test that. The closest is "Time in a status".');
    await draftFrom("Bugs bugs bugs");
    await waitFor(() => expect(status).toHaveTextContent("Didn't understand that."));
    expect(status).toHaveTextContent("Say what a ticket must not do, and for how long.");
    await draftFrom("Tickets reopened twice");
    await waitFor(() => expect(status).toHaveTextContent("AI drafts aren't available right now."));
    // The service's note says the rule can still be added by hand: said once, never twice.
    expect(status).toHaveTextContent(/^AI drafts aren't available right now\.\s*Today's AI budget is used up\. You can still add a rule by hand\.$/);
    await draftFrom("Something else entirely");
    await waitFor(() => expect(status).toHaveTextContent("Couldn’t draft the rule. The oversight service cannot be reached right now."));
    expect(posted(stand, "rules/settings/draft")).toHaveLength(4);
    // Nothing was drafted, so the form is the admin's still.
    expect(within(sheet).getByRole("textbox", { name: "Name" })).toHaveValue("My own rule");
    expect(within(sheet).getByRole("combobox", { name: "What to check" })).toHaveTextContent("Pick a check");

    // ⌘↵ in the description drafts, as the button does.
    await user.clear(describe);
    await user.type(describe, "What is a sprint?");
    fireEvent.keyDown(describe, { key: "Enter", metaKey: true });
    await waitFor(() => expect(posted(stand, "rules/settings/draft")).toHaveLength(5));
  });

  it("says each problem the AI's draft still has at its field, and holds Add to changes until it is put right", async () => {
    service({
      draft: () => ({
        body: {
          ...draftJson,
          draft: { ...draftJson.draft, params: { statuses: [], hours: 72 } },
          explanation: "Flags bugs that stay in Code Review for more than 3 days.",
          problems: [{ field: "params.statuses", message: "Pick at least one status." }],
        },
      }),
    });
    const user = userEvent.setup();
    renderPage();
    await ready();
    const sheet = await openNewRule(user);
    await user.type(within(sheet).getByRole("textbox", { name: /Describe it/ }), "Bugs in Code Review for more than 3 days");
    await user.click(within(sheet).getByRole("button", { name: "Draft with AI" }));
    const status = within(sheet).getByRole("status");
    await waitFor(() => expect(status).toHaveTextContent("Drafted by AI. Check it before you add it. 1 field needs a fix."));
    const statuses = within(sheet).getByRole("button", { name: "Statuses Pick one or more" });
    expect(statuses).toHaveAttribute("aria-invalid", "true");
    expect(sheet.querySelector("[data-field-problem]")).toHaveTextContent("Pick at least one status.");

    await user.click(within(sheet).getByRole("button", { name: "Add to changes" }));
    expect(screen.getByRole("dialog", { name: "New rule" })).toBeInTheDocument();
    expect(statuses).toHaveFocus();
    expect(bar()).toBeNull();

    // Put right: the problem goes with the change, and the rule can be added.
    await user.click(statuses);
    await user.click(await screen.findByRole("option", { name: /^In Progress/ }));
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(within(sheet).getByRole("button", { name: "Statuses In Progress" })).not.toHaveAttribute("aria-invalid");
    expect(sheet.querySelector("[data-field-problem]")).toBeNull();
    await user.click(within(sheet).getByRole("button", { name: "Add to changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "New rule" })).toBeNull());
    expect(newRow("draft-1")).toHaveTextContent("Stays in “In Progress” for over 3 days");
  });

  it("says when the rule has changed since the AI drafted it: the AI's explanation goes, and words still the AI's ask to be checked", async () => {
    service({
      draft: () => ({ body: { ...draftJson, draft: { ...draftJson.draft, title: "Bugs in progress over 3 days", description: "For bugs that wait too long." } } }),
    });
    const user = userEvent.setup();
    renderPage();
    await ready();
    const sheet = await openNewRule(user);
    await user.type(within(sheet).getByRole("textbox", { name: /Describe it/ }), "Bugs in progress for more than 3 days");
    await user.click(within(sheet).getByRole("button", { name: "Draft with AI" }));
    const status = within(sheet).getByRole("status");
    await waitFor(() => expect(status).toHaveTextContent("Drafted by AI. Check it before you add it."));
    expect(status).toHaveTextContent(draftJson.explanation);
    const name = within(sheet).getByRole("textbox", { name: "Name" });
    const description = within(sheet).getByRole("textbox", { name: /Description/ });
    // How serious it is changes nothing it flags: the explanation still holds.
    await user.click(within(sheet).getByRole("radio", { name: "Warning" }));
    expect(status).not.toHaveTextContent("then changed");
    expect(name).not.toHaveAccessibleDescription(DRAFTED_WORDS_HINT);

    // Two days, not three: what the AI said no longer holds, and the name and description in its words say "3 days".
    const hours = within(sheet).getByRole("spinbutton", { name: "Time in the status" });
    await user.clear(hours);
    await user.type(hours, "48");
    expect(status).toHaveTextContent(/^Drafted by AI, then changed\. Check it before you add it\.$/);
    expect(name).toHaveAccessibleDescription(DRAFTED_WORDS_HINT);
    expect(description).toHaveAccessibleDescription(DRAFTED_WORDS_HINT);
    // Put in the admin's own words: nothing more to check there.
    await user.clear(name);
    await user.type(name, "Bugs in progress over 2 days");
    expect(name).not.toHaveAccessibleDescription(DRAFTED_WORDS_HINT);
    expect(description).toHaveAccessibleDescription(DRAFTED_WORDS_HINT);
    // Back to the limit the AI drafted: as drafted again.
    await user.clear(hours);
    await user.type(hours, "72");
    expect(status).toHaveTextContent(`Drafted by AI. Check it before you add it. ${draftJson.explanation}`);
    expect(description).not.toHaveAccessibleDescription(DRAFTED_WORDS_HINT);
  });

  it("says what the draft flags once: not beside the description box when the AI wrote the same words as the rule's description", async () => {
    const sentence = "Flags bugs In Progress for more than 3 days.";
    service({ draft: () => ({ body: { ...draftJson, draft: { ...draftJson.draft, description: sentence }, explanation: sentence } }) });
    const user = userEvent.setup();
    renderPage();
    await ready();
    const sheet = await openNewRule(user);
    await user.type(within(sheet).getByRole("textbox", { name: /Describe it/ }), "Bugs in progress for more than 3 days");
    await user.click(within(sheet).getByRole("button", { name: "Draft with AI" }));
    const status = within(sheet).getByRole("status");
    await waitFor(() => expect(status).toHaveTextContent("Drafted by AI. Check it before you add it."));
    expect(status).not.toHaveTextContent(sentence);
    expect(within(sheet).getByRole("textbox", { name: /Description/ })).toHaveValue(sentence);
  });

  it("takes a draft the service could not put right as the model left it: empty fields at their problems, the rest said with it", async () => {
    service({
      draft: () => ({
        body: {
          ...draftJson,
          draft: { title: null, description: null, check: null, params: { hours: true }, applies_to: { status_category: [], issue_type: null }, severity: null },
          explanation: null,
          problems: [
            { field: "title", message: "Give it a name of 3 to 80 characters." },
            { field: "check", message: "Pick what to check." },
            { field: "rule", message: "This board already has 50 custom rules." },
          ],
        },
      }),
    });
    const user = userEvent.setup();
    renderPage();
    await ready();
    const sheet = await openNewRule(user);
    await user.type(within(sheet).getByRole("textbox", { name: /Describe it/ }), "Something the model half drafted");
    await user.click(within(sheet).getByRole("button", { name: "Draft with AI" }));
    const status = within(sheet).getByRole("status");
    await waitFor(() => expect(status).toHaveTextContent("Drafted by AI. Check it before you add it. 2 fields need a fix."));
    expect(status).toHaveTextContent("This board already has 50 custom rules.");
    const name = within(sheet).getByRole("textbox", { name: "Name" });
    expect(name).toHaveValue("");
    expect(name).toHaveAccessibleDescription("Give it a name of 3 to 80 characters.");
    expect(within(sheet).getByRole("combobox", { name: "What to check" })).toHaveAccessibleDescription("Pick what to check.");
    expect(within(sheet).getByRole("radio", { name: "Breach" })).toBeChecked();
    await user.click(within(sheet).getByRole("button", { name: "Add to changes" }));
    expect(name).toHaveFocus();
  });

  it("sets a rule up by hand when the AI is off, checking each field as the service would, and adds it as a warning", async () => {
    const stand = service({ settings: board([], [], { ai_draft: { available: false, reason: "Today's AI budget is used up. You can still add a rule by hand." } }) });
    const user = userEvent.setup();
    renderPage();
    await ready();
    // The empty list's own "Add rule" opens the same sheet.
    await user.click(document.querySelector<HTMLButtonElement>("[data-add-rule-empty]")!);
    const sheet = await screen.findByRole("dialog", { name: "New rule" });
    expect(within(sheet).queryByRole("textbox", { name: /Describe it/ })).toBeNull();
    expect(sheet.querySelector("[data-ai-off]")).toHaveTextContent(/^Today's AI budget is used up\. You can still add a rule by hand\.$/);

    // Nothing filled in: each field says what it needs, and the first takes the focus.
    await user.click(within(sheet).getByRole("button", { name: "Add to changes" }));
    const name = within(sheet).getByRole("textbox", { name: "Name" });
    expect(name).toHaveFocus();
    expect(name).toHaveAccessibleDescription("Give it a name of 3 to 80 characters.");
    expect(within(sheet).getByRole("combobox", { name: "What to check" })).toHaveAccessibleDescription("Pick what to check.");

    // A name another rule on the board has.
    await user.type(name, "stuck in a status");
    expect(name).toHaveAccessibleDescription("Another rule on this board has this name.");
    await user.clear(name);
    await user.type(name, "Open over 45 days");
    expect(name).not.toHaveAttribute("aria-invalid");

    // A check picked sets its settings to their defaults, and the categories it looks at.
    await pick(user, sheet, "What to check", "Open too long");
    const days = within(sheet).getByRole("spinbutton", { name: "Days open" });
    expect(days).toHaveValue("30");
    expect(within(sheet).getByRole("checkbox", { name: "To do" })).toBeChecked();
    expect(within(sheet).getByRole("checkbox", { name: "In progress" })).toBeChecked();
    expect(within(sheet).queryByRole("checkbox", { name: "Done" })).toBeNull();
    expect(within(sheet).getByRole("button", { name: "Issue types All types" })).toBeInTheDocument();
    expect(sheet).toHaveTextContent("All types leaves out Epics.");
    await user.clear(days);
    await user.type(days, "0");
    await user.tab();
    expect(days).toHaveAccessibleDescription("Must be from 1 day to 3,650 days.");
    await user.clear(days);
    await user.type(days, "45");
    await user.click(within(sheet).getByRole("checkbox", { name: "To do" }));
    await user.click(within(sheet).getByRole("checkbox", { name: "In progress" }));
    await user.click(within(sheet).getByRole("button", { name: "Add to changes" }));
    expect(within(sheet).getByRole("checkbox", { name: "To do" })).toHaveFocus();
    expect(sheet).toHaveTextContent("Pick at least one of To do, In progress and Done.");
    await user.click(within(sheet).getByRole("checkbox", { name: "In progress" }));
    await user.click(within(sheet).getByRole("radio", { name: "Warning" }));
    await user.type(within(sheet).getByRole("textbox", { name: /Description/ }), "Work open too long.");
    await user.click(within(sheet).getByRole("button", { name: "Add to changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "New rule" })).toBeNull());
    // The empty list's button went with the list: the header's takes the focus.
    await waitFor(() => expect(addRule()).toHaveFocus());

    await user.click(within(bar()!).getByRole("button", { name: "Review and save" }));
    await screen.findByRole("dialog", { name: "Review and save" });
    expect(posted(stand, "rules/settings/preview")).toEqual([
      {
        changes: [
          {
            op: "create",
            rule: {
              title: "Open over 45 days",
              description: "Work open too long.",
              check: "open_longer_than",
              params: { days: 45 },
              applies_to: { status_category: ["indeterminate"], issue_type: null },
              severity: "warning",
            },
          },
        ],
      },
    ]);
  });

  it("goes back to Add rule when the sheet is cancelled or closed with Escape, and keeps nothing", async () => {
    service();
    const user = userEvent.setup();
    renderPage();
    await ready();
    let sheet = await openNewRule(user);
    await user.type(within(sheet).getByRole("textbox", { name: "Name" }), "Half a rule");
    await user.click(within(sheet).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "New rule" })).toBeNull());
    await waitFor(() => expect(addRule()).toHaveFocus());
    expect(bar()).toBeNull();

    sheet = await openNewRule(user);
    // Each opening is a fresh form.
    expect(within(sheet).getByRole("textbox", { name: "Name" })).toHaveValue("");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "New rule" })).toBeNull());
    await waitFor(() => expect(addRule()).toHaveFocus());
  });

  it("holds Add rule back once the board holds its 50 custom rules, saying why", async () => {
    service({ settings: board([], [], { custom_count: 50 }) });
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { name: "Hard and fast rules" });
    await waitFor(() => expect(addRule()).toHaveAttribute("aria-disabled", "true"));
    await user.click(addRule());
    expect(screen.queryByRole("dialog", { name: "New rule" })).toBeNull();
    // Why, in its tooltip, as the keyboard reaches it.
    act(() => {
      addRule().blur();
      addRule().focus();
    });
    expect(await screen.findByRole("tooltip")).toHaveTextContent("This board has 50 custom rules, the most it holds. Delete one first.");
  });
});

describe("a new rule before it is saved", PAGE_TEST, () => {
  it("is edited in its sheet and discarded from its row, the focus kept on the page", async () => {
    const stand = service();
    const ok = vi.spyOn(notify, "ok");
    const info = vi.spyOn(notify, "info");
    const user = userEvent.setup();
    renderPage();
    await ready();
    let sheet = await openNewRule(user);
    await user.type(within(sheet).getByRole("textbox", { name: /Describe it/ }), "Bugs in progress for more than 3 days");
    await user.click(within(sheet).getByRole("button", { name: "Draft with AI" }));
    await waitFor(() => expect(within(sheet).getByRole("textbox", { name: "Name" })).toHaveValue("Bugs in progress too long"));
    await user.click(within(sheet).getByRole("button", { name: "Add to changes" }));
    await waitFor(() => expect(newRow("draft-1")).not.toBeNull());

    const edit = within(newRow("draft-1")!).getByRole("button", { name: /^Edit/ });
    await user.click(edit);
    sheet = await screen.findByRole("dialog", { name: "Edit rule" });
    expect(within(sheet).getByRole("textbox", { name: "Name" })).toHaveValue("Bugs in progress too long");
    await user.click(within(sheet).getByRole("radio", { name: "Warning" }));
    await user.click(within(sheet).getByRole("button", { name: "Add to changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit rule" })).toBeNull());
    await waitFor(() => expect(edit).toHaveFocus());
    expect(ok).toHaveBeenLastCalledWith("New rule changed", expect.anything());
    expect(newRow("draft-1")).toHaveTextContent("Warning");
    expect(bar()).toHaveTextContent("1 unsaved change");

    await user.click(within(newRow("draft-1")!).getByRole("button", { name: /^Discard/ }));
    expect(newRow("draft-1")).toBeNull();
    expect(bar()).toBeNull();
    expect(document.querySelector("[data-settings-status]")).toHaveFocus();
    expect(info).toHaveBeenLastCalledWith("New rule discarded", expect.anything());
    expect(posted(stand, "rules/settings/preview")).toEqual([]);
  });

  it("is put right in its sheet when the service refuses one of its fields, from the review", async () => {
    const stand = service({
      preview: () => ({
        status: 422,
        body: {
          error: "rule_settings_invalid",
          message: "The oversight service refused these rule settings.",
          issues: [{ path: "new-0.title", message: "Another rule on this board has this name." }],
        },
      }),
    });
    const user = userEvent.setup();
    renderPage();
    await ready();
    let sheet = await openNewRule(user);
    await user.type(within(sheet).getByRole("textbox", { name: /Describe it/ }), "Bugs in progress for more than 3 days");
    await user.click(within(sheet).getByRole("button", { name: "Draft with AI" }));
    await waitFor(() => expect(within(sheet).getByRole("textbox", { name: "Name" })).toHaveValue("Bugs in progress too long"));
    await user.click(within(sheet).getByRole("button", { name: "Add to changes" }));
    await waitFor(() => expect(newRow("draft-1")).not.toBeNull());

    await user.click(within(bar()!).getByRole("button", { name: "Review and save" }));
    const dialog = await screen.findByRole("dialog", { name: "Review and save" });
    const refusal = await within(dialog).findByRole("alert");
    expect(refusal).toHaveTextContent("New Bugs in progress too long · Name: Another rule on this board has this name.");
    await user.click(within(refusal).getByRole("button", { name: "Edit the new rule" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review and save" })).toBeNull());
    sheet = await screen.findByRole("dialog", { name: "Edit rule" });
    const name = within(sheet).getByRole("textbox", { name: "Name" });
    expect(name).toHaveAccessibleDescription("Another rule on this board has this name.");
    await user.clear(name);
    await user.type(name, "Bugs stuck in progress");
    expect(name).not.toHaveAttribute("aria-invalid");
    await user.click(within(sheet).getByRole("button", { name: "Add to changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit rule" })).toBeNull());
    expect(newRow("draft-1")).toHaveTextContent("Bugs stuck in progress");
    expect(posted(stand, "rules/settings")).toEqual([]);
  });
});

describe("a saved custom rule", PAGE_TEST, () => {
  it("has its own group with the same controls, its check's label, and Edit and Delete in place of Reset", async () => {
    service({ settings: twoRules() });
    renderPage();
    await ready();
    const list = screen.getByRole("list", { name: "Custom rules" });
    expect(within(list).getAllByRole("listitem").map((item) => item.dataset.rule)).toEqual(["R-CUS-01", "W-CUS-01"]);
    const bugs = row("R-CUS-01");
    expect(bugs).toHaveTextContent("R-CUS-01 Custom");
    expect(bugs).toHaveTextContent("Bugs in progress over 3 days");
    expect(bugs).toHaveTextContent("Time in a status");
    expect(bugs).toHaveTextContent("Bug · In progress");
    // Its check's sentence around its field, never "In “In Progress”", which reads as a word typed twice.
    expect(bugs).toHaveTextContent("Stays in “In Progress” for over");
    expect(within(bugs).getByRole("spinbutton", { name: /Time in the status/ })).toHaveValue("72");
    expect(within(bugs).getByRole("button", { name: /^Edit\W*R-CUS-01/ })).toBeInTheDocument();
    expect(within(bugs).getByRole("button", { name: /^Delete\W*R-CUS-01/ })).toBeInTheDocument();
    expect(within(bugs).queryByRole("button", { name: /Reset to default/ })).toBeNull();
    expect(within(bugs).getByRole("link", { name: "2 open findings for R-CUS-01" })).toHaveAttribute("href", "/findings?rule=R-CUS-01");
    // The catalogue's groups hold the catalogue's rules alone.
    expect(within(screen.getByRole("list", { name: "Early warnings" })).queryByText("Untouched for 10 days")).toBeNull();
  });

  it("is edited in the sheet with its check locked, deleted and kept again, and saved as an edit and a delete", async () => {
    const preview = {
      ...newRulePreviewJson,
      impact: [
        { rule_id: "R-CUS-01", measurable: true, open_now: 2, would_open: 0, would_close: 1, would_stay: 1, examples: { open: [], close: ["DEMO-77"] }, note: null },
        { rule_id: "W-CUS-01", measurable: true, open_now: 5, would_open: 0, would_close: 5, would_stay: 0, examples: { open: [], close: ["DEMO-15"] }, note: null },
      ],
      totals: { would_open: 0, would_close: 6 },
    };
    const stand = service({ settings: twoRules(), preview: () => ({ body: preview }) });
    const ok = vi.spyOn(notify, "ok");
    const user = userEvent.setup();
    renderPage();
    await ready();

    const edit = within(row("R-CUS-01")).getByRole("button", { name: /^Edit\W*R-CUS-01/ });
    await user.click(edit);
    const sheet = await screen.findByRole("dialog", { name: "Edit rule" });
    expect(sheet).toHaveTextContent("R-CUS-01");
    expect(within(sheet).getByRole("combobox", { name: "What to check" })).toBeDisabled();
    expect(sheet).toHaveTextContent("To use another check, delete this rule and add a new one.");
    // How serious it is, and whether it runs, are its row's to set; no AI here.
    expect(within(sheet).queryByRole("radiogroup", { name: "How serious" })).toBeNull();
    expect(within(sheet).queryByRole("textbox", { name: /Describe it/ })).toBeNull();
    const name = within(sheet).getByRole("textbox", { name: "Name" });
    await user.clear(name);
    await user.type(name, "Bugs in progress over 4 days");
    const hours = within(sheet).getByRole("spinbutton", { name: "Time in the status" });
    await user.clear(hours);
    await user.type(hours, "96");
    expect(sheet).toHaveTextContent("That is 4 days.");
    await user.click(within(sheet).getByRole("button", { name: "Add to changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit rule" })).toBeNull());
    await waitFor(() => expect(edit).toHaveFocus());
    expect(ok).toHaveBeenLastCalledWith("Edit added to your changes", expect.objectContaining({ description: "Review and save to change it on Demo project." }));
    expect(row("R-CUS-01")).toHaveTextContent("Edited");
    expect(row("R-CUS-01")).toHaveTextContent("Bugs in progress over 4 days");
    expect(within(row("R-CUS-01")).getByRole("spinbutton", { name: /Time in the status/ })).toHaveValue("96");
    expect(bar()).toHaveTextContent("2 unsaved changes");

    // Deleted: struck through, its controls held, with Keep; kept again, as it was.
    await user.click(within(row("W-CUS-01")).getByRole("button", { name: /^Delete\W*W-CUS-01/ }));
    expect(row("W-CUS-01")).toHaveTextContent("Deleted when you save");
    await waitFor(() => expect(within(row("W-CUS-01")).getByRole("button", { name: /^Keep\W*W-CUS-01/ })).toHaveFocus());
    expect(within(row("W-CUS-01")).getByRole("switch")).toBeDisabled();
    expect(bar()).toHaveTextContent("3 unsaved changes");
    await user.click(within(row("W-CUS-01")).getByRole("button", { name: /^Keep\W*W-CUS-01/ }));
    expect(row("W-CUS-01")).not.toHaveTextContent("Deleted when you save");
    await waitFor(() => expect(within(row("W-CUS-01")).getByRole("button", { name: /^Delete\W*W-CUS-01/ })).toHaveFocus());
    expect(bar()).toHaveTextContent("2 unsaved changes");
    await user.click(within(row("W-CUS-01")).getByRole("button", { name: /^Delete\W*W-CUS-01/ }));

    await user.click(within(bar()!).getByRole("button", { name: "Review and save" }));
    const dialog = await screen.findByRole("dialog", { name: "Review and save" });
    expect(dialog).toHaveTextContent("3 changes to Demo project’s rule settings.");
    expect(dialog.querySelector('[data-change="R-CUS-01.title"]')).toHaveTextContent("“Bugs in progress over 3 days” to “Bugs in progress over 4 days”");
    expect(dialog.querySelector('[data-change="R-CUS-01.params.hours"]')).toHaveTextContent("72 h to 96 h");
    expect(dialog.querySelector('[data-change-deleted="W-CUS-01"]')).toHaveTextContent(/^W-CUS-01 Untouched for 10 days\s*Deleted\. Its open findings close; an undo brings it back\.$/);
    const changes = [
      { op: "edit", rule_id: "R-CUS-01", title: "Bugs in progress over 4 days", params: { hours: 96 } },
      { op: "delete", rule_id: "W-CUS-01" },
    ];
    expect(posted(stand, "rules/settings/preview")).toEqual([{ changes }]);
    const gone = (await within(dialog).findByRole("table")).querySelector<HTMLElement>('[data-impact="W-CUS-01"]')!;
    expect(gone).toHaveTextContent("Would close 5 findings.");
    await user.click(within(dialog).getByRole("button", { name: "Save and re-check" }));
    await waitFor(() => expect(posted(stand, "rules/settings")).toEqual([{ revision: 2, changes }]));
  });

  it("is saved one way at a time: an edit in the sheet and its switch in one draft hold the review back, said beside it", async () => {
    const stand = service({ settings: twoRules() });
    const warn = vi.spyOn(notify, "warn");
    const user = userEvent.setup();
    renderPage();
    await ready();
    await user.click(within(row("R-CUS-01")).getByRole("button", { name: /^Edit\W*R-CUS-01/ }));
    const sheet = await screen.findByRole("dialog", { name: "Edit rule" });
    const name = within(sheet).getByRole("textbox", { name: "Name" });
    await user.clear(name);
    await user.type(name, "Bugs in progress too long");
    await user.click(within(sheet).getByRole("button", { name: "Add to changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit rule" })).toBeNull());

    const toggle = within(row("R-CUS-01")).getByRole("switch");
    await user.click(toggle);
    await user.click(within(bar()!).getByRole("button", { name: "Review and save" }));
    expect(screen.queryByRole("dialog", { name: "Review and save" })).toBeNull();
    expect(toggle).toHaveFocus();
    expect(row("R-CUS-01")).toHaveTextContent("Save the edit first, then change its On/Off or severity.");
    expect(warn).toHaveBeenCalledWith("Some values can't be saved", expect.anything());
    expect(posted(stand, "rules/settings/preview")).toEqual([]);

    // The switch put back: the edit alone is reviewed and sent.
    await user.click(toggle);
    expect(row("R-CUS-01")).not.toHaveTextContent("Save the edit first");
    await user.click(within(bar()!).getByRole("button", { name: "Review and save" }));
    await screen.findByRole("dialog", { name: "Review and save" });
    expect(posted(stand, "rules/settings/preview")).toEqual([{ changes: [{ op: "edit", rule_id: "R-CUS-01", title: "Bugs in progress too long" }] }]);
  });

  it("is turned off and set to Warning on its row as any rule is, which saves as one setting change", async () => {
    const stand = service({ settings: twoRules() });
    const user = userEvent.setup();
    renderPage();
    await ready();
    await user.click(within(row("R-CUS-01")).getByRole("switch"));
    await user.click(within(row("R-CUS-01")).getByRole("radio", { name: "Warning" }));
    await user.click(within(bar()!).getByRole("button", { name: "Review and save" }));
    await screen.findByRole("dialog", { name: "Review and save" });
    expect(posted(stand, "rules/settings/preview")).toEqual([{ changes: [{ rule_id: "R-CUS-01", enabled: false, severity: "warning" }] }]);
  });
});

describe("the history of custom rules", PAGE_TEST, () => {
  const renamed = "Bugs in progress too long";
  /** R-CUS-01 and W-CUS-01 added; R-CUS-01 renamed and given 96 hours; W-CUS-01 deleted. */
  function threeChanges(): RuleSettings {
    return board(
      [ownRule("R-CUS-01", { ...BUGS, title: renamed, params: { ...BUGS.params, hours: 96 } }, 2)],
      [
        entry(3, [{ rule_id: "W-CUS-01", field: "rule", from: UNTOUCHED, to: null }]),
        entry(2, [
          { rule_id: "R-CUS-01", field: "title", from: BUGS.title, to: renamed },
          { rule_id: "R-CUS-01", field: "params.hours", from: 72, to: 96 },
        ]),
        entry(1, [
          { rule_id: "R-CUS-01", field: "rule", from: null, to: BUGS },
          { rule_id: "W-CUS-01", field: "rule", from: null, to: UNTOUCHED },
        ]),
      ],
    );
  }

  it("says each rule added, edited and deleted in words, with what it was", async () => {
    service({ settings: threeChanges() });
    renderPage();
    await ready();
    const deleted = document.querySelector<HTMLElement>('[data-revision="3"]')!;
    expect(deleted).toHaveTextContent("W-CUS-01 Deleted rule “Untouched for 10 days”");
    expect(deleted).toHaveTextContent("No updates · No change in Jira for 10 days · All types · In progress · Warning");
    const edited = document.querySelector<HTMLElement>('[data-revision="2"]')!;
    expect(edited).toHaveTextContent(`R-CUS-01 ${renamed} · Name “Bugs in progress over 3 days” to “${renamed}”`);
    expect(edited).toHaveTextContent("Time in the status 72 h to 96 h");
    const added = document.querySelector<HTMLElement>('[data-revision="1"]')!;
    expect(added).toHaveTextContent("R-CUS-01 Added rule “Bugs in progress over 3 days”");
    expect(added).toHaveTextContent("W-CUS-01 Added rule “Untouched for 10 days”");
  });

  it("undoes a deletion by bringing the rule back, after saying so", async () => {
    const stand = service({ settings: threeChanges() });
    const user = userEvent.setup();
    renderPage();
    await ready();
    await user.click(within(document.querySelector<HTMLElement>('[data-revision="3"]')!).getByRole("button", { name: "Undo" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Undo revision 3?" });
    expect(confirm).toHaveTextContent("Brings back rule “Untouched for 10 days”");
    await user.click(within(confirm).getByRole("button", { name: "Undo revision 3" }));
    await waitFor(() =>
      expect(posted(stand, "rules/settings")).toEqual([
        { revision: 3, changes: [{ op: "restore", rule_id: "W-CUS-01" }], undo_of: "3".repeat(32), reason: "Undo of revision 3" },
      ]),
    );
  });

  it("undoes an edit by editing the rule back, and an addition by deleting the rule again", async () => {
    const edited = board(
      [ownRule("R-CUS-01", { ...BUGS, title: renamed, params: { ...BUGS.params, hours: 96 } }, 2)],
      threeChanges().history.slice(1),
    );
    const stand = service({ settings: edited });
    const user = userEvent.setup();
    renderPage();
    await ready();
    await user.click(within(document.querySelector<HTMLElement>('[data-revision="2"]')!).getByRole("button", { name: "Undo" }));
    await user.click(within(await screen.findByRole("alertdialog", { name: "Undo revision 2?" })).getByRole("button", { name: "Undo revision 2" }));
    await waitFor(() =>
      expect(posted(stand, "rules/settings")).toEqual([
        { revision: 2, changes: [{ op: "edit", rule_id: "R-CUS-01", title: BUGS.title, params: { hours: 72 } }], undo_of: "2".repeat(32), reason: "Undo of revision 2" },
      ]),
    );
  });
});
