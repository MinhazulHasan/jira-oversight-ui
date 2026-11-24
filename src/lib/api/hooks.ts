import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type UseInfiniteQueryResult,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import {
  type ApiError,
  getAccessLog,
  getBaseline,
  getFinding,
  getFindings,
  getHealth,
  getInsights,
  getIssueTimeline,
  getOverview,
  getPeople,
  getPeopleDirectory,
  getPeopleScorecard,
  getPersonCard,
  getPortfolio,
  getProjects,
  getRules,
  getRuleSettings,
  getTrend,
  getUsage,
  getRefresh,
  postAsk,
  postRefresh,
  postRuleDraft,
  postRuleSettings,
  postRuleSettingsPreview,
} from "./client";
import {
  normalizeAccessLogQuery,
  normalizeFindingsQuery,
  normalizePersonCardQuery,
  normalizeScorecardQuery,
  normalizeTrendQuery,
  type AccessLogQuery,
  type AccessLogQueryInput,
  type FindingsQuery,
  type FindingsQueryInput,
  type PersonCardQuery,
  type PersonCardQueryInput,
  type ScorecardQuery,
  type ScorecardQueryInput,
  type TrendQuery,
} from "./params";
import {
  FINDING_ID_PATTERN,
  ISSUE_KEY_PATTERN,
  REFRESH_UNDER_WAY,
  UNASSIGNED,
  type AccessLog,
  type AskResponse,
  type Baseline,
  type FindingDetail,
  type FindingsPage,
  type Health,
  type Insights,
  type IssueTimeline,
  type Overview,
  type People,
  type PeopleDirectory,
  type PeopleScorecard,
  type PersonCard,
  type Portfolio,
  type Projects,
  type Refresh,
  type RuleDraft,
  type Rules,
  type RuleSettings,
  type RuleSettingsPreview,
  type RuleSettingsPreviewRequest,
  type RuleSettingsSaveRequest,
  type Trend,
  type TrendMetric,
  type Usage,
} from "./schemas";

export type {
  AccessLog,
  AccessLogEntry,
  AskResponse,
  Baseline,
  FindingDetail,
  FindingsPage,
  Health,
  Insights,
  IssueTimeline,
  DirectoryEntry,
  Overview,
  People,
  PeopleDirectory,
  PeopleScorecard,
  Person,
  PersonCard,
  PersonSummary,
  ScorecardMeasure,
  ScorecardPerson,
  ScorecardValue,
  Portfolio,
  PortfolioBoard,
  AttentionItem,
  Projects,
  ProjectSummary,
  Refresh,
  RuleDraft,
  Rules,
  RuleSettings,
  RuleSettingsPreview,
  Trend,
  Usage,
} from "./schemas";
export { ApiError, isApiError } from "./client";

const SECOND = 1_000;
const MINUTE = 60 * SECOND;

export const oversightKeys = {
  all: ["oversight"] as const,
  health: () => [...oversightKeys.all, "health"] as const,
  projects: () => [...oversightKeys.all, "projects"] as const,
  /** A board's sync, by the board it is about: the board picked in the top bar. */
  refresh: (board: string | null) => [...oversightKeys.all, "refresh", board] as const,
  overview: () => [...oversightKeys.all, "overview"] as const,
  people: () => [...oversightKeys.all, "people"] as const,
  peopleDirectory: () => [...oversightKeys.people(), "directory"] as const,
  peopleScorecard: (query: ScorecardQuery) => [...oversightKeys.people(), "scorecard", query.days, ...query.person] as const,
  personCard: (personId: string, query: PersonCardQuery) => [...oversightKeys.people(), "card", personId, query.days, query.board ?? null] as const,
  findings: () => [...oversightKeys.all, "findings"] as const,
  findingsList: (query: FindingsQuery) => [...oversightKeys.findings(), "list", query] as const,
  finding: (findingId: string) => [...oversightKeys.findings(), "detail", findingId] as const,
  issueTimeline: (issueKey: string) => [...oversightKeys.all, "issues", issueKey, "timeline"] as const,
  ask: () => [...oversightKeys.all, "ask"] as const,
  insights: () => [...oversightKeys.all, "insights", "latest"] as const,
  trend: (query: TrendQuery) => [...oversightKeys.all, "trends", query.metric, query.last_n] as const,
  rules: () => [...oversightKeys.all, "rules"] as const,
  baseline: () => [...oversightKeys.all, "baseline", "latest"] as const,
  portfolio: () => [...oversightKeys.all, "portfolio"] as const,
  governance: () => [...oversightKeys.all, "governance"] as const,
  accessLog: (query: AccessLogQuery) => [...oversightKeys.governance(), "access-log", query] as const,
  usage: () => [...oversightKeys.governance(), "usage"] as const,
  /** A board's rule settings: a sync changes whether they are applied, so they are not kept with governance. */
  ruleSettings: () => [...oversightKeys.all, "rule-settings"] as const,
  trends: () => [...oversightKeys.all, "trends"] as const,
  issues: () => [...oversightKeys.all, "issues"] as const,
};

/** Whether two scorecard keys ask for the same people (whatever the period): the key's tail after the days. */
function samePeople(a: readonly unknown[], b: readonly unknown[]): boolean {
  const people = (key: readonly unknown[]) => key.slice(oversightKeys.people().length + 2).join(",");
  return a.length >= 4 && people(a) === people(b);
}

/** Whether a findings query names someone (a person id; "unassigned" is no one): the service records that read. */
function namesSomeone(query: FindingsQuery): boolean {
  return query.person.some((id) => id !== UNASSIGNED);
}

const RECORDED_READ = {
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  retry: (failureCount: number, error: ApiError) => error.status === 0 && failureCount < 2,
} as const;

export function invalidateAfterSync(queryClient: QueryClient): Promise<void> {
  const governance = oversightKeys.governance();
  return queryClient.invalidateQueries({
    queryKey: oversightKeys.all,
    predicate: (query) => !governance.every((part, index) => query.queryKey[index] === part),
  });
}

/** The data source: polled every minute so "Last synced" and the source pill never go stale unnoticed. */
export function useHealth(): UseQueryResult<Health, ApiError> {
  return useQuery({
    queryKey: oversightKeys.health(),
    queryFn: ({ signal }) => getHealth({ signal }),
    staleTime: 30 * SECOND,
    refetchInterval: MINUTE,
  });
}

export function useOverview(): UseQueryResult<Overview, ApiError> {
  return useQuery({
    queryKey: oversightKeys.overview(),
    queryFn: ({ signal }) => getOverview({ signal }),
    staleTime: MINUTE,
  });
}

export function usePeople({ enabled = true }: { enabled?: boolean } = {}): UseQueryResult<People, ApiError> {
  return useQuery({
    queryKey: oversightKeys.people(),
    queryFn: ({ signal }) => getPeople({ signal }),
    staleTime: MINUTE,
    enabled,
  });
}

export function usePeopleDirectory({ enabled = true }: { enabled?: boolean } = {}): UseQueryResult<PeopleDirectory, ApiError> {
  return useQuery({
    queryKey: oversightKeys.peopleDirectory(),
    queryFn: ({ signal }) => getPeopleDirectory({ signal }),
    staleTime: MINUTE,
    enabled,
  });
}

export function usePeopleScorecard(
  input: ScorecardQueryInput = {},
  { enabled = true }: { enabled?: boolean } = {},
): UseQueryResult<PeopleScorecard, ApiError> {
  const query = normalizeScorecardQuery(input);
  const key = oversightKeys.peopleScorecard(query);
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => getPeopleScorecard(query, { signal }),
    staleTime: MINUTE,
    ...RECORDED_READ,
    enabled,
    // Another period for the same people keeps the figures on screen; other people never stand in for these.
    placeholderData: (previous, previousQuery) =>
      previousQuery && samePeople(previousQuery.queryKey, key) ? previous : undefined,
  });
}

/** How long a person card is kept fresh: moving back and forth over a name within it costs nothing. */
export const PERSON_CARD_FRESH_MS = MINUTE;

export function usePersonCard(
  personId: string,
  input: PersonCardQueryInput = {},
  { enabled = true }: { enabled?: boolean } = {},
): UseQueryResult<PersonCard, ApiError> {
  const query = normalizePersonCardQuery(input);
  return useQuery({
    queryKey: oversightKeys.personCard(personId, query),
    queryFn: ({ signal }) => getPersonCard(personId, query, { signal }),
    staleTime: PERSON_CARD_FRESH_MS,
    ...RECORDED_READ,
    enabled,
  });
}

export function useFindings(input: FindingsQueryInput = {}): UseQueryResult<FindingsPage, ApiError> {
  const query = normalizeFindingsQuery(input);
  return useQuery({
    queryKey: oversightKeys.findingsList(query),
    queryFn: ({ signal }) => getFindings(query, { signal }),
    staleTime: MINUTE,
    placeholderData: keepPreviousData,
    ...(namesSomeone(query) ? RECORDED_READ : {}),
  });
}

/** One finding with its issue's status timeline; idle until there is a well-formed id. */
export function useFinding(findingId: string | null | undefined): UseQueryResult<FindingDetail, ApiError> {
  const id = findingId?.toLowerCase() ?? "";
  return useQuery({
    queryKey: oversightKeys.finding(id),
    queryFn: ({ signal }) => getFinding(id, { signal }),
    enabled: FINDING_ID_PATTERN.test(id),
    staleTime: MINUTE,
  });
}

/** One issue's facts, timeline, changelog, weekly worklog totals and findings; idle until the key is well formed. */
export function useIssueTimeline(issueKey: string | null | undefined): UseQueryResult<IssueTimeline, ApiError> {
  const key = issueKey?.toUpperCase() ?? "";
  return useQuery({
    queryKey: oversightKeys.issueTimeline(key),
    queryFn: ({ signal }) => getIssueTimeline(key, { signal }),
    enabled: ISSUE_KEY_PATTERN.test(key),
    staleTime: MINUTE,
  });
}

/** A question as the Ask page sends it: the text, and the people it mentions by id. */
export interface AskVariables {
  question: string;
  mentions: readonly string[];
}

export function useAsk(): UseMutationResult<AskResponse, ApiError, AskVariables> {
  return useMutation({
    mutationKey: oversightKeys.ask(),
    mutationFn: ({ question, mentions }: AskVariables) => postAsk(question, mentions),
    retry: false,
  });
}

/** The weekly briefing: written once a week, so it is kept fresh for ten minutes at a time. */
export function useInsights(): UseQueryResult<Insights, ApiError> {
  return useQuery({
    queryKey: oversightKeys.insights(),
    queryFn: ({ signal }) => getInsights({ signal }),
    staleTime: 10 * MINUTE,
  });
}

/** A weekly series, at most the last 12 weeks. */
export function useTrend(metric: TrendMetric, lastN?: number): UseQueryResult<Trend, ApiError> {
  const query = normalizeTrendQuery({ metric, last_n: lastN });
  return useQuery({
    queryKey: oversightKeys.trend(query),
    queryFn: ({ signal }) => getTrend(query, { signal }),
    staleTime: 5 * MINUTE,
  });
}

export function useProjects(): UseQueryResult<Projects, ApiError> {
  return useQuery({
    queryKey: oversightKeys.projects(),
    queryFn: ({ signal }) => getProjects({ signal }),
    staleTime: 5 * MINUTE,
  });
}

/** How often a sync under way is asked about: queued behind another board's, or running. */
export const SYNC_POLL_MS = 2_000;

/** Whether a board's sync is under way: waiting its turn, or running. */
export function syncUnderWay(state: Refresh | undefined): boolean {
  return state !== undefined && REFRESH_UNDER_WAY.includes(state.state);
}

export interface BoardSync {
  /** The board's sync as the service last said it; undefined until it has. */
  state: Refresh | undefined;
  /** Starts the board's sync, or joins the one under way; the service's answer, or the error. */
  start: () => Promise<Refresh>;
  /** A press is on its way to the service. */
  starting: boolean;
}

export function useBoardSync(board: string | null): BoardSync {
  const queryClient = useQueryClient();
  const key = oversightKeys.refresh(board);
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => getRefresh({ signal }),
    enabled: board !== null,
    staleTime: 30 * SECOND,
    refetchInterval: (current) => (syncUnderWay(current.state.data) ? SYNC_POLL_MS : false),
    // While it runs it is polled on a timer, whether or not the tab has focus, so its end is never missed.
    refetchIntervalInBackground: true,
  });
  const mutation = useMutation({
    mutationKey: [...key, "start"],
    mutationFn: () => postRefresh(),
    retry: false,
    onSuccess: (state) => queryClient.setQueryData(key, state),
  });
  return { state: query.data, start: mutation.mutateAsync, starting: mutation.isPending };
}

/** The rule catalogue and the process map: they change with a release, not with a sync. */
export function useRules(): UseQueryResult<Rules, ApiError> {
  return useQuery({
    queryKey: oversightKeys.rules(),
    queryFn: ({ signal }) => getRules({ signal }),
    staleTime: 10 * MINUTE,
  });
}

/** The ground-truth baseline report, regenerated by hand: half an hour of freshness is plenty. */
export function useBaseline(): UseQueryResult<Baseline, ApiError> {
  return useQuery({
    queryKey: oversightKeys.baseline(),
    queryFn: ({ signal }) => getBaseline({ signal }),
    staleTime: 30 * MINUTE,
  });
}

export function usePortfolio(): UseQueryResult<Portfolio, ApiError> {
  return useQuery({
    queryKey: oversightKeys.portfolio(),
    queryFn: ({ signal }) => getPortfolio({ signal }),
    staleTime: MINUTE,
  });
}

/** The access log's filters, as the page holds them: where a page starts is the hook's, and an export is never a view. */
export type AccessLogFilters = Omit<AccessLogQueryInput, "cursor" | "export">;

export function useAccessLog(
  filters: AccessLogFilters,
  { enabled = true }: { enabled?: boolean } = {},
): UseInfiniteQueryResult<InfiniteData<AccessLog, string | null>, ApiError> {
  const query = normalizeAccessLogQuery({ ...filters, cursor: undefined, export: false });
  return useInfiniteQuery({
    queryKey: oversightKeys.accessLog(query),
    queryFn: ({ signal, pageParam }) => getAccessLog({ ...query, cursor: pageParam ?? undefined }, { signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    ...RECORDED_READ,
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useAccessLogRefresh(filters: AccessLogFilters): () => Promise<void> {
  const queryClient = useQueryClient();
  const key = oversightKeys.accessLog(normalizeAccessLogQuery({ ...filters, cursor: undefined, export: false }));
  return async () => {
    queryClient.setQueryData<InfiniteData<AccessLog, string | null>>(key, (data) =>
      data ? { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) } : data,
    );
    await queryClient.refetchQueries({ queryKey: key, exact: true });
  };
}

/** Ask's use today and over the last 7 days, against the day's budget (people level only). */
export function useUsage({ enabled = true }: { enabled?: boolean } = {}): UseQueryResult<Usage, ApiError> {
  return useQuery({
    queryKey: oversightKeys.usage(),
    queryFn: ({ signal }) => getUsage({ signal }),
    staleTime: 30 * SECOND,
    enabled,
  });
}

/* --------------------------------------------------------- rule settings -- */

/** How often a board's rule settings are read again while the service re-checks its findings after a save. */
export const RULE_SETTINGS_POLL_MS = 2_000;

export function useRuleSettings({ enabled = true }: { enabled?: boolean } = {}): UseQueryResult<RuleSettings, ApiError> {
  return useQuery({
    queryKey: oversightKeys.ruleSettings(),
    queryFn: ({ signal }) => getRuleSettings({ signal }),
    staleTime: 30 * SECOND,
    refetchInterval: (query) => (query.state.data?.apply.state === "running" ? RULE_SETTINGS_POLL_MS : false),
    enabled,
  });
}

export function invalidateAfterRuleSettings(queryClient: QueryClient): Promise<void> {
  const figures = [
    oversightKeys.rules(),
    oversightKeys.overview(),
    oversightKeys.findings(),
    oversightKeys.people(),
    oversightKeys.portfolio(),
    oversightKeys.trends(),
    oversightKeys.issues(),
  ];
  return Promise.all(figures.map((queryKey) => queryClient.invalidateQueries({ queryKey }))).then(() => undefined);
}

export function useRecheckFollower(): void {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: oversightKeys.ruleSettings(),
    queryFn: ({ signal }) => getRuleSettings({ signal }),
    // Only what this client has read already (the settings page, a save): this never asks for them on its own.
    enabled: false,
  });
  const state = data?.apply.state;

  useEffect(() => {
    if (state !== "running") return;
    const timer = window.setInterval(() => {
      // The settings page, while it is open, reads them every two seconds itself.
      if (queryClient.getQueryCache().find({ queryKey: oversightKeys.ruleSettings(), exact: true })?.isActive()) return;
      void queryClient.fetchQuery({ queryKey: oversightKeys.ruleSettings(), queryFn: ({ signal }) => getRuleSettings({ signal }) }).catch(() => undefined);
    }, RULE_SETTINGS_POLL_MS);
    return () => window.clearInterval(timer);
  }, [state, queryClient]);

  const before = useRef(state);
  useEffect(() => {
    if (before.current === "running" && state !== undefined && state !== "running") void invalidateAfterRuleSettings(queryClient);
    before.current = state;
  }, [state, queryClient]);
}

export function useRuleSettingsPreview(): UseMutationResult<RuleSettingsPreview, ApiError, RuleSettingsPreviewRequest> {
  return useMutation({
    mutationKey: [...oversightKeys.ruleSettings(), "preview"],
    mutationFn: (body: RuleSettingsPreviewRequest) => postRuleSettingsPreview(body),
    retry: false,
  });
}

export function useRuleDraft(): UseMutationResult<RuleDraft, ApiError, string> {
  return useMutation({
    mutationKey: [...oversightKeys.ruleSettings(), "draft"],
    mutationFn: (text: string) => postRuleDraft(text),
    retry: false,
  });
}

export function useSaveRuleSettings(): UseMutationResult<RuleSettings, ApiError, RuleSettingsSaveRequest> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: [...oversightKeys.ruleSettings(), "save"],
    mutationFn: (body: RuleSettingsSaveRequest) => postRuleSettings(body),
    retry: false,
    onSuccess: (settings) => {
      queryClient.setQueryData(oversightKeys.ruleSettings(), settings);
      void invalidateAfterRuleSettings(queryClient);
    },
  });
}
