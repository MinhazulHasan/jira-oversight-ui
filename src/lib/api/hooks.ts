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

/**
 * TanStack Query hooks for every endpoint. Pages read data only through
 * these, so caching, retries and freshness are decided in one place: the
 * figures change when Jira is synced (every 30 minutes), so a minute of
 * freshness costs nothing, and slow-moving reports are kept far longer.
 */

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

/**
 * Query keys, one factory so invalidation can never miss a variant.
 * `oversightKeys.all` clears everything; `findings()` every findings list and
 * finding. Findings lists are keyed by their normalised query (defaults filled
 * in, lists sorted), so equivalent filters share one cache entry.
 */
export const oversightKeys = {
  all: ["oversight"] as const,
  health: () => [...oversightKeys.all, "health"] as const,
  projects: () => [...oversightKeys.all, "projects"] as const,
  /** A board's sync (JO-18), by the board it is about: the board picked in the top bar. */
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
  /** A board's rule settings (JO-15): a sync changes whether they are applied, so they are not kept with governance. */
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

/**
 * How a read of person-level data that the service records in its access log
 * (JO-12) behaves: a scorecard or a comparison, findings filtered by a
 * person, a person card (JO-13), the access log itself. Each is an entry in
 * "who looked at whom", so
 * it happens when the reader asks (opening the page, a change of filter,
 * period or person, Try again) and never on its own: not on focus, a
 * reconnect or a timer. It is retried only when the request never left the
 * browser (a dropped connection): a failure the service may have answered
 * after recording the read (a 5xx, a timeout) is shown with Try again, so one
 * look is never logged twice.
 */
const RECORDED_READ = {
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  retry: (failureCount: number, error: ApiError) => error.status === 0 && failureCount < 2,
} as const;

/**
 * After a sync, every figure on every page was computed from the old snapshot: every query is marked stale and those
 * on screen are read again. Governance (the access log, Ask's usage) is not Jira's and no sync changes it; the access
 * log's every read is recorded, so it is never read again on its own here (one press of Sync now would otherwise log
 * a view for every page of it read).
 */
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

/**
 * Everyone assigned a ticket on the board now, with their open work and
 * findings; it changes with a sync. `enabled: false` holds it back (Ask asks
 * for the board's people only for a reader who may mention them).
 */
export function usePeople({ enabled = true }: { enabled?: boolean } = {}): UseQueryResult<People, ApiError> {
  return useQuery({
    queryKey: oversightKeys.people(),
    queryFn: ({ signal }) => getPeople({ signal }),
    staleTime: MINUTE,
    enabled,
  });
}

/**
 * Everyone on the board, as Jira's assignee picker lists them: the people
 * assigned its tickets now and its members who hold none, each with how many
 * tickets are theirs. It changes with a sync. Ask's @ list reads it, and only
 * for a reader who may mention people (`enabled: false` holds it back).
 */
export function usePeopleDirectory({ enabled = true }: { enabled?: boolean } = {}): UseQueryResult<PeopleDirectory, ApiError> {
  return useQuery({
    queryKey: oversightKeys.peopleDirectory(),
    queryFn: ({ signal }) => getPeopleDirectory({ signal }),
    staleTime: MINUTE,
    enabled,
  });
}

/**
 * Scorecards: how each person's tickets are handled next to the whole board's,
 * over the period asked for (people level only: `enabled: false` holds it
 * back for anyone else). No person: everyone who holds a ticket, or with
 * comparison turned off, the board's figures alone; with people, those people.
 * It changes with a sync. The figures already on screen stay while another
 * period loads (isPlaceholderData tells them apart), so the page never jumps.
 * Every read is recorded in the access log, so it is a RECORDED_READ.
 */
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

/** How long a person card is kept fresh: moving back and forth over a name within it costs nothing (JO-13). */
export const PERSON_CARD_FRESH_MS = MINUTE;

/**
 * One person's card (people level only), fetched when the card opens (the
 * hover's intent, a click) and kept fresh for a minute, so moving back and
 * forth over a name costs nothing. Each read is a person-level read the
 * service records (at most once in ten minutes for one person, board and
 * reader), so it is a RECORDED_READ: read only when someone opens the card,
 * never on focus, a reconnect or a timer, and a 5xx or a timeout shows the
 * card's Try again at once. `enabled: false` holds it back.
 */
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

/**
 * One page of findings, filtered by any of the API's parameters (`person`
 * among them). The previous page stays on screen while the next one loads
 * (isPlaceholderData tells them apart), so paging and filtering never
 * collapse the table into a skeleton. Filtered by someone, the read is
 * recorded in the access log, so it is a RECORDED_READ.
 */
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

/**
 * Ask a question. A mutation, not a query: every question is its own audited
 * request, and asking the same thing twice should ask twice. Never retried,
 * because an answer that failed may already have been logged.
 */
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

/**
 * The boards to switch between: every board the service's Jira account can browse (JO-17), which it looks for
 * again every half hour, and whether each has synced. A sync changes the list (a board's first sync makes it synced),
 * so a sync reads it again with every other figure (invalidateAfterSync).
 */
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

/**
 * The sync of the board picked in the top bar (JO-18), `board` its key (null
 * while it is not known: nothing is asked). Its state is read once, then every
 * SYNC_POLL_MS while it is queued or running, so the top bar's Sync, a page
 * offering a board's first sync and the shell's SyncFollower all see one
 * state; starting it puts the service's answer in its place at once. The board
 * is the top bar's pick, which the server sends on (?project=); `board` keys
 * the state, so another board's never stands for it. Never retried: a press
 * the service did not answer is the reader's to make again.
 */
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

/**
 * The Portfolio: every board the reader may open, with the Overview's own
 * figures for each, and the oldest open breaches across them. It changes with
 * a sync, like the Overview.
 */
export function usePortfolio(): UseQueryResult<Portfolio, ApiError> {
  return useQuery({
    queryKey: oversightKeys.portfolio(),
    queryFn: ({ signal }) => getPortfolio({ signal }),
    staleTime: MINUTE,
  });
}

/** The access log's filters, as the page holds them: where a page starts is the hook's, and an export is never a view. */
export type AccessLogFilters = Omit<AccessLogQueryInput, "cursor" | "export">;

/**
 * The access log (people level only), a page at a time, newest first: the
 * next page is fetched on demand (fetchNextPage) and joins the list. Every
 * read of it is itself recorded by the service, so it is read only when the
 * reader asks: opening the page, the filters change, a next page, Refresh,
 * Try again; never on its own (a RECORDED_READ: no refetch on focus,
 * reconnect or a timer, and the pages read stay fresh while the page is
 * open). Leaving the page lets the pages go (gcTime 0), so coming back reads
 * the first page anew, never every page that was read, and shows what was
 * recorded meanwhile. The entries on screen stay while other filters load
 * (isPlaceholderData).
 */
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

/**
 * Refresh, on the access log: its first page read again, and only it, so the newest entries show (recorded as one
 * view, whatever was read before); the entries on screen stay until it arrives.
 */
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

/**
 * A board's rule settings (JO-15, people level only: `enabled: false` holds it
 * back for anyone else), on the board picked in the top bar. While the service
 * re-checks the board after a save (`apply.state` running) it is read every
 * two seconds, so the page sees the findings settle; otherwise only when it
 * goes stale.
 */
export function useRuleSettings({ enabled = true }: { enabled?: boolean } = {}): UseQueryResult<RuleSettings, ApiError> {
  return useQuery({
    queryKey: oversightKeys.ruleSettings(),
    queryFn: ({ signal }) => getRuleSettings({ signal }),
    staleTime: 30 * SECOND,
    refetchInterval: (query) => (query.state.data?.apply.state === "running" ? RULE_SETTINGS_POLL_MS : false),
    enabled,
  });
}

/**
 * Every figure the rules decide, after a board's rule settings change: the
 * catalogue, the Overview, findings (by person too), people and their
 * scorecards and cards, the Portfolio, the weekly series and the ticket pages.
 * Marked stale, and read again where they are on screen. Called on a save, and
 * again when its re-check has finished (useRecheckFollower), since only then
 * has the service moved the findings.
 */
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

/**
 * Follows a board's re-check after a save to its end, whichever page the
 * reader is on by then (JO-15). While the settings this client last read say
 * the service is re-checking (apply.state running), they are read every two
 * seconds: by the settings page itself while it is open, here once it is not.
 * When the re-check has ended, every figure the rules decide is read afresh
 * (invalidateAfterRuleSettings): the save's own refresh came before the
 * service moved the findings, and the pages read since would otherwise keep
 * those counts for as long as they stay fresh. Mounted once, in the app's
 * shell (RecheckFollower), for a reader at people level; it starts no read of
 * its own while no re-check runs.
 */
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

/**
 * What changes to the board's rule settings would do to its open findings: a
 * mutation, since it carries the changes, though the service writes nothing.
 * Never retried: the reader asks again.
 */
export function useRuleSettingsPreview(): UseMutationResult<RuleSettingsPreview, ApiError, RuleSettingsPreviewRequest> {
  return useMutation({
    mutationKey: [...oversightKeys.ruleSettings(), "preview"],
    mutationFn: (body: RuleSettingsPreviewRequest) => postRuleSettingsPreview(body),
    retry: false,
  });
}

/**
 * The AI's draft of a rule from an admin's words (JO-20): a mutation, since it
 * carries the words, though the service saves nothing and nothing on screen
 * changes because of it (it invalidates nothing). Never retried: each draft is
 * a model call the service counts against the day's budget.
 */
export function useRuleDraft(): UseMutationResult<RuleDraft, ApiError, string> {
  return useMutation({
    mutationKey: [...oversightKeys.ruleSettings(), "draft"],
    mutationFn: (text: string) => postRuleDraft(text),
    retry: false,
  });
}

/**
 * Saves changes to the board's rule settings. Never retried: a save that
 * failed on its way back may have been made, and the next attempt carries the
 * same revision, which the service would then refuse. On success the settings
 * on screen are the answer, and every figure the rules decide is read afresh:
 * the catalogue, findings, the Overview and the Portfolio among them, since a
 * rule added or deleted (JO-20) changes what each of them counts.
 */
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
