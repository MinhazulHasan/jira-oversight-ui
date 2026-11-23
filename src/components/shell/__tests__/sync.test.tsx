import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => mocked.pathname }));
vi.mock("@/lib/notify", () => ({
  notify: { ok: vi.fn(), cite: vi.fn(), warn: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));

const mocked = vi.hoisted(() => ({ pathname: "/findings" }));

import { useQuery } from "@tanstack/react-query";

import { getOverview } from "@/lib/api/client";
import { SYNC_POLL_MS } from "@/lib/api/hooks";
import type { Refresh } from "@/lib/api/schemas";
import { notify } from "@/lib/notify";

import { BoardGate, readsOneBoard } from "../board-gate";
import { LastSynced } from "../last-synced";
import { PeopleLevelProvider } from "../people-level";
import { forgetAnnouncedSyncs, SyncFollower } from "../sync-follower";
import { board, calls, idle, pick, renderWithQueries, serve, SYNCED_AT, type Service } from "./boards-harness";

/*
 * Sync syncs the board on screen and no other (JO-18): the top bar's Sync
 * says which board, in its name and tooltip; a press starts that board's
 * sync, queued behind another board's while one runs; it says "Syncing",
 * then reads every figure again and says so; a failure says why. A board not
 * synced yet (JO-17) shows, on every page that reads it, the state that offers
 * its first sync, with its progress, and the page itself once it has synced.
 */

const NOW = () => new Date().toISOString();

function service(overrides: Partial<Service> = {}): Service {
  return {
    projects: { default: "ALPHA", projects: [board("ALPHA", "Alpha programme"), board("HELP", "Help desk", false)] },
    refresh: { ALPHA: idle("ALPHA"), HELP: idle("HELP") },
    ...overrides,
  };
}

const running = (project: string): Refresh => ({ project, state: "running", started_at: NOW(), finished_at: null, message: null });
const succeeded = (project: string): Refresh => ({ project, state: "succeeded", started_at: SYNCED_AT, finished_at: NOW(), message: null });

/** The top bar's Sync, with the shell's follower, as the (app) layout mounts them. */
function renderSync() {
  return renderWithQueries(
    <>
      <LastSynced />
      <SyncFollower />
    </>,
  );
}

const syncButton = () => screen.findByRole("button", { name: "Sync Alpha programme" });
/** The pill a Sync button is the mark of, which draws the state beside it. */
const pill = (button: HTMLElement) => button.closest<HTMLElement>("[data-sync-now]");

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  pick(null);
  forgetAnnouncedSyncs();
  mocked.pathname = "/findings";
});

afterEach(() => {
  vi.useRealTimers();
  pick(null);
  vi.mocked(notify.ok).mockClear();
  vi.mocked(notify.info).mockClear();
  vi.mocked(notify.warn).mockClear();
});

describe("the top bar's Sync", () => {
  it("is named by its action alone, with when that board last synced as its description (SQA)", async () => {
    serve(service());
    renderSync();
    const button = await syncButton();
    // Regression: the name read "Stale · last synced 4 Nov 2026, 8:28 PM · 13 d ago . Sync Demo project".
    expect(button).toHaveAccessibleName("Sync Alpha programme");
    expect(button).toHaveAccessibleDescription(/^Last synced .+, 4\smin ago\.$/);
    expect(button).toHaveAttribute("data-sync-state", "synced");
    // The state is drawn beside the button, which is the pill's mark: no words on the button itself (WCAG 2.5.3).
    expect(button).toHaveTextContent("");
    expect(pill(button)).toHaveTextContent(/4\smin ago/);
  });

  it("syncs the board on screen: Syncing while it runs, then every figure read again, and says so", async () => {
    const answers = service({ started: { ALPHA: running("ALPHA") } });
    const fetchMock = serve(answers);
    const { client } = renderSync();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    fireEvent.click(await syncButton());

    const busy = await screen.findByRole("button", { name: "Sync Alpha programme", description: "Syncing" });
    expect(busy).toHaveAttribute("aria-disabled", "true");
    expect(busy).toHaveAttribute("data-sync-state", "running");
    // A second press while it runs starts nothing more.
    fireEvent.click(busy);
    expect(calls(fetchMock, "refresh").filter((call) => call.method === "POST")).toHaveLength(1);

    answers.refresh.ALPHA = succeeded("ALPHA");
    await act(() => vi.advanceTimersByTimeAsync(SYNC_POLL_MS));
    await waitFor(() => expect(notify.ok).toHaveBeenCalledWith("Alpha programme synced", expect.anything()));
    expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["oversight"] }));
    expect(notify.ok).toHaveBeenCalledTimes(1);
    expect(await syncButton()).toHaveAttribute("data-sync-state", "synced");
  });

  it("says Queued while another board's sync runs, and that it will start after it", async () => {
    serve(service({ started: { ALPHA: { ...idle("ALPHA"), state: "queued" } } }));
    renderSync();
    fireEvent.click(await syncButton());
    const queued = await screen.findByRole("button", { name: "Sync Alpha programme", description: "Queued" });
    expect(pill(queued)).toHaveTextContent("Queued");
    expect(notify.info).toHaveBeenCalledWith("Alpha programme is queued", { id: "sync-ALPHA", description: "It starts when the sync before it ends." });
  });

  it("says a sync that failed, why, and that it failed, until one succeeds", async () => {
    const failed: Refresh = { project: "ALPHA", state: "failed", started_at: NOW(), finished_at: NOW(), message: "Jira did not answer in time." };
    serve(service({ started: { ALPHA: failed } }));
    renderSync();
    fireEvent.click(await syncButton());
    await waitFor(() =>
      expect(notify.warn).toHaveBeenCalledWith("Alpha programme didn't sync", { id: "sync-ALPHA", description: "Jira did not answer in time." }),
    );
    const button = await syncButton();
    await waitFor(() => expect(button).toHaveAttribute("data-sync-state", "failed"));
    expect(pill(button)).toHaveTextContent(/Sync failed/);
    expect(button).toHaveAccessibleDescription(/^Sync failed\. Last synced /);
  });

  for (const [what, answer] of [
    ["the service down", () => Response.json({ error: "upstream_unavailable", message: "The oversight service cannot be reached right now." }, { status: 503 })],
    ["a gateway's bare 502", () => new Response("<html>Bad gateway</html>", { status: 502 })],
  ] as const) {
    it(`says when the press could not reach the service (${what}) in plain words, and keeps saying it failed (SQA)`, async () => {
      const fetchMock = serve(service());
      renderSync();
      const button = await syncButton();
      fetchMock.mockImplementation(async () => answer());
      fireEvent.click(button);
      // Regression: the toast read "The request failed (HTTP 502)." and Sync showed no failure once it had gone.
      await waitFor(() =>
        expect(notify.warn).toHaveBeenCalledWith("Couldn't sync Alpha programme", { id: "sync-ALPHA", description: "Couldn't reach the service. Try again." }),
      );
      await waitFor(() => expect(button).toHaveAttribute("data-sync-state", "failed"));
      expect(pill(button)).toHaveTextContent(/Sync failed/);
    });
  }

  it("says a refusal this dashboard explains in its own words", async () => {
    const fetchMock = serve(service());
    renderSync();
    const button = await syncButton();
    fetchMock.mockImplementation(async () =>
      Response.json({ error: "board_not_allowed", message: "Your Jira account cannot open the board picked in the top bar. Pick one of yours." }, { status: 403 }),
    );
    fireEvent.click(button);
    await waitFor(() =>
      expect(notify.warn).toHaveBeenCalledWith("Couldn't sync Alpha programme", {
        id: "sync-ALPHA",
        description: "Your Jira account cannot open the board picked in the top bar. Pick one of yours.",
      }),
    );
  });

  it("says a board not synced yet, and a press starts its first sync", async () => {
    pick("HELP");
    const fetchMock = serve(service({ started: { HELP: running("HELP") } }));
    renderSync();
    const button = await screen.findByRole("button", { name: "Sync Help desk", description: "Not synced yet" });
    expect(button).toHaveAttribute("data-sync-state", "not-synced");
    fireEvent.click(button);
    expect(await screen.findByRole("button", { name: "Sync Help desk", description: "Syncing" })).toBeInTheDocument();
    expect(calls(fetchMock, "refresh").some((call) => call.method === "POST")).toBe(true);
  });
});

describe("the pages a board not synced yet shows", () => {
  function Overview() {
    const overview = useQuery({ queryKey: ["oversight", "overview"], queryFn: () => getOverview(), retry: false });
    return <p>{overview.isError ? `The page's own error: ${overview.error.message}` : "The page"}</p>;
  }

  function renderPage() {
    return renderWithQueries(
      <PeopleLevelProvider peopleLevel>
        <BoardGate>
          <Overview />
        </BoardGate>
        <SyncFollower />
      </PeopleLevelProvider>,
    );
  }

  it("reads one board on every page but the Portfolio, the access log and usage", () => {
    for (const path of ["/", "/findings", "/ask", "/insights", "/process", "/baseline", "/governance/rules", "/issues/HELP-1"]) {
      expect(readsOneBoard(path, true), path).toBe(true);
    }
    for (const path of ["/portfolio", "/governance/access-log", "/governance/usage", "/governance", "/nowhere"]) expect(readsOneBoard(path, true), path).toBe(false);
    // The People page is not found for a team-level reader, whatever the board.
    expect(readsOneBoard("/people", true)).toBe(true);
    expect(readsOneBoard("/people", false)).toBe(false);
  });

  it("offers the board's first sync in the page's place, in plain words, under the page's own heading", async () => {
    pick("HELP");
    serve(service());
    renderPage();
    const state = await screen.findByRole("region", { name: "Help desk hasn’t been synced yet." });
    expect(screen.getByRole("heading", { level: 1, name: "Findings" })).toBeInTheDocument();
    expect(within(state).getByText("The first sync of a large board can take a few minutes.")).toBeInTheDocument();
    expect(within(state).getByRole("button", { name: "Sync Help desk" })).toBeInTheDocument();
    expect(screen.queryByText(/The page/)).toBeNull();
  });

  it("shows its progress, keeps the focus on its button, and fills in the page once the sync has run", async () => {
    pick("HELP");
    const answers = service({ started: { HELP: running("HELP") } });
    serve(answers);
    renderPage();
    const button = await screen.findByRole("button", { name: "Sync Help desk" });
    button.focus();
    fireEvent.click(button);
    const progress = await screen.findByRole("progressbar", { name: "Syncing Help desk" });
    expect(progress).toBeInTheDocument();
    expect(button).toHaveTextContent("Syncing Help desk…");
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent(/^Started \d{1,2}:\d{2}\s[AP]M\.$/);

    // The first sync ends: the board list says HELP has synced, and the page renders in the state's place.
    answers.refresh.HELP = succeeded("HELP");
    answers.projects = { ...answers.projects, projects: [board("ALPHA", "Alpha programme"), board("HELP", "Help desk")] };
    await act(() => vi.advanceTimersByTimeAsync(SYNC_POLL_MS));
    expect(await screen.findByText(/The page/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /hasn’t been synced yet/ })).toBeNull();
    expect(notify.ok).toHaveBeenCalledWith("Help desk synced", expect.anything());
  });

  it("says when the first sync is queued, and when it failed, offering it again", async () => {
    pick("HELP");
    const answers = service({ started: { HELP: { ...idle("HELP"), state: "queued" } } });
    serve(answers);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Sync Help desk" }));
    expect(await screen.findByRole("progressbar", { name: "Help desk is queued" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("It starts when the sync before it ends.");

    answers.refresh.HELP = { project: "HELP", state: "failed", started_at: NOW(), finished_at: NOW(), message: "Jira did not answer in time." };
    await act(() => vi.advanceTimersByTimeAsync(SYNC_POLL_MS));
    // The service's words alone, said once (SQA: "The last sync didn't finish. The sync failed while copying...").
    expect(await screen.findByRole("alert")).toHaveTextContent(/^Jira did not answer in time\.$/);
    expect(screen.getByRole("button", { name: "Sync Help desk" })).toBeInTheDocument();
  });

  it("leaves the pages that read no one board alone", async () => {
    pick("HELP");
    mocked.pathname = "/portfolio";
    serve(service());
    renderPage();
    expect(await screen.findByText(/The page/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /hasn’t been synced yet/ })).toBeNull();
  });

  it("shows the page for a synced board", async () => {
    serve(service());
    renderPage();
    await waitFor(() => expect(screen.getByText(/The page/)).toBeInTheDocument());
    expect(screen.queryByRole("region", { name: /hasn’t been synced yet/ })).toBeNull();
  });
});
