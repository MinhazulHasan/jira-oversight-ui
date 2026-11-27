import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import findingsJson from "../../../../docs/sample-responses/findings.json";
import issueJson from "../../../../docs/sample-responses/issue-DEMO-1.json";
import { oversightKeys } from "../hooks";
import { invalidateAfterIgnore, useIgnoreFindings, useIgnorePreview, useRestoreCount, useRestoreIgnores } from "../ignore-hooks";
import { normalizeFindingsQuery } from "../params";
import { findingsPageSchema, issueTimelineSchema, type FindingsPage, type IssueTimeline } from "../schemas";

afterEach(() => {
  vi.unstubAllGlobals();
});

const PAGE = findingsPageSchema.parse(findingsJson);
const ISSUE = issueTimelineSchema.parse(issueJson);
const META = PAGE.meta;
const LIST = oversightKeys.findingsList(normalizeFindingsQuery({}));
const TIMELINE = oversightKeys.issueTimeline("DEMO-1");

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  queryClient.setQueryData(LIST, PAGE);
  queryClient.setQueryData(TIMELINE, ISSUE);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return { queryClient, wrapper };
}

/** The route: each request answered by `answer`, every request kept. */
function route(answer: (path: string, body: unknown) => { status?: number; body: unknown }) {
  const calls: { path: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input).replace(/^\/api\/oversight\//, "");
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ path, body });
      const reply = answer(path, body);
      return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
    }),
  );
  return calls;
}

describe("ignoring", () => {
  it("marks the findings it names ignored at once, then reads the figures again", async () => {
    const { queryClient, wrapper } = setup();
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    // The service holds its answer: what the page shows meanwhile is the page's own.
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => {
        await held;
        return new Response(JSON.stringify({ meta: META, ignored: { findings: 1, tickets: 1 }, ignore_ids: ["a".repeat(32)] }), { status: 200 });
      }),
    );
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useIgnoreFindings(), { wrapper });
    const target = PAGE.items.find((finding) => finding.issue_key !== null && finding.state === "open")!;

    act(() => {
      result.current.mutate({ target: { finding_ids: [target.finding_id] }, scope: "finding", reason: "Old" });
    });
    await waitFor(() => expect(queryClient.getQueryData<FindingsPage>(LIST)?.items.find((finding) => finding.finding_id === target.finding_id)?.state).toBe("ignored"));
    const shown = queryClient.getQueryData<FindingsPage>(LIST)!.items.find((finding) => finding.finding_id === target.finding_id)!;
    expect(shown).toMatchObject({ resolved_why: "ignored", ignore: { scope: "finding", rule_id: target.rule_id, reason: "Old", by: null } });
    // Only the finding named: the rest of the page as it was.
    expect(queryClient.getQueryData<FindingsPage>(LIST)!.items.filter((finding) => finding.state === "ignored")).toHaveLength(1);
    expect(result.current.isPending).toBe(true);
    release();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const keys = invalidate.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
    for (const key of [oversightKeys.overview(), oversightKeys.findings(), oversightKeys.people(), oversightKeys.portfolio(), oversightKeys.trends(), oversightKeys.issues()]) {
      expect(keys).toContain(JSON.stringify(key));
    }
  });

  it("puts the findings back as they were when the ignore fails, and never retries it", async () => {
    const { queryClient, wrapper } = setup();
    const calls = route(() => ({ status: 503, body: { error: "upstream_unavailable", message: "Busy." } }));
    const { result } = renderHook(() => useIgnoreFindings(), { wrapper });
    const open = ISSUE.findings.filter((finding) => finding.state === "open");

    act(() => {
      result.current.mutate({ target: { issue_keys: ["DEMO-1"] }, scope: "ticket", reason: null });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(calls).toHaveLength(1);
    expect(queryClient.getQueryData<IssueTimeline>(TIMELINE)!.findings.filter((finding) => finding.state === "open")).toHaveLength(open.length);
  });

  it("waits for the service on an ignore of all that match: nothing on screen is guessed", async () => {
    const { queryClient, wrapper } = setup();
    route(() => ({ body: { meta: META, ignored: { findings: 0, tickets: 0 }, ignore_ids: [] } }));
    const { result } = renderHook(() => useIgnoreFindings(), { wrapper });
    act(() => {
      result.current.mutate({ target: { query: { ticket: "finished" } }, scope: "finding", reason: null });
    });
    expect(queryClient.getQueryData<FindingsPage>(LIST)).toBe(PAGE);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe("the preview", () => {
  it("asks once a body is given, and keeps the answer on screen while another scope is asked", async () => {
    const { wrapper } = setup();
    const calls = route((_path, body) => ({
      body: { meta: META, findings: (body as { scope: string }).scope === "ticket" ? 3 : 1, tickets: 1, by_rule: [{ rule_id: "R-EST-01", rule_title: "A", findings: (body as { scope: string }).scope === "ticket" ? 3 : 1 }], already_ignored: 0 },
    }));
    const target = { finding_ids: ["0b7b3b0f61c477e61699982f24892735"] };
    const { result, rerender } = renderHook(({ scope }: { scope: "finding" | "ticket" | null }) => useIgnorePreview(scope ? { target, scope } : null), {
      wrapper,
      initialProps: { scope: null as "finding" | "ticket" | null },
    });
    expect(calls).toHaveLength(0);
    rerender({ scope: "finding" });
    await waitFor(() => expect(result.current.data?.findings).toBe(1));
    rerender({ scope: "ticket" });
    expect(result.current.data?.findings).toBe(1);
    expect(result.current.isPlaceholderData).toBe(true);
    await waitFor(() => expect(result.current.data?.findings).toBe(3));
  });
});

describe("restoring", () => {
  it("reads the figures again, and follows the board's re-check while the service runs it", async () => {
    const { queryClient, wrapper } = setup();
    const calls = route((path) =>
      path === "findings/restore"
        ? { body: { meta: META, restored: 2, recheck: { state: "running", started_at: "2026-11-04T14:31:00.000Z", finished_at: null, message: null } } }
        : { status: 404, body: { error: "not_found", message: "none" } },
    );
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useRestoreIgnores(), { wrapper });
    act(() => {
      result.current.mutate(["a".repeat(32), "b".repeat(32)]);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls[0]).toEqual({ path: "findings/restore", body: { ignore_ids: ["a".repeat(32), "b".repeat(32)] } });
    await waitFor(() => expect(calls.map((call) => call.path)).toContain("rules/settings"));
    expect(invalidate.mock.calls.some(([filters]) => JSON.stringify(filters?.queryKey) === JSON.stringify(oversightKeys.findings()))).toBe(true);
  });

  it("reads the findings again as a running re-check ends, though the settings never say it ran", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { queryClient, wrapper } = setup();
      route((path) =>
        path === "findings/restore"
          ? { body: { meta: META, restored: 1, recheck: { state: "running", started_at: "2026-11-04T14:31:00.000Z", finished_at: null, message: null } } }
          : { status: 404, body: { error: "not_found", message: "none" } },
      );
      const invalidate = vi.spyOn(queryClient, "invalidateQueries");
      const { result } = renderHook(() => useRestoreIgnores(), { wrapper });
      act(() => {
        result.current.mutate(["a".repeat(32)]);
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const findingsReads = () => invalidate.mock.calls.filter(([filters]) => JSON.stringify(filters?.queryKey) === JSON.stringify(oversightKeys.findings())).length;
      const first = findingsReads();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });
      expect(findingsReads()).toBeGreaterThan(first);
      const later = findingsReads();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(findingsReads()).toBeGreaterThan(later);
    } finally {
      vi.useRealTimers();
    }
  });

  it("every figure an ignore moves is read again", async () => {
    const { queryClient } = setup();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await invalidateAfterIgnore(queryClient);
    expect(invalidate).toHaveBeenCalledTimes(9);
  });
});

describe("what a restore reopens", () => {
  const rule = (id: string) => ({ ...PAGE.items[0], state: "ignored" as const, ignore: { scope: "finding" as const, rule_id: "R-EST-01", reason: null, by: null, at: "2026-11-26T09:15:00.000Z", ignore_id: id.repeat(32) } });
  const whole = (key: string) => ({ ...PAGE.items[0], issue_key: key, state: "ignored" as const, ignore: { scope: "ticket" as const, rule_id: null, reason: null, by: null, at: "2026-11-26T09:15:00.000Z", ignore_id: "c".repeat(32) } });

  it("counts a rule's ignore as the finding itself", () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useRestoreCount([rule("a"), rule("b")], true), { wrapper });
    expect(result.current).toBe(2);
  });

  it("counts a whole ticket's ignore with everything it holds", async () => {
    const { wrapper } = setup();
    route(() => ({
      body: {
        meta: META,
        items: [{ ignore_id: "c".repeat(32), scope: "ticket", issue_key: "DEMO-7", issue_summary: null, issue_type: null, status: null, status_category: null, rule_id: null, rule_title: null, findings: 5, reason: null, by: null, at: "2026-11-26T09:15:00.000Z" }],
        total: 1,
        page: 1,
        page_size: 100,
      },
    }));
    const { result } = renderHook(() => useRestoreCount([rule("a"), whole("DEMO-7")], true), { wrapper });
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toBe(6));
  });
});
