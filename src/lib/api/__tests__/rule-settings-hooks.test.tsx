import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import askJson from "../../../../docs/sample-responses/ask-answered.json";
import draftJson from "../../../../docs/sample-responses/rule-settings-draft.json";
import previewJson from "../../../../docs/sample-responses/rule-settings-preview.json";
import settingsJson from "../../../../docs/sample-responses/rule-settings.json";
import { getRuleSettings, postAsk, postRefresh, postRuleDraft, postRuleSettings, postRuleSettingsPreview } from "../client";
import {
  oversightKeys,
  RULE_SETTINGS_POLL_MS,
  useRecheckFollower,
  useRuleDraft,
  useRuleSettings,
  useRuleSettingsPreview,
  useSaveRuleSettings,
} from "../hooks";
import { ruleDraftSchema, ruleSettingsSchema, type RuleSettings } from "../schemas";

const settings = ruleSettingsSchema.parse(settingsJson);

/** The settings after a save, the service re-checking the board. */
const running: RuleSettings = ruleSettingsSchema.parse({
  ...settings,
  revision: 1,
  updated_at: "2026-11-04T14:31:00.000Z",
  updated_by: "Morgan Ellis",
  apply: { state: "running", applied_revision: 0, started_at: "2026-11-04T14:31:00.000Z", finished_at: null, message: null, result: null },
  rules: settings.rules.map((rule) => (rule.rule_id === "W-AGE-01" ? { ...rule, enabled: false, customised: true } : rule)),
  history: [
    {
      change_id: "a".repeat(32),
      at: "2026-11-04T14:31:00.000Z",
      revision: 1,
      by: { hash: "local", name: "Local (sign-in off)" },
      reason: null,
      undo_of: null,
      changes: [{ rule_id: "W-AGE-01", field: "enabled", from: true, to: false }],
    },
  ],
});

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
}

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

/** The route, answering each request with the next body handed to it (the last one again once they run out). */
function route(...bodies: unknown[]) {
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(bodies.length > 1 ? bodies.shift() : bodies[0]), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the client", () => {
  it("reads the settings, and sends a preview and a save as JSON with a referrer policy of its own, so the real Origin goes with them", async () => {
    const fetchMock = route(settings);
    await getRuleSettings();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/oversight/rules/settings");
    route(previewJson);
    const body = { changes: [{ rule_id: "R-EFF-01", params: { threshold: 2 } }] };
    await postRuleSettingsPreview(body);
    const [previewUrl, previewInit] = vi.mocked(fetch).mock.calls[0];
    expect(previewUrl).toBe("/api/oversight/rules/settings/preview");
    expect(previewInit).toMatchObject({ method: "POST", body: JSON.stringify(body), referrerPolicy: "same-origin", credentials: "same-origin", cache: "no-store" });
    expect(previewInit?.headers).toMatchObject({ "content-type": "application/json", accept: "application/json" });
    route(running);
    await postRuleSettings({ revision: 0, ...body, reason: "Agreed" });
    const [saveUrl, saveInit] = vi.mocked(fetch).mock.calls[0];
    expect(saveUrl).toBe("/api/oversight/rules/settings");
    expect(JSON.parse(String(saveInit?.body))).toEqual({ revision: 0, changes: body.changes, reason: "Agreed" });
  });

  it("sends a question and Sync now the same way: with a referrer policy of their own, so the route sees the real Origin", async () => {
    const fetchMock = route(askJson);
    await postAsk("Where do tickets get stuck most?", ["p0123456789ab"]);
    const [askUrl, askInit] = fetchMock.mock.calls[0];
    expect(askUrl).toBe("/api/oversight/ask");
    expect(askInit).toMatchObject({ method: "POST", referrerPolicy: "same-origin", credentials: "same-origin" });
    expect(askInit?.headers).toMatchObject({ "content-type": "application/json" });
    expect(JSON.parse(String(askInit?.body))).toEqual({ question: "Where do tickets get stuck most?", mentions: ["p0123456789ab"] });

    const synced = route({ project: "DEMO", state: "running", started_at: "2026-11-04T14:31:00.000Z", finished_at: null, message: null });
    await postRefresh();
    const [syncUrl, syncInit] = synced.mock.calls[0];
    expect(syncUrl).toBe("/api/oversight/refresh");
    expect(syncInit).toMatchObject({ method: "POST", referrerPolicy: "same-origin" });
    expect(syncInit?.body).toBeUndefined();
  });

  it("sends an AI draft's words as JSON the same way, and reads the draft against the contract", async () => {
    const fetchMock = route(draftJson);
    const drafted = await postRuleDraft("Bugs in progress for more than 3 days");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/oversight/rules/settings/draft");
    expect(init).toMatchObject({ method: "POST", referrerPolicy: "same-origin", credentials: "same-origin", cache: "no-store" });
    expect(init?.headers).toMatchObject({ "content-type": "application/json" });
    expect(JSON.parse(String(init?.body))).toEqual({ text: "Bugs in progress for more than 3 days" });
    expect(drafted).toEqual(ruleDraftSchema.parse(draftJson));
  });

  it("raises the route's refusal with its code and each problem's place", async () => {
    const refusal = { error: "rule_settings_invalid", message: "Refused.", issues: [{ path: "W-EFF-01.params.threshold", message: "Must stay below R-EFF-01's." }] };
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response(JSON.stringify(refusal), { status: 422 })));
    await expect(postRuleSettings({ revision: 0, changes: [{ rule_id: "W-EFF-01", params: { threshold: 1.6 } }] })).rejects.toMatchObject({
      status: 422,
      code: "rule_settings_invalid",
      issues: refusal.issues,
    });
  });
});

describe("the hooks", () => {
  it("read the settings every two seconds while the service re-checks the board, and stop once it is done", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const applied = { ...running, apply: { ...running.apply, state: "applied", applied_revision: 1, finished_at: "2026-11-04T14:31:02.000Z", result: { opened: 0, closed: 14 } } };
    const fetchMock = route(running, running, applied);
    const { result } = renderHook(() => useRuleSettings(), { wrapper: wrapperFor(client()) });
    await waitFor(() => expect(result.current.data?.apply.state).toBe("running"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(RULE_SETTINGS_POLL_MS));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(RULE_SETTINGS_POLL_MS));
    await waitFor(() => expect(result.current.data?.apply.state).toBe("applied"));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(() => vi.advanceTimersByTimeAsync(RULE_SETTINGS_POLL_MS * 3));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("are held back for a reader who may not see them", () => {
    const fetchMock = route(settings);
    renderHook(() => useRuleSettings({ enabled: false }), { wrapper: wrapperFor(client()) });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("on a save, show the settings it answered and mark every figure the rules decide as stale; a preview changes nothing", async () => {
    const queryClient = client();
    for (const key of [oversightKeys.rules(), oversightKeys.overview(), oversightKeys.findings(), oversightKeys.people(), oversightKeys.portfolio(), oversightKeys.usage()]) {
      queryClient.setQueryData(key, { cached: true });
    }
    route(previewJson);
    const preview = renderHook(() => useRuleSettingsPreview(), { wrapper: wrapperFor(queryClient) });
    await act(() => preview.result.current.mutateAsync({ changes: [{ rule_id: "W-AGE-01", enabled: false }] }));
    expect(queryClient.getQueryState(oversightKeys.rules())?.isInvalidated).toBe(false);

    route(running);
    const save = renderHook(() => useSaveRuleSettings(), { wrapper: wrapperFor(queryClient) });
    await act(() => save.result.current.mutateAsync({ revision: 0, changes: [{ rule_id: "W-AGE-01", enabled: false }] }));
    expect(queryClient.getQueryData(oversightKeys.ruleSettings())).toEqual(running);
    for (const key of [oversightKeys.rules(), oversightKeys.overview(), oversightKeys.findings(), oversightKeys.people(), oversightKeys.portfolio()]) {
      await waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated, String(key)).toBe(true));
    }
    // Governance is not the rules': the access log and usage stay as they were.
    expect(queryClient.getQueryState(oversightKeys.usage())?.isInvalidated).toBe(false);
  });

  it("follow the re-check to its end once the page is gone, and then read every figure the rules decide afresh", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const queryClient = client();
    const figures = [oversightKeys.rules(), oversightKeys.overview(), oversightKeys.findings(), oversightKeys.people(), oversightKeys.portfolio(), oversightKeys.trends()];
    const applied = { ...running, apply: { ...running.apply, state: "applied", applied_revision: 1, finished_at: "2026-11-04T14:31:04.000Z", result: { opened: 0, closed: 14 } } };
    // The save answers running; the next read of the settings, applied.
    const fetchMock = route(running, applied);
    const save = renderHook(() => useSaveRuleSettings(), { wrapper: wrapperFor(queryClient) });
    await act(() => save.result.current.mutateAsync({ revision: 0, changes: [{ rule_id: "W-AGE-01", enabled: false }] }));
    // Pages read since the save hold the counts from before the re-check, fresh for minutes yet: no settings page among them.
    for (const key of figures) queryClient.setQueryData(key, { cached: true });
    renderHook(() => useRecheckFollower(), { wrapper: wrapperFor(queryClient) });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(RULE_SETTINGS_POLL_MS));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/oversight/rules/settings");
    for (const key of figures) {
      await waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated, String(key)).toBe(true));
    }
    // Ended: nothing more is read.
    await act(() => vi.advanceTimersByTimeAsync(RULE_SETTINGS_POLL_MS * 3));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("leave the reading to the settings page while it is open, so nothing is read twice", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const queryClient = client();
    const fetchMock = route(running);
    const page = renderHook(() => useRuleSettings(), { wrapper: wrapperFor(queryClient) });
    await waitFor(() => expect(page.result.current.data?.apply.state).toBe("running"));
    renderHook(() => useRecheckFollower(), { wrapper: wrapperFor(queryClient) });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(RULE_SETTINGS_POLL_MS * 2));
    // The page's own reads, every two seconds, and none of the follower's beside them.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    page.unmount();
    await act(() => vi.advanceTimersByTimeAsync(RULE_SETTINGS_POLL_MS));
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("draft a rule without marking anything stale, and never draft again on their own: each draft is a model call", async () => {
    const queryClient = client();
    const cached = [oversightKeys.ruleSettings(), oversightKeys.rules(), oversightKeys.overview(), oversightKeys.findings(), oversightKeys.portfolio()];
    for (const key of cached) queryClient.setQueryData(key, { cached: true });
    route(draftJson);
    const draft = renderHook(() => useRuleDraft(), { wrapper: wrapperFor(queryClient) });
    const answer = await act(() => draft.result.current.mutateAsync("Bugs in progress for more than 3 days"));
    expect(answer.outcome).toBe("drafted");
    for (const key of cached) expect(queryClient.getQueryState(key)?.isInvalidated, String(key)).toBe(false);
    expect(queryClient.getQueryData(oversightKeys.ruleSettings())).toEqual({ cached: true });

    const failing = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ error: "upstream_timeout", message: "No answer." }), { status: 503 }));
    vi.stubGlobal("fetch", failing);
    await act(async () => {
      await draft.result.current.mutateAsync("Bugs in progress for more than 3 days").catch(() => undefined);
    });
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it("on a save that adds a rule, mark the findings, the Overview and the Portfolio stale: a new rule counts in each", async () => {
    const queryClient = client();
    const figures = [oversightKeys.rules(), oversightKeys.overview(), oversightKeys.findings(), oversightKeys.portfolio()];
    for (const key of figures) queryClient.setQueryData(key, { cached: true });
    route(running);
    const save = renderHook(() => useSaveRuleSettings(), { wrapper: wrapperFor(queryClient) });
    const create = {
      op: "create" as const,
      rule: {
        title: "Bugs in progress over 3 days",
        check: "time_in_status_over",
        params: { statuses: ["In Progress"], hours: 72 },
        applies_to: { status_category: ["indeterminate" as const], issue_type: ["Bug"] },
        severity: "breach" as const,
      },
    };
    await act(() => save.result.current.mutateAsync({ revision: 0, changes: [create] }));
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual({ revision: 0, changes: [create] });
    for (const key of figures) {
      await waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated, String(key)).toBe(true));
    }
  });

  it("never try a save again on their own: a failed save may have been made", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ error: "upstream_timeout", message: "No answer." }), { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const save = renderHook(() => useSaveRuleSettings(), { wrapper: wrapperFor(client()) });
    await act(async () => {
      await save.result.current.mutateAsync({ revision: 0, changes: [{ rule_id: "W-AGE-01", enabled: false }] }).catch(() => undefined);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
