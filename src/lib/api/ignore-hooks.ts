import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { type ApiError, getIgnored, getRuleSettings, postIgnore, postIgnorePreview, postRestore } from "./client";
import { oversightKeys } from "./hooks";
import {
  recheckUnderWay,
  type IgnoredPage,
  type IgnorePreview,
  type IgnorePreviewRequest,
  type IgnoreRequest,
  type IgnoreResult,
  type RestoreResult,
} from "./ignores";
import { normalizeIgnoredQuery, type IgnoredQueryInput } from "./params";
import type { Finding, FindingDetail, FindingsPage, IssueTimeline } from "./schemas";

const MINUTE = 60_000;

/** When a restore's re-check has most likely ended, the service reports no end of its own to follow. */
const WHOLE_LIST_FROM = 8;
const WHOLE_LIST_PAGES = 20;
const RECHECK_REREAD_MS = [1_000, 2_500, 4_500, 7_000, 10_000, 15_000] as const;

export const ignoreKeys = {
  /** Apart from the findings: an ignore reads them again, never the preview it was made from. */
  preview: (body: IgnorePreviewRequest | null) => [...oversightKeys.all, "ignore-preview", body] as const,
  held: (tickets: readonly string[]) => [...oversightKeys.findings(), "ignored-held", tickets] as const,
  ignored: (query: ReturnType<typeof normalizeIgnoredQuery>) => [...oversightKeys.findings(), "ignored", query] as const,
};

/** Every figure an ignore or a restore moves: the open counts wherever they are shown, and the findings themselves. */
export function invalidateAfterIgnore(queryClient: QueryClient): Promise<void> {
  const figures = [
    oversightKeys.findings(),
    oversightKeys.overview(),
    oversightKeys.people(),
    oversightKeys.portfolio(),
    oversightKeys.trends(),
    oversightKeys.issues(),
    oversightKeys.rules(),
    oversightKeys.insights(),
    oversightKeys.ruleSettings(),
  ];
  return Promise.all(figures.map((queryKey) => queryClient.invalidateQueries({ queryKey }))).then(() => undefined);
}

/** What an ignore would do now, for the dialog: asked again as its scope changes, each answer kept while it is open. */
export function useIgnorePreview(body: IgnorePreviewRequest | null): UseQueryResult<IgnorePreview, ApiError> {
  return useQuery({
    queryKey: ignoreKeys.preview(body),
    queryFn: ({ signal }) => postIgnorePreview(body!, { signal }),
    enabled: body !== null,
    staleTime: 0,
    gcTime: MINUTE,
    retry: false,
    refetchOnWindowFocus: false,
    // The other scope's answer stays on screen, dimmed, while this one is worked out: nothing jumps.
    placeholderData: keepPreviousData,
  });
}

/** The board's standing ignores, a page at a time (people level only). */
export function useIgnored(input: IgnoredQueryInput = {}, { enabled = true }: { enabled?: boolean } = {}): UseQueryResult<IgnoredPage, ApiError> {
  const query = normalizeIgnoredQuery(input);
  return useQuery({
    queryKey: ignoreKeys.ignored(query),
    queryFn: ({ signal }) => getIgnored(query, { signal }),
    staleTime: MINUTE,
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** The findings an ignore names before the service has said: those by id, or every open one on the tickets. */
function shownIgnored(finding: Finding, body: IgnoreRequest, at: string): Finding {
  if (finding.state !== "open" || finding.issue_key === null) return finding;
  const { target, scope } = body;
  const named =
    "finding_ids" in target
      ? target.finding_ids.includes(finding.finding_id)
      : "issue_keys" in target && target.issue_keys.includes(finding.issue_key);
  if (!named) return finding;
  return {
    ...finding,
    state: "ignored",
    resolved_at: at,
    resolved_why: "ignored",
    ignore: { scope, rule_id: scope === "ticket" ? null : finding.rule_id, reason: body.reason, by: null, at },
  };
}

/** Marks the findings on screen ignored at once where the request says which they are; a query waits for the service. */
function showIgnoredNow(queryClient: QueryClient, body: IgnoreRequest): [QueryKey, unknown][] {
  if ("query" in body.target) return [];
  const at = new Date().toISOString();
  const target = body.target;
  // A ticket's ignore takes every open finding on it: those on the tickets the named findings are on.
  const keys =
    body.scope === "ticket" && "finding_ids" in target
      ? new Set(
          queryClient
            .getQueriesData<FindingsPage>({ queryKey: [...oversightKeys.findings(), "list"] })
            .flatMap(([, page]) => page?.items ?? [])
            .filter((finding) => target.finding_ids.includes(finding.finding_id) && finding.issue_key !== null)
            .map((finding) => finding.issue_key!),
        )
      : null;
  const request: IgnoreRequest = keys ? { ...body, target: { issue_keys: [...keys] } } : body;
  const mark = (finding: Finding) => shownIgnored(finding, request, at);
  const saved: [QueryKey, unknown][] = [];
  for (const [queryKey, page] of queryClient.getQueriesData<FindingsPage>({ queryKey: [...oversightKeys.findings(), "list"] })) {
    if (!page) continue;
    saved.push([queryKey, page]);
    queryClient.setQueryData<FindingsPage>(queryKey, { ...page, items: page.items.map(mark) });
  }
  for (const [queryKey, detail] of queryClient.getQueriesData<FindingDetail>({ queryKey: [...oversightKeys.findings(), "detail"] })) {
    if (!detail) continue;
    saved.push([queryKey, detail]);
    queryClient.setQueryData<FindingDetail>(queryKey, { ...detail, finding: mark(detail.finding) });
  }
  for (const [queryKey, timeline] of queryClient.getQueriesData<IssueTimeline>({ queryKey: oversightKeys.issues() })) {
    if (!timeline) continue;
    saved.push([queryKey, timeline]);
    queryClient.setQueryData<IssueTimeline>(queryKey, { ...timeline, findings: timeline.findings.map(mark) });
  }
  return saved;
}

export function useIgnoreFindings(): UseMutationResult<IgnoreResult, ApiError, IgnoreRequest, { saved: [QueryKey, unknown][] }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: [...oversightKeys.findings(), "ignore"],
    mutationFn: (body: IgnoreRequest) => postIgnore(body),
    // Never retried: an ignore that failed on its way back may have been made.
    retry: false,
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey: oversightKeys.findings() });
      return { saved: showIgnoredNow(queryClient, body) };
    },
    onError: (_error, _body, context) => {
      for (const [queryKey, data] of context?.saved ?? []) queryClient.setQueryData(queryKey, data);
    },
    onSettled: () => invalidateAfterIgnore(queryClient),
  });
}

export function useRestoreIgnores(): UseMutationResult<RestoreResult, ApiError, readonly string[]> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: [...oversightKeys.findings(), "restore"],
    mutationFn: (ignoreIds: readonly string[]) => postRestore(ignoreIds),
    retry: false,
    onSuccess: (result) => {
      void invalidateAfterIgnore(queryClient);
      // The service re-checks the board as it does after a rule settings save: the shell follows it, and reads again.
      if (recheckUnderWay(result.recheck)) {
        void queryClient.fetchQuery({ queryKey: oversightKeys.ruleSettings(), queryFn: ({ signal }) => getRuleSettings({ signal }) }).catch(() => undefined);
        // The settings stay "applied" while this re-check runs, so the shell never sees it: the figures are read again as it ends.
        for (const delay of RECHECK_REREAD_MS) window.setTimeout(() => void invalidateAfterIgnore(queryClient), delay);
      }
    },
  });
}

/** What a restore reopens: each finding on its own, a whole ticket's ignore with everything it holds. Null until known. */
export function useRestoreCount(findings: readonly Finding[] | null, enabled: boolean): number | null {
  const own = (findings ?? []).filter((finding) => finding.ignore?.scope !== "ticket").length;
  const tickets = [...new Set((findings ?? []).filter((finding) => finding.ignore?.scope === "ticket" && finding.issue_key !== null).map((finding) => finding.issue_key!))].sort();
  const held = useQuery({
    queryKey: [...ignoreKeys.held(tickets)],
    queryFn: async ({ signal }) => {
      const held = new Map<string, number>();
      // A few tickets are asked for by key; many are found by reading the whole ignored list once.
      const queries = tickets.length <= WHOLE_LIST_FROM ? tickets.map((key) => ({ q: key, page_size: 100 })) : [{ page_size: 100 }];
      for (const base of queries) {
        for (let page = 1; page <= WHOLE_LIST_PAGES; page += 1) {
          const result = await getIgnored(normalizeIgnoredQuery({ ...base, page }), { signal });
          for (const item of result.items) if (item.scope === "ticket") held.set(item.issue_key, item.findings);
          if (page * result.page_size >= result.total) break;
        }
      }
      return held;
    },
    enabled: enabled && tickets.length > 0,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  if (tickets.length === 0) return own;
  if (held.data === undefined) return null;
  const whole = tickets.reduce((sum, key) => sum + (held.data.get(key) ?? findings!.filter((finding) => finding.issue_key === key).length), 0);
  return own + whole;
}
