import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { renderKit } from "@/components/ui/__tests__/kit";
import { ApiError } from "@/lib/api/client";
import type { PersonSummary } from "@/lib/api/schemas";

import { MAX_PEOPLE, PersonFindings, topPeople } from "../person-findings";
import { peopleFixture } from "./fixture";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const LONG_NAME = `Maximiliana ${"Featherstonehaugh-".repeat(6)}Wolfeschlegelsteinhausenbergerdorff`.slice(0, 128);

/** A named row with these open findings, its id made from its place. */
function personRow(index: number, name: string, breaches: number, warnings: number): PersonSummary {
  const open = breaches + warnings;
  return {
    person: { id: `p${index.toString(16).padStart(12, "0")}`, name, avatar: null },
    tickets: Math.max(1, open),
    open_tickets: 1,
    open_breaches: breaches,
    open_warnings: warnings,
    tickets_with_findings: open > 0 ? 1 : 0,
  };
}

function list() {
  return within(screen.getByRole("region", { name: "People" })).getByRole("list", { name: "Open findings by person" });
}

describe("Open findings by person", () => {
  it("ranks the people by open breaches, then warnings, each row opening exactly their open findings", () => {
    renderKit(<PersonFindings data={peopleFixture()} />);

    const rows = within(list()).getAllByRole("link");
    // The sample's eight fictional people and the unassigned tickets.
    expect(rows).toHaveLength(9);
    expect(rows[0]).toHaveTextContent("Carmen Ruiz");
    expect(rows[0]).toHaveAttribute("href", "/findings?state=open&person=p599114b761a6");
    expect(within(rows[0]).getByText("88 breaches and 36 warnings")).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent("Dev Malhotra");
    expect(rows[8]).toHaveTextContent("Unassigned");
    expect(within(rows[8]).getByText("Unassigned")).toHaveClass("text-ink-low");
    expect(within(rows[0]).getByText("Carmen Ruiz")).toHaveClass("text-ink");
    expect(rows[8]).toHaveAttribute("href", "/findings?state=open&person=unassigned");
    expect(within(rows[8]).getByText("15 breaches and 1 warning")).toBeInTheDocument();

    // Everyone fits, so nothing says "top".
    expect(screen.getByText("Most breaches first")).toBeInTheDocument();
    expect(screen.getByText("Carmen Ruiz leads, with 88 open breaches and 36 open warnings on 117 tickets.")).toHaveClass("sr-only");
    expect(screen.getByText("Issue findings only.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /All people/ })).toHaveAttribute("href", "/findings?state=open&menu=person");
  });

  it("lines each part's figures up in a column, however many digits a row has", () => {
    renderKit(<PersonFindings data={peopleFixture()} />);
    const rows = within(list()).getAllByRole("link");
    const figures = (row: HTMLElement) => Array.from(row.querySelectorAll<HTMLElement>("[data-figure]"));
    // Carmen Ruiz has 88 and 36; the unassigned tickets 15 and 1: both warning figures keep two digits' room.
    expect(figures(rows[0]).map((figure) => figure.textContent)).toEqual(["88", "36"]);
    expect(figures(rows[8]).map((figure) => figure.textContent)).toEqual(["15", "1"]);
    expect(figures(rows[8]).map((figure) => figure.style.minWidth)).toEqual(["2ch", "2ch"]);
  });

  it("puts each person's picture, or initials, beside their name, and a generic figure beside Unassigned; never an id", () => {
    const { container } = renderKit(<PersonFindings data={peopleFixture()} />);
    const rows = within(list()).getAllByRole("link");
    const avatar = (row: HTMLElement) => row.querySelector<HTMLElement>(".jo-avatar");
    // Carmen Ruiz has a picture in the sample, Dev Malhotra none.
    expect(avatar(rows[0])?.querySelector("img")).toHaveAttribute(
      "src",
      expect.stringMatching(/^\/api\/oversight\/people\/p599114b761a6\/avatar\?v=[0-9a-f]{12}$/),
    );
    expect(avatar(rows[1])).toHaveAttribute("data-initials", "DM");
    expect(avatar(rows[8])).toHaveAttribute("data-avatar", "none");
    for (const row of rows) expect(avatar(row)).toHaveAttribute("aria-hidden", "true");
    // Beside the name, never in its place: the row still reads and copies as the name.
    expect(rows[1]).toHaveTextContent(/^Dev Malhotra/);
    expect(container.textContent).not.toMatch(/p[0-9a-f]{12}/);
    expect(container.textContent).not.toMatch(/@/);
  });

  it("shows the same figures as a table, with each person's open tickets", async () => {
    const user = userEvent.setup();
    renderKit(<PersonFindings data={peopleFixture()} />);

    await user.click(screen.getByRole("radio", { name: "Table" }));
    const table = screen.getByRole("table", { name: "Open findings by person" });
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Person",
      "Breaches",
      "Warnings",
      "Total",
      "Tickets not done",
      "Tickets with open findings",
    ]);
    // A name is running text in the table too: proportional figures, so a hyphen stays tight.
    expect(within(table).getByText("Carmen Ruiz")).toHaveClass("normal-nums");
    const body = within(table).getAllByRole("row").slice(1);
    expect(body).toHaveLength(9);
    // Open tickets are the board's work, Epics left out, as the scorecard counts them (JO-12, G5).
    expect(body[0]).toHaveTextContent(/Carmen Ruiz\s*88\s*36\s*124\s*7\s*117/);
    expect(body[8]).toHaveTextContent(/Unassigned\s*15\s*1\s*16\s*9\s*16/);
  });

  it("shows the top eight and keeps the unassigned tickets as their own row whatever their rank", () => {
    const people = Array.from({ length: 12 }, (_, index) => personRow(index + 1, `Person ${index + 1}`, 40 - index * 3, 2));
    const unassigned: PersonSummary = { ...personRow(99, "x", 1, 0), person: null };
    renderKit(<PersonFindings data={peopleFixture((draft) => void (draft.people = [...people, unassigned]))} />);

    const rows = within(list()).getAllByRole("link");
    expect(rows).toHaveLength(MAX_PEOPLE + 1);
    expect(rows.at(-2)).toHaveTextContent("Person 8");
    expect(rows.at(-1)).toHaveTextContent("Unassigned");
    expect(screen.getByText("Top eight, most breaches first, then unassigned")).toBeInTheDocument();
    expect(screen.getByText("Showing 8 of 12 people. Issue findings only.")).toBeInTheDocument();
  });

  it("puts nobody in a row of their own when everyone is assigned", () => {
    renderKit(<PersonFindings data={peopleFixture((draft) => void (draft.people = draft.people.filter((row) => row.person)))} />);
    const rows = within(list()).getAllByRole("link");
    expect(rows).toHaveLength(8);
    expect(within(list()).queryByText("Unassigned")).not.toBeInTheDocument();
    expect(screen.getByText("Most breaches first")).toBeInTheDocument();
  });

  it("keeps a long name whole for screen readers and cuts it short on screen", () => {
    renderKit(
      <PersonFindings data={peopleFixture((draft) => void (draft.people[0].person = { id: "p0123456789ab", name: LONG_NAME, avatar: null }))} />,
    );
    const first = within(list()).getAllByRole("link")[0];
    const name = within(first).getByText(LONG_NAME);
    expect(name).toHaveClass("truncate");
  });

  it("holds its shape while the people load, and says so", () => {
    renderKit(<PersonFindings />);
    expect(screen.getByRole("heading", { level: 2, name: "People" })).toBeInTheDocument();
    expect(screen.getByText("Loading open findings by person")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Open findings by person" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Table" })).not.toBeInTheDocument();
  });

  it("says what was looked at when nobody has an open finding", () => {
    renderKit(
      <PersonFindings
        data={peopleFixture((draft) => {
          for (const row of draft.people) {
            row.open_breaches = 0;
            row.open_warnings = 0;
            row.tickets_with_findings = 0;
          }
        })}
      />,
    );
    expect(screen.getByText("No open findings on anyone's work")).toBeInTheDocument();
    expect(screen.queryByText("Nothing is open.")).toBeNull();
    expect(screen.queryByRole("list", { name: "Open findings by person" })).not.toBeInTheDocument();
  });

  it("says so when the board has no tickets at all", () => {
    renderKit(<PersonFindings data={peopleFixture((draft) => void (draft.people = []))} />);
    expect(screen.getByText("No tickets are assigned")).toBeInTheDocument();
  });

  it("fails inline, on its own, with a retry", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    renderKit(<PersonFindings error={new ApiError(503, "upstream_unavailable", "Down.")} onRetry={onRetry} />);

    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("Couldn't load the people")).toBeInTheDocument();
    expect(within(alert).getByText("HTTP 503 · upstream_unavailable")).toBeInTheDocument();
    await user.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("topPeople", () => {
  it("keeps the API's order and adds the unassigned row only when it falls outside the top", () => {
    const rows = [personRow(1, "A", 3, 0), { ...personRow(2, "x", 2, 0), person: null }, personRow(3, "B", 1, 0)];
    expect(topPeople(rows, 2)).toEqual(rows.slice(0, 2));
    expect(topPeople([rows[0], rows[2], rows[1]], 2)).toEqual([rows[0], rows[2], rows[1]]);
    expect(topPeople([], 2)).toEqual([]);
  });

  it("lists only people with something open (SQA: rows of 0 and 0 filled half the top eight)", () => {
    const rows = [personRow(1, "A", 3, 0), personRow(2, "B", 0, 1), personRow(3, "C", 0, 0), { ...personRow(4, "x", 0, 0), person: null }];
    expect(topPeople(rows, 8)).toEqual(rows.slice(0, 2));
  });
});
