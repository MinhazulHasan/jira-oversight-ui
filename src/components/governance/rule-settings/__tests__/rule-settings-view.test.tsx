import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { configure, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { renderKit } from "@/components/ui/__tests__/kit";
import {
  isSettingChange,
  ruleSettingsPreviewSchema,
  ruleSettingsSchema,
  type RuleSettings,
  type RuleSettingsChange,
  type RuleSettingsFieldChange,
  type RuleSettingsSaveRequest,
} from "@/lib/api/schemas";
import { formatDateTime } from "@/lib/format";
import { navigateGuarded } from "@/lib/leave-guard";
import { notify } from "@/lib/notify";

import previewJson from "../../../../../docs/sample-responses/rule-settings-preview.json";
import settingsJson from "../../../../../docs/sample-responses/rule-settings.json";
import { pageReload } from "../leave-guard";
import { RuleSettingsView } from "../rule-settings-view";

/*
 * The rule settings page (JO-15) against a stand-in for the service that
 * answers as the contract says: the draft and its bar, what is wrong said
 * beside the field, the review with the preview, a save and its re-check, a
 * save someone else's overtook, the service's refusals, the history and its
 * undo, and leaving with unsaved changes.
 */

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/governance/rules",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const base = ruleSettingsSchema.parse(settingsJson);
const previewBody = ruleSettingsPreviewSchema.parse(previewJson);
const AT = "2026-11-04T14:31:00.000Z";
/** The time as the page writes it, its spaces as a reader's text has them (the narrow space before PM read as one). */
const AT_WORDS = formatDateTime(AT).replace(/\s/g, " ");
const ADMIN = { hash: "b".repeat(32), name: "Morgan Ellis" };
const PROJECTS = {
  default: "DEMO",
  projects: [{ key: "DEMO", name: "Demo project", issues: 1150, last_synced_at: "2026-11-04T14:28:00.000Z", synced: true, type: "software" }],
};

/** A whole page, typed into key by key: under a full run's load, a dialog or a read may take a few seconds to arrive. */
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

/** A change applied to the settings as the service would apply it: the board's rules, the next revision, the history. */
function applied(settings: RuleSettings, body: RuleSettingsSaveRequest, state: "running" | "applied" = "running"): RuleSettings {
  const fields: RuleSettingsFieldChange[] = [];
  const rules = settings.rules.map((rule) => {
    // A rule's settings changed (JO-15's shape); a custom rule's own changes (JO-20) are custom-rules.test.tsx's.
    const change = body.changes.filter(isSettingChange).find((candidate) => candidate.rule_id === rule.rule_id);
    if (!change) return rule;
    const enabled = change.reset ? rule.default_enabled : (change.enabled ?? rule.enabled);
    const severity = change.reset ? rule.default_severity : (change.severity ?? rule.severity);
    const params = rule.params.map((param) =>
      param.kind === "number" ? { ...param, value: change.reset ? param.default : (change.params?.[param.name] ?? param.value) } : param,
    );
    if (enabled !== rule.enabled) fields.push({ rule_id: rule.rule_id, field: "enabled", from: rule.enabled, to: enabled });
    if (severity !== rule.severity) fields.push({ rule_id: rule.rule_id, field: "severity", from: rule.severity, to: severity });
    params.forEach((param, index) => {
      if (param.value !== rule.params[index].value) fields.push({ rule_id: rule.rule_id, field: `params.${param.name}`, from: rule.params[index].value, to: param.value });
    });
    const customised = enabled !== rule.default_enabled || severity !== rule.default_severity || params.some((param) => param.value !== param.default);
    return { ...rule, enabled, severity, params, customised };
  });
  const revision = settings.revision + 1;
  const entry = {
    change_id: String(revision).repeat(32).slice(0, 32),
    at: AT,
    revision,
    by: ADMIN,
    reason: body.reason ?? null,
    undo_of: body.undo_of ?? null,
    changes: fields,
  };
  return ruleSettingsSchema.parse({
    ...settings,
    revision,
    updated_at: AT,
    updated_by: ADMIN.name,
    apply:
      state === "running"
        ? { state, applied_revision: settings.revision, started_at: AT, finished_at: null, message: null, result: null }
        : { state, applied_revision: revision, started_at: AT, finished_at: AT, message: null, result: { opened: 0, closed: 58 } },
    rules,
    history: [entry, ...settings.history],
  });
}

type Answer = { status?: number; body: unknown };

interface Service {
  settings: RuleSettings;
  preview: (body: { changes: RuleSettingsChange[] }) => Answer;
  save: (body: RuleSettingsSaveRequest) => Answer;
  calls: { method: string; path: string; body: unknown }[];
}

/** The oversight route, answering from `settings` (a save moves it on, re-checking), and every call it was asked. */
function service(overrides: Partial<Omit<Service, "calls">> = {}): Service {
  const stand: Service = {
    settings: base,
    preview: () => ({ body: previewBody }),
    save: (body) => {
      stand.settings = applied(stand.settings, body);
      return { body: stand.settings };
    },
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

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderKit(
    <QueryClientProvider client={client}>
      <RuleSettingsView />
    </QueryClientProvider>,
  );
  return client;
}

const row = (ruleId: string) => document.querySelector<HTMLElement>(`[data-rule="${ruleId}"]`)!;
const field = (ruleId: string, index = 0) => within(row(ruleId)).getAllByRole("spinbutton")[index];
const bar = () => screen.queryByRole("region", { name: "Unsaved changes" });

async function ready() {
  await screen.findByRole("heading", { name: "Hard and fast rules" });
}

/** Types a threshold as a reader would: the field cleared, the figure typed, the field left. */
async function typeThreshold(user: ReturnType<typeof userEvent.setup>, ruleId: string, text: string, index = 0) {
  const input = field(ruleId, index);
  await user.clear(input);
  if (text) await user.type(input, text);
  await user.tab();
}

/* --------------------------------------------------------------- tests --- */

describe("the rule settings page", PAGE_TEST, () => {
  it("loads in its final shape, then shows the board, where its settings stand and every rule in its group", async () => {
    service();
    renderPage();
    expect(screen.getByText("Loading the rule settings")).toBeInTheDocument();
    await ready();
    expect(screen.getByRole("heading", { name: "Early warnings" })).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Hard and fast rules" })).getAllByRole("listitem").filter((item) => item.dataset.rule)).toHaveLength(7);
    expect(within(screen.getByRole("list", { name: "Early warnings" })).getAllByRole("listitem").filter((item) => item.dataset.rule)).toHaveLength(5);
    const status = document.querySelector("[data-settings-status]")!;
    await waitFor(() => expect(status).toHaveTextContent("Demo project"));
    expect(status).toHaveTextContent("No changes yet. Every rule runs with its default settings.");
    // Said once (SQA): the history's empty state is its title alone, and nothing says "catalogue".
    expect(document.body).not.toHaveTextContent(/catalogue sets it/);
    // A percentile in plain words, never "p90" (SQA).
    expect(row("W-AGE-01")).toHaveTextContent("Longer in the status than");
    expect(row("W-AGE-01")).toHaveTextContent("of finished work");
    expect(row("W-AGE-01")).not.toHaveTextContent(/p9\d/);
    // Every control named by its rule; the thresholds as a sentence with their bounds.
    expect(within(row("W-AGE-01")).getByRole("switch", { name: "Stuck in a status On this board" })).toBeChecked();
    expect(within(row("R-EFF-01")).getByRole("radiogroup", { name: "Effort far beyond the estimate: reported as" })).toBeInTheDocument();
    expect(field("R-EFF-01")).toHaveAttribute("aria-valuemin", "0.1");
    expect(field("R-EFF-01")).toHaveAttribute("aria-valuemax", "10");
    expect(row("R-EFF-01")).toHaveTextContent("Flag when effort ≥");
    expect(row("R-EFF-01")).toHaveTextContent("Default 1.5×");
    expect(row("W-SPR-01")).toHaveTextContent("Default 2 days, 30%");
    expect(row("W-REV-01")).toHaveTextContent("Not measurable on this board: Jira holds no code review evidence.");
    expect(bar()).toBeNull();
    expect(screen.getByText("No changes yet")).toBeInTheDocument();
  });

  it("says once, in place, when the settings cannot be loaded, and tries again", async () => {
    let fail = true;
    const stand = service();
    const ok = stand.settings;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = new URL(String(input), "http://localhost").pathname;
        if (path.endsWith("/projects")) return new Response(JSON.stringify(PROJECTS), { status: 200 });
        return fail
          ? new Response(JSON.stringify({ error: "upstream_unavailable", message: "The oversight service cannot be reached right now." }), { status: 503 })
          : new Response(JSON.stringify(ok), { status: 200 });
      }),
    );
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText("Couldn't load the rule settings")).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole("button", { name: /Try again/ }));
    await ready();
  });

  it("keeps edits as a draft: the bar counts them, the row says it is edited, and Discard puts everything back", async () => {
    service();
    const info = vi.spyOn(notify, "info");
    const user = userEvent.setup();
    renderPage();
    await ready();
    await user.click(within(row("W-AGE-01")).getByRole("switch"));
    expect(within(bar()!).getByText(/unsaved change$/)).toHaveTextContent("1 unsaved change");
    expect(row("W-AGE-01")).toHaveTextContent("Edited");
    expect(row("W-AGE-01")).toHaveTextContent("Off");
    await typeThreshold(user, "R-EFF-01", "2");
    await user.click(within(row("R-EST-02")).getByRole("radio", { name: "Breach" }));
    expect(bar()).toHaveTextContent("3 unsaved changes");
    // A field set back to what it was is no change at all.
    await typeThreshold(user, "R-EFF-01", "1.50");
    expect(bar()).toHaveTextContent("2 unsaved changes");
    await user.click(within(bar()!).getByRole("button", { name: "Discard" }));
    expect(bar()).toBeNull();
    expect(within(row("W-AGE-01")).getByRole("switch")).toBeChecked();
    expect(within(row("R-EST-02")).getByRole("radio", { name: "Warning" })).toBeChecked();
    expect(info).toHaveBeenCalledWith("Changes discarded", expect.anything());
  });

  it("says beside the field what cannot be saved, and holds the review back until it is put right", async () => {
    const stand = service();
    const warn = vi.spyOn(notify, "warn");
    const user = userEvent.setup();
    renderPage();
    await ready();
    await typeThreshold(user, "R-EFF-01", "12");
    expect(row("R-EFF-01")).toHaveTextContent("Must be from 0.1× to 10×.");
    expect(field("R-EFF-01")).toHaveAttribute("aria-invalid", "true");
    await typeThreshold(user, "W-SPR-01", "0.37", 1);
    await user.click(within(bar()!).getByRole("button", { name: "Review and save" }));
    expect(screen.queryByRole("dialog", { name: "Review and save" })).toBeNull();
    expect(field("R-EFF-01")).toHaveFocus();
    expect(warn).toHaveBeenCalledWith("Some values can't be saved", expect.anything());
    expect(posted(stand, "rules/settings/preview")).toEqual([]);

    // An emptied field says so once left; and a warning may not reach its breach while both run.
    await typeThreshold(user, "R-EFF-01", "");
    expect(row("R-EFF-01")).toHaveTextContent("Enter a value from 0.1× to 10×.");
    await typeThreshold(user, "R-EFF-01", "1.5");
    await typeThreshold(user, "W-EFF-01", "1.6");
    expect(row("W-EFF-01")).toHaveTextContent("Must stay below R-EFF-01's 1.5× while both are on: the warning comes first.");
    await user.click(within(row("R-EFF-01")).getByRole("switch"));
    expect(row("W-EFF-01")).not.toHaveTextContent("Must stay below");
  });

  it("reviews each change with the service's preview, then saves with the reason and follows the re-check to the end", async () => {
    const stand = service();
    const ok = vi.spyOn(notify, "ok");
    const user = userEvent.setup();
    renderPage();
    await ready();
    await typeThreshold(user, "R-EFF-01", "2");
    await user.click(within(row("W-AGE-01")).getByRole("switch"));
    await user.click(within(bar()!).getByRole("button", { name: "Review and save" }));

    const dialog = await screen.findByRole("dialog", { name: "Review and save" });
    expect(dialog).toHaveTextContent("2 changes to Demo project’s rule settings.");
    expect(within(dialog).getByText("Effort ratio").parentElement).toHaveTextContent("Effort ratio 1.5× to 2×");
    expect(within(dialog).getByText("On this board").parentElement).toHaveTextContent("On this board On to Off");
    expect(posted(stand, "rules/settings/preview")).toEqual([
      { changes: [{ rule_id: "R-EFF-01", params: { threshold: 2 } }, { rule_id: "W-AGE-01", enabled: false }] },
    ]);
    const impact = await within(dialog).findByRole("table");
    const effort = impact.querySelector<HTMLElement>('[data-impact="R-EFF-01"]')!;
    expect(effort).toHaveTextContent("58");
    expect(within(effort).getByRole("link", { name: /^DEMO-1\s*\(opens in a new tab\)$/ })).toHaveAttribute("href", "/issues/DEMO-1");
    expect(within(effort).getByRole("link", { name: /^DEMO-1\s*\(/ })).toHaveAttribute("target", "_blank");
    // The review opens at its top: the dialog itself has the focus, not the reason at its foot.
    expect(dialog).toHaveFocus();

    await user.type(within(dialog).getByLabelText(/Reason/), "Agreed with the team");
    expect(within(dialog).getByText("20/500")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Save and re-check" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review and save" })).toBeNull());
    expect(posted(stand, "rules/settings")).toEqual([
      { revision: 0, changes: [{ rule_id: "R-EFF-01", params: { threshold: 2 } }, { rule_id: "W-AGE-01", enabled: false }], reason: "Agreed with the team" },
    ]);
    // The board by the name the page gives it, never its key (SQA).
    expect(ok).toHaveBeenCalledWith("Saved. Re-checking Demo project…", expect.objectContaining({ description: "Revision 1: 2 changes." }));
    expect(bar()).toBeNull();
    const status = document.querySelector<HTMLElement>("[data-settings-status]")!;
    // The bar went with the save: the status card, which says where things stand, has the focus.
    await waitFor(() => expect(status).toHaveFocus());
    expect(status).toHaveTextContent(`Revision 1 · , last changed ${AT_WORDS} by Morgan Ellis`);
    expect(status.querySelector("[data-apply]")).toHaveTextContent("Re-checking…");
    expect(row("R-EFF-01")).toHaveTextContent("Customised");

    // The re-check ends: the next read (every two seconds while it runs) finds the settings applied.
    stand.settings = { ...stand.settings, apply: { state: "applied", applied_revision: 1, started_at: AT, finished_at: AT, message: null, result: { opened: 0, closed: 72 } } };
    await waitFor(() => expect(status.querySelector("[data-apply]")).toHaveTextContent("Applied"), { timeout: 8_000 });
    expect(status).toHaveTextContent("72 closed, 0 opened");
    const reads = stand.calls.filter((call) => call.method === "GET" && call.path === "rules/settings").length;
    await new Promise((resolve) => setTimeout(resolve, 2_300));
    expect(stand.calls.filter((call) => call.method === "GET" && call.path === "rules/settings").length).toBe(reads);
  });

  it("on a save someone else's overtook, says so and offers Reload, which keeps nothing", async () => {
    const stand = service({ save: () => ({ status: 409, body: { error: "rule_settings_conflict", message: "Someone else changed this board's rule settings." } }) });
    const user = userEvent.setup();
    renderPage();
    await ready();
    await user.click(within(row("W-AGE-01")).getByRole("switch"));
    await user.click(within(bar()!).getByRole("button", { name: "Review and save" }));
    const dialog = await screen.findByRole("dialog", { name: "Review and save" });
    await within(dialog).findByRole("table");
    await user.click(within(dialog).getByRole("button", { name: "Save and re-check" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("Someone else changed these settings");
    expect(within(dialog).getByRole("button", { name: "Save and re-check" })).toBeDisabled();
    const reads = stand.calls.filter((call) => call.method === "GET" && call.path === "rules/settings").length;
    await user.click(within(alert).getByRole("button", { name: "Reload" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review and save" })).toBeNull());
    expect(bar()).toBeNull();
    expect(within(row("W-AGE-01")).getByRole("switch")).toBeChecked();
    await waitFor(() => expect(stand.calls.filter((call) => call.method === "GET" && call.path === "rules/settings").length).toBe(reads + 1));
  });

  it("puts the service's refusal beside each field it names, and a refused reason under the reason", async () => {
    const warn = vi.spyOn(notify, "warn");
    const refusal = (issues: { path: string; message: string }[]) => ({
      status: 422,
      body: { error: "rule_settings_invalid", message: "The oversight service refused these rule settings.", issues },
    });
    let answer = refusal([{ path: "R-EFF-01.params.threshold", message: "R-EFF-01's effort ratio may not be 2 on this board." }]);
    service({ save: () => answer });
    const user = userEvent.setup();
    renderPage();
    await ready();
    await typeThreshold(user, "R-EFF-01", "2");
    await user.click(within(bar()!).getByRole("button", { name: "Review and save" }));
    let dialog = await screen.findByRole("dialog", { name: "Review and save" });
    await within(dialog).findByRole("table");
    await user.click(within(dialog).getByRole("button", { name: "Save and re-check" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review and save" })).toBeNull());
    expect(row("R-EFF-01")).toHaveTextContent("R-EFF-01's effort ratio may not be 2 on this board.");
    expect(warn).toHaveBeenCalledWith("Not saved", expect.anything());
    // The refused field has the focus, there to be put right.
    await waitFor(() => expect(field("R-EFF-01")).toHaveFocus());
    // The draft is kept, so the reader can put it right.
    expect(bar()).toHaveTextContent("1 unsaved change");

    answer = refusal([{ path: "reason", message: "The reason cannot hold an account id." }]);
    await typeThreshold(user, "R-EFF-01", "2.5");
    await user.click(within(bar()!).getByRole("button", { name: "Review and save" }));
    dialog = await screen.findByRole("dialog", { name: "Review and save" });
    await within(dialog).findByRole("table");
    await user.click(within(dialog).getByRole("button", { name: "Save and re-check" }));
    expect(await within(dialog).findByText("The reason cannot hold an account id.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Reason/)).toHaveAttribute("aria-invalid", "true");
    // Said under the title too, in view however far the body is scrolled, with a way to the reason.
    const said = within(dialog).getByRole("alert");
    expect(said.closest("[data-dialog-notice]")).not.toBeNull();
    expect(said).toHaveTextContent("Reason: The reason cannot hold an account id.");
    await user.click(within(said).getByRole("button", { name: "Edit the reason" }));
    expect(within(dialog).getByLabelText(/Reason/)).toHaveFocus();
  });

  it("says a refused preview once, under the title, naming each setting refused with a way to it; and beside its field", async () => {
    const problem = "Must stay above W-EFF-01's 1.4× while both are on.";
    const stand = service({
      preview: () => ({
        status: 422,
        body: { error: "rule_settings_invalid", message: "The oversight service refused these rule settings.", issues: [{ path: "R-EFF-01.params.threshold", message: problem }] },
      }),
    });
    const user = userEvent.setup();
    renderPage();
    await ready();
    await typeThreshold(user, "R-EFF-01", "1.3");
    await user.click(within(bar()!).getByRole("button", { name: "Review and save" }));
    const dialog = await screen.findByRole("dialog", { name: "Review and save" });
    expect(await within(dialog).findByText("These settings were refused.")).toBeInTheDocument();
    expect(within(dialog).getAllByRole("alert")).toHaveLength(1);
    const refusal = within(dialog).getByRole("alert");
    expect(refusal.closest("[data-dialog-notice]")).not.toBeNull();
    expect(refusal).toHaveTextContent(`R-EFF-01 Effort far beyond the estimate · Effort ratio: ${problem}`);
    expect(within(dialog).getByRole("button", { name: "Save and re-check" })).toBeDisabled();
    // Edit closes the review on the refused setting, which says the same beside it.
    await user.click(within(refusal).getByRole("button", { name: "Edit R-EFF-01" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review and save" })).toBeNull());
    await waitFor(() => expect(field("R-EFF-01")).toHaveFocus());
    expect(row("R-EFF-01")).toHaveTextContent(problem);
    expect(field("R-EFF-01")).toHaveAttribute("aria-invalid", "true");
    expect(posted(stand, "rules/settings")).toEqual([]);
    // Put right, the problem goes with the edit.
    await typeThreshold(user, "R-EFF-01", "2");
    expect(row("R-EFF-01")).not.toHaveTextContent(problem);
  });

  it("refuses an email address in the reason before anything is sent, and keeps the reason while the review is closed", async () => {
    const stand = service();
    const user = userEvent.setup();
    renderPage();
    await ready();
    await user.click(within(row("W-AGE-01")).getByRole("switch"));
    await user.click(within(bar()!).getByRole("button", { name: "Review and save" }));
    let dialog = await screen.findByRole("dialog", { name: "Review and save" });
    await within(dialog).findByRole("table");
    await user.type(within(dialog).getByLabelText(/Reason/), "Ask lead@example.org");
    expect(dialog).toHaveTextContent("Leave out email addresses: every admin reads the history.");
    expect(within(dialog).getByRole("button", { name: "Save and re-check" })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await user.click(within(bar()!).getByRole("button", { name: "Review and save" }));
    dialog = await screen.findByRole("dialog", { name: "Review and save" });
    expect(within(dialog).getByLabelText(/Reason/)).toHaveValue("Ask lead@example.org");
    expect(posted(stand, "rules/settings")).toEqual([]);
  });

  it("opens the review with Ctrl+Enter (⌘↵ on a Mac) from anywhere on the page, and saves with it from any control in it", async () => {
    const stand = service();
    const user = userEvent.setup();
    renderPage();
    await ready();
    await user.click(within(row("W-AGE-01")).getByRole("switch"));
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    let dialog = await screen.findByRole("dialog", { name: "Review and save" });
    await within(dialog).findByRole("table");
    // Not only from the reason: the dialog itself, which has the focus as it opens, saves too, and once.
    fireEvent.keyDown(dialog, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(posted(stand, "rules/settings")).toHaveLength(1));

    await user.click(within(row("W-SPR-01")).getByRole("switch"));
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    dialog = await screen.findByRole("dialog", { name: "Review and save" });
    await within(dialog).findByRole("table");
    fireEvent.keyDown(within(dialog).getByLabelText(/Reason/), { key: "Enter", metaKey: true });
    await waitFor(() => expect(posted(stand, "rules/settings")).toHaveLength(2));
  });

  it("says a save that failed under the review's title, in view (no toast over its buttons); nothing is changed", async () => {
    const busy = "The rules are running on this board right now. Try again in a moment.";
    const stand = service({ save: () => ({ status: 503, body: { error: "upstream_unavailable", message: busy } }) });
    const warn = vi.spyOn(notify, "warn");
    const user = userEvent.setup();
    renderPage();
    await ready();
    await typeThreshold(user, "R-EFF-01", "2");
    await user.click(within(row("W-AGE-01")).getByRole("switch"));
    await user.click(within(row("R-EST-02")).getByRole("radio", { name: "Breach" }));
    await user.click(within(bar()!).getByRole("button", { name: "Review and save" }));
    const dialog = await screen.findByRole("dialog", { name: "Review and save" });
    await within(dialog).findByRole("table");
    await user.click(within(dialog).getByRole("button", { name: "Save and re-check" }));
    const failure = await within(dialog).findByRole("alert");
    expect(failure).toHaveTextContent(`Couldn’t save${busy} Nothing was changed.`);
    // Pinned under the title, outside the body that scrolls: three changes' review is taller than a laptop's window.
    expect(failure.closest("[data-dialog-notice]")).not.toBeNull();
    expect(failure.closest("[data-dialog-body]")).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    expect(bar()).toHaveTextContent("3 unsaved changes");
    expect(posted(stand, "rules/settings")).toHaveLength(1);
  });

  it("says a severity change re-files the rule's findings, listing its tickets once rather than closing and opening the same", async () => {
    const refile = {
      ...previewBody,
      impact: [
        { rule_id: "R-EST-02", measurable: true, open_now: 56, would_open: 57, would_close: 56, would_stay: 0, examples: { open: ["DEMO-1", "DEMO-15", "DEMO-77"], close: ["DEMO-1", "DEMO-15"] }, note: null },
      ],
      totals: { would_open: 57, would_close: 56 },
    };
    service({ preview: () => ({ body: refile }) });
    const user = userEvent.setup();
    renderPage();
    await ready();
    await user.click(within(row("R-EST-02")).getByRole("radio", { name: "Breach" }));
    await user.click(within(bar()!).getByRole("button", { name: "Review and save" }));
    const dialog = await screen.findByRole("dialog", { name: "Review and save" });
    const impact = (await within(dialog).findByRole("table")).querySelector<HTMLElement>('[data-impact="R-EST-02"]')!;
    expect(impact).toHaveTextContent("Re-filed as Breach: a severity change closes each open finding and opens it again under the new severity");
    const lists = [...impact.querySelectorAll<HTMLElement>("[data-examples]")];
    expect(lists.map((list) => list.dataset.examples)).toEqual(["Re-filed", "Opens"]);
    expect(lists[0]).toHaveTextContent(/DEMO-1\b.*DEMO-15/);
    expect(lists[1]).toHaveTextContent("DEMO-77");
    expect(lists[1]).not.toHaveTextContent("DEMO-15");
    expect(dialog).toHaveTextContent("(except under a severity change, which re-files every open finding of its rule)");
  });

  it("ends a list of tickets the preview cut short with 'and more', and a list that names every ticket with the last", async () => {
    const cut = {
      ...previewBody,
      impact: [
        // 58 findings close, five tickets named: there are more than those.
        { rule_id: "R-EFF-01", measurable: true, open_now: 58, would_open: 0, would_close: 58, would_stay: 0, examples: { open: [], close: ["DEMO-1", "DEMO-32", "DEMO-41", "DEMO-46", "DEMO-58"] }, note: null },
        // Two findings close, both tickets named: that is all of them.
        { rule_id: "W-AGE-01", measurable: true, open_now: 14, would_open: 0, would_close: 2, would_stay: 12, examples: { open: [], close: ["DEMO-749", "DEMO-802"] }, note: null },
      ],
      totals: { would_open: 0, would_close: 60 },
    };
    service({ preview: () => ({ body: cut }) });
    const user = userEvent.setup();
    renderPage();
    await ready();
    await typeThreshold(user, "R-EFF-01", "2");
    await user.click(within(row("W-AGE-01")).getByRole("switch"));
    await user.click(within(bar()!).getByRole("button", { name: "Review and save" }));
    const dialog = await screen.findByRole("dialog", { name: "Review and save" });
    const table = await within(dialog).findByRole("table");
    const closes = (ruleId: string) => table.querySelector<HTMLElement>(`[data-impact="${ruleId}"] [data-examples="Closes"]`)!;
    expect(closes("R-EFF-01").querySelectorAll("a")).toHaveLength(5);
    expect(closes("R-EFF-01")).toHaveTextContent(/DEMO-58 \(opens in a new tab\)\s*and more$/);
    expect(closes("W-AGE-01")).toHaveTextContent(/DEMO-802 \(opens in a new tab\)$/);
    expect(closes("W-AGE-01").querySelector("[data-examples-more]")).toBeNull();
  });

  it("ends a severity change's re-filed tickets with 'and more' when the rule re-files more than the preview names", async () => {
    const keys = ["DEMO-1", "DEMO-15", "DEMO-77", "DEMO-80", "DEMO-91"];
    const refile = {
      ...previewBody,
      impact: [{ rule_id: "R-EST-02", measurable: true, open_now: 56, would_open: 56, would_close: 56, would_stay: 0, examples: { open: keys, close: keys }, note: null }],
      totals: { would_open: 56, would_close: 56 },
    };
    service({ preview: () => ({ body: refile }) });
    const user = userEvent.setup();
    renderPage();
    await ready();
    await user.click(within(row("R-EST-02")).getByRole("radio", { name: "Breach" }));
    await user.click(within(bar()!).getByRole("button", { name: "Review and save" }));
    const dialog = await screen.findByRole("dialog", { name: "Review and save" });
    const impact = (await within(dialog).findByRole("table")).querySelector<HTMLElement>('[data-impact="R-EST-02"]')!;
    const lists = [...impact.querySelectorAll<HTMLElement>("[data-examples]")];
    expect(lists.map((list) => list.dataset.examples)).toEqual(["Re-filed"]);
    expect(lists[0]).toHaveTextContent(/DEMO-91 \(opens in a new tab\)\s*and more$/);
  });
});

describe("the focus", PAGE_TEST, () => {
  const status = () => document.querySelector<HTMLElement>("[data-settings-status]")!;

  it("goes back to Review and save when the review is cancelled or closed with Escape", async () => {
    service();
    const user = userEvent.setup();
    renderPage();
    await ready();
    await user.click(within(row("W-AGE-01")).getByRole("switch"));
    const review = within(bar()!).getByRole("button", { name: "Review and save" });
    await user.click(review);
    let dialog = await screen.findByRole("dialog", { name: "Review and save" });
    await within(dialog).findByRole("table");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(review).toHaveFocus());

    await user.keyboard("{Enter}");
    dialog = await screen.findByRole("dialog", { name: "Review and save" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review and save" })).toBeNull());
    await waitFor(() => expect(review).toHaveFocus());
    expect(document.activeElement).not.toBe(document.body);
  });

  it("goes to the rule's switch on Reset to default, and to the status card on Discard: never to the page's body", async () => {
    service();
    const user = userEvent.setup();
    renderPage();
    await ready();
    await typeThreshold(user, "R-EFF-01", "2");
    await user.click(within(row("R-EFF-01")).getByRole("button", { name: /Reset to default/ }));
    expect(within(row("R-EFF-01")).getByRole("switch")).toHaveFocus();
    expect(within(row("R-EFF-01")).queryByRole("button", { name: /Reset to default/ })).toBeNull();
    expect(bar()).toBeNull();

    await user.click(within(row("W-AGE-01")).getByRole("switch"));
    await user.click(within(bar()!).getByRole("button", { name: "Discard" }));
    expect(bar()).toBeNull();
    expect(status()).toHaveFocus();
  });
});

describe("the history", PAGE_TEST, () => {
  /** Two changes, the second undoing nothing yet: what the page shows after two saves. */
  function twoChanges(): RuleSettings {
    const first = applied(base, { revision: 0, changes: [{ rule_id: "R-EFF-01", params: { threshold: 2 } }], reason: "Agreed with the team" }, "applied");
    return applied(first, { revision: 1, changes: [{ rule_id: "W-AGE-01", enabled: false }, { rule_id: "W-SPR-01", params: { not_started_share: 0.4 } }] }, "applied");
  }

  it("lists every change newest first, who made it and when, why, and each field; the latest has Undo", async () => {
    service({ settings: twoChanges() });
    renderPage();
    await ready();
    const list = screen.getByRole("list", { name: "Changes to Demo project's rule settings, newest first" });
    const entries = within(list).getAllByRole("listitem").filter((item) => item.dataset.revision);
    expect(entries.map((entry) => entry.dataset.revision)).toEqual(["2", "1"]);
    expect(entries[0]).toHaveTextContent(`Revision 2 · ${AT_WORDS} · Morgan Ellis 2 changes`);
    expect(entries[0]).toHaveTextContent("On this board On to Off");
    expect(entries[0]).toHaveTextContent("Share of issues not started 30% to 40%");
    expect(entries[1]).toHaveTextContent("“Agreed with the team”");
    expect(entries[1]).toHaveTextContent("Effort ratio 1.5× to 2×");
    expect(within(entries[0]).getByRole("button", { name: "Undo" })).toBeEnabled();
    expect(within(entries[1]).queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("undoes the latest change after asking: the inverse of each field, the change it undoes, and why", async () => {
    const stand = service({ settings: twoChanges() });
    const ok = vi.spyOn(notify, "ok");
    const user = userEvent.setup();
    renderPage();
    await ready();
    const latest = document.querySelector<HTMLElement>('[data-revision="2"]')!;
    const undoButton = within(latest).getByRole("button", { name: "Undo" });
    await user.click(undoButton);
    let confirm = await screen.findByRole("alertdialog", { name: "Undo revision 2?" });
    expect(within(confirm).getByRole("button", { name: "Keep it" })).toHaveFocus();
    // Kept: nothing sent, and the focus back on the Undo that asked.
    await user.click(within(confirm).getByRole("button", { name: "Keep it" }));
    await waitFor(() => expect(undoButton).toHaveFocus());
    expect(posted(stand, "rules/settings")).toEqual([]);

    await user.click(undoButton);
    confirm = await screen.findByRole("alertdialog", { name: "Undo revision 2?" });
    expect(confirm).toHaveTextContent("2 changes set back");
    await user.click(within(confirm).getByRole("button", { name: "Undo revision 2" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    // Undone, its Undo is gone with it (the change is no longer the latest): the status card has the focus.
    await waitFor(() => expect(document.querySelector("[data-settings-status]")).toHaveFocus());
    expect(posted(stand, "rules/settings")).toEqual([
      {
        revision: 2,
        changes: [
          { rule_id: "W-AGE-01", enabled: true },
          { rule_id: "W-SPR-01", params: { not_started_share: 0.3 } },
        ],
        undo_of: stand.settings.history[1].change_id,
        reason: "Undo of revision 2",
      },
    ]);
    expect(ok).toHaveBeenCalledWith("Undone. Re-checking Demo project…", expect.anything());
    // The undone change says where it was undone, and the undo what it undid.
    await waitFor(() => expect(document.querySelector('[data-revision="2"]')).toHaveTextContent("Undone in revision 3"));
    expect(document.querySelector('[data-revision="3"]')).toHaveTextContent("Undoes revision 2");
  });

  it("holds Undo back while the page has unsaved changes, which it would lose", async () => {
    service({ settings: twoChanges() });
    const user = userEvent.setup();
    renderPage();
    await ready();
    await user.click(within(row("R-HYG-01")).getByRole("switch"));
    const undo = within(document.querySelector<HTMLElement>('[data-revision="2"]')!).getByRole("button", { name: "Undo" });
    expect(undo).toHaveAttribute("aria-disabled", "true");
    await user.click(undo);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("leaving with unsaved changes", PAGE_TEST, () => {
  it("asks first, for a link and for the app's own ways to go elsewhere; staying keeps the draft", async () => {
    service();
    const user = userEvent.setup();
    renderPage();
    await ready();
    await user.click(within(row("W-AGE-01")).getByRole("switch"));
    const link = within(row("R-EFF-01")).getByRole("link", { name: /open findings for R-EFF-01/ });
    await user.click(link);
    const ask = await screen.findByRole("alertdialog", { name: "Leave without saving?" });
    expect(ask).toHaveTextContent("Your 1 unsaved change to Demo project’s rule settings will be lost.");
    expect(within(ask).getByRole("button", { name: "Keep editing" })).toHaveFocus();
    await user.click(within(ask).getByRole("button", { name: "Keep editing" }));
    expect(push).not.toHaveBeenCalled();
    expect(bar()).toHaveTextContent("1 unsaved change");
    // Staying puts the focus back on the link that asked; Escape stays too.
    await waitFor(() => expect(link).toHaveFocus());
    await user.keyboard("{Enter}");
    await screen.findByRole("alertdialog", { name: "Leave without saving?" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await waitFor(() => expect(link).toHaveFocus());
    expect(push).not.toHaveBeenCalled();

    const go = vi.fn();
    navigateGuarded(go);
    const again = await screen.findByRole("alertdialog", { name: "Leave without saving?" });
    expect(go).not.toHaveBeenCalled();
    await user.click(within(again).getByRole("button", { name: "Leave without saving" }));
    expect(go).toHaveBeenCalledTimes(1);

    await user.click(within(row("R-EFF-01")).getByRole("link", { name: /open findings for R-EFF-01/ }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Leave without saving" }));
    expect(push).toHaveBeenCalledWith("/findings?rule=R-EFF-01");
  });

  it("asks the browser too, on a reload or a closed tab, and asks nothing with no changes", async () => {
    service();
    const user = userEvent.setup();
    renderPage();
    await ready();
    const quiet = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(quiet);
    expect(quiet.defaultPrevented).toBe(false);
    await user.click(within(row("W-AGE-01")).getByRole("switch"));
    const asked = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(asked);
    expect(asked.defaultPrevented).toBe(true);
    const go = vi.fn();
    // Without changes, the app's ways go straight on.
    await user.click(within(bar()!).getByRole("button", { name: "Discard" }));
    navigateGuarded(go);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("never sends a change once another board was picked in another tab, and reloads only when asked", async () => {
    const stand = service();
    const reload = vi.spyOn(pageReload, "now").mockImplementation(() => {});
    const user = userEvent.setup();
    renderPage();
    await ready();
    await user.click(within(row("W-AGE-01")).getByRole("switch"));
    document.cookie = "jo-board=OPS; path=/";
    await user.click(within(bar()!).getByRole("button", { name: "Review and save" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Another board was picked in another tab");
    expect(screen.queryByRole("dialog", { name: "Review and save" })).toBeNull();
    expect(stand.calls.filter((call) => call.method === "POST")).toEqual([]);
    await user.click(within(alert).getByRole("button", { name: "Reload the page" }));
    expect(reload).toHaveBeenCalledTimes(1);
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
  });
});
