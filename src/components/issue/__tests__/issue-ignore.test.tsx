import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PeopleLevelProvider } from "@/components/shell/people-level";
import { renderKit } from "@/components/ui/__tests__/kit";
import type { IssueTimeline } from "@/lib/api/schemas";
import { notify } from "@/lib/notify";

import { IssueFindings } from "../issue-findings";
import { DEMO_1, demo1With } from "./fixtures";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/issues/DEMO-1",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

const META = DEMO_1.meta;
const OPEN = DEMO_1.findings.filter((finding) => finding.state === "open");

function stubApi() {
  const posts: { path: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).replace(/^\/api\/oversight\//, "");
      if (init?.method === "POST") posts.push({ path, body: JSON.parse(String(init.body)) });
      const body =
        path === "findings/ignore/preview"
          ? { meta: META, findings: OPEN.length, tickets: 1, by_rule: OPEN.map((finding) => ({ rule_id: finding.rule_id, rule_title: finding.rule_title, findings: 1 })), already_ignored: 0 }
          : path === "findings/ignore"
            ? { meta: META, ignored: { findings: OPEN.length, tickets: 1 }, ignore_ids: ["f6".repeat(16)] }
            : { meta: META };
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  return posts;
}

function renderFindings(data: IssueTimeline, peopleLevel = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderKit(
    <QueryClientProvider client={client}>
      <NuqsTestingAdapter hasMemory>
        <PeopleLevelProvider peopleLevel={peopleLevel}>
          <IssueFindings data={data} />
        </PeopleLevelProvider>
      </NuqsTestingAdapter>
    </QueryClientProvider>,
  );
}

describe("the ticket page's findings", () => {
  it("ignores every rule on the ticket from one button, the scope said rather than chosen", async () => {
    expect(OPEN.length).toBeGreaterThan(1);
    const user = userEvent.setup();
    const ok = vi.spyOn(notify, "ok");
    const posts = stubApi();
    renderFindings(DEMO_1);

    await user.click(screen.getByRole("button", { name: "Ignore all on this ticket" }));

    const dialog = await screen.findByRole("dialog", { name: `Ignore ${OPEN.length} findings?` });
    expect(within(dialog).queryByRole("radio")).toBeNull();
    await waitFor(() => expect(within(dialog).getByLabelText(/Reason/)).toHaveFocus());
    await user.click(within(dialog).getByRole("button", { name: `Ignore ${OPEN.length} findings` }));
    await waitFor(() => expect(posts.map((post) => post.path)).toEqual(["findings/ignore/preview", "findings/ignore"]));
    expect(posts[1].body).toEqual({ target: { issue_keys: ["DEMO-1"] }, scope: "ticket", reason: null });
    await waitFor(() => expect(ok).toHaveBeenCalledWith(`Ignored ${OPEN.length} findings`, expect.objectContaining({ action: expect.anything() })));
  });

  it("marks an ignored finding and counts it apart, and has nothing to ignore once none is open", async () => {
    const ignored = demo1With((data) => {
      for (const finding of data.findings) {
        if (finding.state !== "open") continue;
        finding.state = "ignored";
        finding.resolved_at = "2026-11-04T14:30:00.000Z";
        finding.resolved_why = "ignored";
        finding.ignore = { scope: "ticket", rule_id: null, reason: null, by: "Morgan Ellis", at: "2026-11-04T14:30:00.000Z" };
      }
    });
    stubApi();
    renderFindings(ignored);
    const table = screen.getByRole("table", { name: "Findings on DEMO-1" });
    await waitFor(() => expect(within(table).getAllByText(/^Ignored by Morgan Ellis on (4 Nov|Nov 4,) 2026$/)).toHaveLength(OPEN.length));
    expect(screen.getByText("ignored", { exact: false, selector: "div" })).toHaveTextContent(`0 open, ${DEMO_1.findings.length - OPEN.length} resolved, ${OPEN.length} ignored`);
    expect(screen.queryByRole("button", { name: "Ignore all on this ticket" })).toBeNull();
    expect(screen.getByRole("button", { name: "Restore all on this ticket" })).toBeEnabled();
  });

  it("offers nothing to a reader below the people level", async () => {
    stubApi();
    renderFindings(DEMO_1, false);
    await act(async () => undefined);
    expect(screen.queryByRole("button", { name: "Ignore all on this ticket" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Restore/ })).toBeNull();
  });
});
