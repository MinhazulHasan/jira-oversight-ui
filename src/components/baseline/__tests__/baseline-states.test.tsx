import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BaselineActions } from "../baseline-actions";
import { BaselineView } from "../baseline-view";
import { asReader, json, renderWithData, SAMPLE, sampleWith, serve } from "./render";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  asReader();
});

describe("the baseline's states", () => {
  it("holds every block's final shape while the report loads", () => {
    serve(() => new Promise<Response>(() => undefined));
    renderWithData(<BaselineView />);

    expect(screen.getByText("Loading the baseline report")).toBeInTheDocument();
    expect(screen.getByText("Loading the coverage of resolved work")).toBeInTheDocument();
    expect(screen.getByText("Loading hours in each status")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says plainly that there is no baseline yet, and how one is made, with no button that cannot help (SQA)", async () => {
    serve(() => json({ error: "not_found", message: "No baseline report has been generated yet." }, 404));
    renderWithData(<BaselineView />);

    expect(await screen.findByText("No baseline yet")).toBeInTheDocument();
    expect(screen.getByText("Your administrator can make one for this board.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    // A sync never writes one: "Check again" could never help.
    expect(screen.queryByRole("button", { name: "Check again" })).toBeNull();
  });

  it("says once, inline, when the report cannot be loaded, and tries again", async () => {
    const user = userEvent.setup();
    let fail = true;
    serve(() => (fail ? json({ error: "upstream_timeout", message: "The oversight service did not answer." }, 503) : json(SAMPLE)));
    renderWithData(<BaselineView />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load the baseline report");
    expect(alert).toHaveTextContent("HTTP 503 · upstream_timeout");
    expect(screen.getAllByRole("alert")).toHaveLength(1);

    fail = false;
    await user.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText("About this report")).toBeInTheDocument();
  });

  it("says what was looked at when nothing was resolved", async () => {
    serve(() =>
      json(
        sampleWith((body) => {
          body.metadata.comparison_status = "skipped";
          body.metadata.comparison_note = "";
          body.comparison = [];
          body.figures.resolved.in_window = 0;
          body.figures.time_in_status = {};
        }),
      ),
    );
    renderWithData(<BaselineView />);

    expect(await screen.findAllByText("Nothing was resolved in the window")).toHaveLength(2);
    expect(screen.getByLabelText("About this report")).not.toHaveTextContent(/compared/i);
    expect(screen.getAllByText(/No issue was resolved in this window/)).toHaveLength(2);
    expect(screen.getByText("No time in status to show")).toBeInTheDocument();
  });

  it("flags stale metrics, issues without metrics and a newer sync", async () => {
    serve(() =>
      json(
        sampleWith((body) => {
          body.metadata.metrics_stale = true;
          body.metadata.issues_without_metrics = 3;
          body.metadata.last_synced_at = "2026-11-03T14:28:00.000Z";
        }),
      ),
    );
    renderWithData(<BaselineView />);

    expect(await screen.findByText("The derived metrics predate the sync")).toBeInTheDocument();
    expect(screen.getByText("Some issues have no derived metrics").closest("aside")).toHaveTextContent("3 issues have no metrics");
    expect(screen.getByText("Jira has been synced since this report")).toBeInTheDocument();
  });
});

describe("the page actions", () => {
  it("copy the link and print the page, and export nothing (the audit comparison is gone)", async () => {
    const user = userEvent.setup();
    const print = vi.fn();
    vi.stubGlobal("print", print);
    serve(() => json(SAMPLE));
    renderWithData(<BaselineActions />);

    await user.click(screen.getByRole("button", { name: "Print" }));
    expect(print).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export CSV" })).toBeNull();
  });
});
