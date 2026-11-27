import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderKit } from "@/components/ui/__tests__/kit";
import { notify } from "@/lib/notify";
import { peopleCreditSchema, type PeopleCredit } from "@/lib/api/schemas";

import { CreditControl } from "../credit-control";
import { choiceLine, coverageOf, creditNote, savedTitle } from "../model";

vi.mock("@/lib/notify", () => ({ notify: { info: vi.fn(), ok: vi.fn(), warn: vi.fn(), cite: vi.fn(), dismiss: vi.fn() } }));

const META = {
  data_mode: "sample",
  last_synced_at: "2026-11-04T14:28:00.000Z",
  projects: ["MOB"],
  rules_version: "0.1.0",
  process_version: "0.1.0",
  generated_at: "2026-11-04T14:30:00.000Z",
  report_timezone: "Europe/London",
};
const PROGRAMMER = { key: "programmer", name: "Programmer" };
const TESTERS = { key: "testers", name: "Testers" };
const NEVER = { revision: 0, changed_by: null, changed_at: null };

/** A board that clears its assignees at hand-off, as MJH DASHBOARD does: Programmer on a quarter of its finished work. */
function body(overrides: Partial<PeopleCredit> = {}): PeopleCredit {
  return peopleCreditSchema.parse({
    meta: META,
    period: { days: 90, from: "2026-08-06T14:28:00.000Z", to: "2026-11-04T14:28:00.000Z" },
    setting: { source: "assignee", field: null, revision: 1, changed_by: "Morgan Ellis", changed_at: "2026-11-03T10:15:00.000Z" },
    effective_field: null,
    finished: 475,
    options: [
      { source: "auto", field: null, source_filled: 124, credited: 150 },
      { source: "assignee", field: null, source_filled: 34, credited: 34 },
      { source: "field", field: PROGRAMMER, source_filled: 124, credited: 124 },
      { source: "field", field: TESTERS, source_filled: 88, credited: 88 },
    ],
    ...overrides,
  });
}

/** The service behind the page: a PUT answers the setting it saved, as the route does. */
function stubService(start: PeopleCredit) {
  let current = start;
  const sent: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") {
        const change = JSON.parse(String(init.body)) as { source: PeopleCredit["setting"]["source"]; field: string | null; revision: number };
        sent.push(change);
        const field = change.field === null ? null : change.field === "testers" ? TESTERS : PROGRAMMER;
        current = body({
          setting: { source: change.source, field, revision: current.setting.revision + 1, changed_by: "Local (sign-in off)", changed_at: "2026-11-04T14:30:00.000Z" },
          effective_field: change.source === "assignee" ? null : (field ?? PROGRAMMER),
        });
      }
      return new Response(JSON.stringify(current), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
  return sent;
}

function Harness({ credit }: { credit: PeopleCredit | undefined }) {
  const [shown, setShown] = useState(credit);
  return <CreditControl credit={shown} failed={false} retrying={false} onRetry={() => setShown(credit)} />;
}

function renderControl(credit: PeopleCredit | undefined) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderKit(
    <QueryClientProvider client={client}>
      <Harness credit={credit} />
    </QueryClientProvider>,
  );
}

const control = () => screen.getByRole("button", { name: /^Counts for:/ });
const dialog = () => screen.getByRole("dialog", { name: "Whom tickets count for" });

beforeEach(() => {
  vi.mocked(notify.ok).mockClear();
  vi.mocked(notify.warn).mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("the words", () => {
  it("say whom every ticket counts for, following the board's setting", () => {
    expect(creditNote({ setting: { source: "auto", field: null, ...NEVER }, effective_field: PROGRAMMER })).toBe(
      "Tickets count for their Programmer in Jira, or their assignee where there is no Programmer.",
    );
    expect(creditNote({ setting: { source: "field", field: TESTERS, ...NEVER }, effective_field: TESTERS })).toBe(
      "Tickets count for their Testers in Jira; tickets without one count for no one.",
    );
    expect(creditNote({ setting: { source: "assignee", field: null, ...NEVER }, effective_field: null })).toBe(
      "Tickets count for their assignee; tickets without one count for no one.",
    );
    expect(creditNote(null)).toBe("Tickets count for the people the board's setting names.");
  });

  it("say what each choice does in one line, and its coverage in words and figures", () => {
    expect(choiceLine({ source: "auto", field: null }, PROGRAMMER)).toBe("Programmer in Jira where it is filled, otherwise the assignee.");
    expect(choiceLine({ source: "auto", field: null }, null)).toBe("The assignee: the site has no Programmer field.");
    expect(choiceLine({ source: "assignee", field: null }, PROGRAMMER)).toBe("The assignee in Jira now. Tickets without one count for no one.");
    expect(choiceLine({ source: "field", field: TESTERS }, PROGRAMMER)).toBe("Testers in Jira. Tickets without it count for no one.");
    const coverage = coverageOf({ source: "auto", field: null, source_filled: 124, credited: 471 }, 475, 90, "en-GB");
    expect([coverage.share, coverage.spoken]).toEqual([">99%", "471 of 475 finished tickets count for someone."]);
    expect(coverageOf({ source: "assignee", field: null, source_filled: 1034, credited: 1034 }, 1200, 90, "en-GB").spoken).toBe(
      "1,034 of 1,200 finished tickets count for someone.",
    );
    expect(coverageOf({ source: "assignee", field: null, source_filled: 1, credited: 1 }, 1, 90, "en-GB").spoken).toBe("1 of 1 finished ticket counts for someone.");
    expect(coverageOf({ source: "assignee", field: null, source_filled: 0, credited: 0 }, 0, 30, "en-GB")).toMatchObject({ share: null, spoken: "No work finished in the last 30 days." });
    expect(savedTitle({ source: "assignee", field: null })).toBe("Tickets now count for the assignee");
    expect(savedTitle({ source: "field", field: TESTERS })).toBe("Tickets now count for Testers in Jira");
    expect(savedTitle({ source: "auto", field: null })).toBe("Tickets now count automatically");
  });
});

describe("the control and its dialog", () => {
  it("names the choice in force beside the period, and keeps its room while the setting loads", () => {
    renderControl(undefined);
    expect(control()).toHaveAccessibleName("Counts for:");
    expect(control()).toHaveAttribute("aria-haspopup", "dialog");
  });

  it("offers every choice as a radio card with its coverage, the one in force checked and marked In use", async () => {
    stubService(body());
    renderControl(body());
    expect(control()).toHaveAccessibleName("Counts for: Assignee");
    fireEvent.click(control());
    const cards = within(dialog()).getAllByRole("radio");
    expect(cards.map((card) => card.getAttribute("aria-labelledby") && document.getElementById(card.getAttribute("aria-labelledby")!)?.textContent)).toEqual([
      "Automatic",
      "Assignee",
      "Programmer",
      "Testers",
    ]);
    const assignee = within(dialog()).getByRole("radio", { name: "Assignee" });
    expect(assignee).toHaveAttribute("aria-checked", "true");
    expect(assignee).toHaveTextContent("In use");
    const automatic = within(dialog()).getByRole("radio", { name: "Automatic" });
    expect(automatic).toHaveTextContent("Recommended");
    expect(automatic).toHaveTextContent("150 of 475 finished tickets count for someone");
    expect(automatic).toHaveAccessibleDescription(/Programmer in Jira where it is filled, otherwise the assignee\. .*150 of 475 finished tickets count for someone/);
    expect(assignee).toHaveTextContent("34 of 475 finished tickets count for someone");
    expect(dialog().querySelector("[data-credit-period]")).toHaveTextContent("Last 90 days · 475 finished");
    // Nothing chosen yet but what is in use: nothing to save, and no list of past changes.
    expect(within(dialog()).getByRole("button", { name: "Save" })).toBeDisabled();
    expect(within(dialog()).queryByRole("list", { name: /Changes/ })).toBeNull();
    expect(within(dialog()).queryByRole("button", { name: /^Undo/ })).toBeNull();
  });

  it("saves a choice at once: the change sent with the revision read, a toast, the dialog closed", async () => {
    const sent = stubService(body());
    renderControl(body());
    fireEvent.click(control());
    fireEvent.click(within(dialog()).getByRole("radio", { name: "Testers" }));
    const save = within(dialog()).getByRole("button", { name: "Save" });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(notify.ok).toHaveBeenCalled());
    expect(sent).toEqual([{ source: "field", field: "testers", revision: 1 }]);
    const [title, options] = vi.mocked(notify.ok).mock.calls[0];
    expect(title).toBe("Tickets now count for Testers in Jira");
    expect(options?.action).toBeUndefined();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("saves with the keyboard's shortcut, and a later change is another save from the revision it made", async () => {
    const sent = stubService(body());
    renderControl(body());
    fireEvent.click(control());
    fireEvent.click(within(dialog()).getByRole("radio", { name: "Programmer" }));
    fireEvent.keyDown(within(dialog()).getByRole("radio", { name: "Programmer" }), { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(sent).toEqual([{ source: "field", field: "programmer", revision: 1 }]));
    await waitFor(() => expect(vi.mocked(notify.ok).mock.calls.map(([title]) => title)).toContain("Tickets now count for Programmer in Jira"));
  });

  it("says a save someone else's overtook under the title, with a way to look again, and changes nothing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
        init?.method === "PUT"
          ? new Response(JSON.stringify({ error: "stale_revision", message: "Someone changed how finished work is counted on this board since you opened it. Look again, then choose." }), {
              status: 409,
              headers: { "content-type": "application/json" },
            })
          : new Response(JSON.stringify(body()), { status: 200, headers: { "content-type": "application/json" } }),
      ),
    );
    renderControl(body());
    fireEvent.click(control());
    fireEvent.click(within(dialog()).getByRole("radio", { name: "Testers" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Save" }));
    const alert = await within(dialog()).findByRole("alert");
    expect(alert).toHaveTextContent("Changed since you opened this");
    expect(alert).toHaveTextContent(/^.*Look again, then choose\./);
    expect(within(alert).getByRole("button", { name: "Look again" })).toBeInTheDocument();
    expect(notify.ok).not.toHaveBeenCalled();
    expect(dialog()).toBeInTheDocument();
  });
});

describe("a board that fills no people field", () => {
  it("is said on the Automatic choice", () => {
    expect(choiceLine({ source: "auto", field: null }, PROGRAMMER, true)).toBe("The assignee: no finished ticket here has a Programmer.");
  });
});
