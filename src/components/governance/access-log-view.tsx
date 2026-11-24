"use client";

import { CalendarRange, ChevronDown, Download, RotateCcw, ScrollText, X } from "lucide-react";
import { createParser, parseAsNativeArrayOf, parseAsStringLiteral, useQueryStates } from "nuqs";
import { useId, useMemo, useState, type ReactNode } from "react";

import { PersonCardPill } from "@/components/person-card/person-card-trigger";
import { PersonAvatar } from "@/components/ui/person-avatar";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { csvFileName, downloadCsv, toCsv } from "@/components/ui/csv";
import { DataTable, dataTableColumns } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { fieldTrigger, menuItem, menuLabel, menuSeparator } from "@/components/ui/surfaces";
import { Timestamp } from "@/components/ui/timestamp";
import { Tooltip } from "@/components/ui/tooltip";
import { useFigureLocale } from "@/components/ui/use-figures";
import { getAccessLog } from "@/lib/api/client";
import { useAccessLog, useAccessLogRefresh, type ApiError } from "@/lib/api/hooks";
import {
  ACCESS_ACTION_LABELS,
  ACCESS_ACTIONS,
  ACCESS_LOG_DEFAULT_LIMIT,
  ACCESS_LOG_EXPORT_MAX,
  FORMER_MEMBER,
  PERSON_ID_PATTERN,
  VIEWER_HASH_PATTERN,
  type AccessAction,
  type AccessLogEntry,
  type Person,
} from "@/lib/api/schemas";
import { formatCount, formatDate } from "@/lib/format";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

import {
  ACCESS_LOG_CSV_COLUMNS,
  dayIn,
  detailWords,
  isCalendarDay,
  PERIOD_PRESETS,
  presetOf,
  presetPeriod,
  viewerRoleLine,
  type Period,
  type PeriodPreset,
} from "./model";

const ACTION_MENU: readonly AccessAction[] = [
  ...ACCESS_ACTIONS.filter((action) => !action.startsWith("access_log")),
  ...ACCESS_ACTIONS.filter((action) => action.startsWith("access_log")),
];

/** A filter's choice from the address that the log does not hold (or not yet: while the first page loads). */
const NOT_IN_LOG = "Someone not in the log";
const LOADING_NAME = "Loading…";

const FILTER_TOAST = "access-log-filter";
const MAX_SUBJECT_PILLS = 3;

const dayParser = createParser({
  parse: (value: string) => (isCalendarDay(value) ? value : null),
  serialize: (value: string) => value,
});
const personParser = createParser({
  parse: (value: string) => (PERSON_ID_PATTERN.test(value) ? value : null),
  serialize: (value: string) => value,
});
const viewerParser = createParser({
  parse: (value: string) => (VIEWER_HASH_PATTERN.test(value) ? value : null),
  serialize: (value: string) => value,
});

const filterParsers = {
  from: dayParser,
  to: dayParser,
  action: parseAsNativeArrayOf(parseAsStringLiteral(ACCESS_ACTIONS)),
  person: personParser,
  viewer: viewerParser,
};

function acknowledge(description: string) {
  notify.info("Filter applied", { description, id: FILTER_TOAST });
}

function errorDetail(error: ApiError): string {
  return error.status > 0 ? `HTTP ${error.status} · ${error.code}` : error.code;
}

/* ------------------------------------------------------------ period --- */

function PeriodFilter({
  period,
  today,
  onChange,
}: {
  period: Period;
  today: string | null;
  onChange: (period: Period, said: string) => void;
}) {
  const id = useId();
  const preset = presetOf(period, today);
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(period.from ?? "");
  const [to, setTo] = useState(period.to ?? "");
  // Opened, the two days start from the period shown.
  const toggle = (next: boolean) => {
    if (next) {
      setFrom(period.from ?? "");
      setTo(period.to ?? "");
    }
    setOpen(next);
  };

  const label =
    preset === "all"
      ? "All recorded"
      : preset !== null
        ? (PERIOD_PRESETS.find((option) => option.value === preset)?.label ?? "")
        : rangeLabel(period);
  const custom = from !== "" && to !== "" && isCalendarDay(from) && isCalendarDay(to);
  const backwards = custom && from > to;

  const choose = (next: PeriodPreset | "all") => {
    if (next === "all") onChange({ from: null, to: null }, "Period: all recorded");
    else if (today !== null) onChange(presetPeriod(next, today), `Period: ${PERIOD_PRESETS.find((option) => option.value === next)?.label.toLowerCase()}`);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={toggle}>
      <PopoverTrigger className={cn(fieldTrigger, "h-8 pr-2 pl-2.5 text-sm")} aria-label={`Period: ${label}`}>
        <CalendarRange aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-ink-low" />
        <span className="text-ink-low">Period</span>{" "}
        <span className={preset === "all" ? "text-ink-mid" : "font-medium text-ink"}>{label}</span>
        <ChevronDown aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-ink-low" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(20rem,calc(100vw-2rem))] p-1">
        <p className={menuLabel}>Period</p>
        <div role="radiogroup" aria-label="Period" className="flex flex-col">
          {[...PERIOD_PRESETS.map((option) => ({ value: option.value as PeriodPreset | "all", label: option.label })), { value: "all" as const, label: "All recorded" }].map(
            (option) => {
              const days = option.value === "all" || today === null ? null : presetPeriod(option.value, today);
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={preset === option.value}
                  disabled={option.value !== "all" && today === null}
                  onClick={() => choose(option.value)}
                  className={cn(menuItem, "w-full justify-between", preset === option.value && "font-medium text-ink")}
                >
                  <span className="inline-flex items-center gap-2">
                    <span aria-hidden className={cn("size-1.5 rounded-full", preset === option.value ? "bg-ink" : "bg-transparent")} />
                    {option.label}
                  </span>
                  {days?.from ? <span className="mono text-xs text-ink-low">since {formatDate(`${days.from}T12:00:00Z`, { timeZone: "UTC" })}</span> : null}
                </button>
              );
            },
          )}
        </div>
        <div aria-hidden className={menuSeparator} />
        <form
          className="flex flex-col gap-2.5 px-2.5 pt-1 pb-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!custom || backwards) return;
            onChange({ from, to }, `Period: ${rangeLabel({ from, to })}`);
            setOpen(false);
          }}
        >
          <p className="micro text-ink-low">Between two days</p>
          <div className="grid grid-cols-2 gap-2">
            <label htmlFor={`${id}-from`} className="flex flex-col gap-1 text-xs text-ink-low">
              From
              <input
                id={`${id}-from`}
                type="date"
                value={from}
                max={today ?? undefined}
                onChange={(event) => setFrom(event.target.value)}
                className="mono h-8 rounded-md border border-rule-control bg-sheet px-2 text-sm text-ink"
              />
            </label>
            <label htmlFor={`${id}-to`} className="flex flex-col gap-1 text-xs text-ink-low">
              To
              <input
                id={`${id}-to`}
                type="date"
                value={to}
                max={today ?? undefined}
                onChange={(event) => setTo(event.target.value)}
                className="mono h-8 rounded-md border border-rule-control bg-sheet px-2 text-sm text-ink"
              />
            </label>
          </div>
          {backwards ? <p className="text-xs text-warn-ink">The first day is after the last.</p> : null}
          <div className="flex justify-end gap-2">
            <PopoverClose asChild>
              <Button size="sm" variant="ghost">
                Cancel
              </Button>
            </PopoverClose>
            <Button size="sm" type="submit" disabled={!custom || backwards}>
              Apply
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/** "4 Oct – 4 Nov 2026": a range of calendar days, read as days (never shifted by the reader's zone). */
function rangeLabel(period: Period): string {
  const day = (value: string) => formatDate(`${value}T12:00:00Z`, { timeZone: "UTC" });
  if (period.from && period.to) return period.from === period.to ? day(period.from) : `${day(period.from)} – ${day(period.to)}`;
  if (period.from) return `Since ${day(period.from)}`;
  if (period.to) return `Up to ${day(period.to)}`;
  return "All recorded";
}

/* ------------------------------------------------------------- cells --- */

/** A subject's pill: the round ground, the picture at its start, the name after it. */
const PILL = "pressable inline-flex h-6 max-w-[12rem] min-w-0 items-center rounded-full bg-hover text-xs text-ink hover:bg-pressed";

function SubjectPill({ person, board, onPick }: { person: Person; board: string | null; onPick: (person: Person) => void }) {
  const hintId = useId();
  const former = person.name === FORMER_MEMBER && person.avatar === null;
  const hint = `Show only reads of ${person.name}'s figures`;
  if (former) {
    return (
      <Tooltip content={hint}>
        <button type="button" onClick={() => onPick(person)} className={cn(PILL, "gap-1.5 py-0.5 pr-2.5 pl-0.5")}>
          {/* Someone on no board any more has no picture to show: the generic figure, never initials of "Former member". */}
          <PersonAvatar person={null} />
          <span className="truncate">{person.name}</span>
        </button>
      </Tooltip>
    );
  }
  return (
    <>
      <PersonCardPill person={person} board={board} className={PILL} picture={<PersonAvatar person={person} board={board} />}>
        <button
          type="button"
          onClick={() => onPick(person)}
          aria-describedby={hintId}
          className="min-w-0 truncate rounded-full py-0.5 pr-2.5 pl-1 text-left"
        >
          {person.name}
        </button>
      </PersonCardPill>
      <span id={hintId} hidden>
        {hint}
      </span>
    </>
  );
}

function SubjectsCell({ entry, onPick }: { entry: AccessLogEntry; onPick: (person: Person) => void }) {
  const locale = useFigureLocale();
  if (entry.subjects.length === 0) return <span className="text-ink-low">No one</span>;
  const shown = entry.subjects.slice(0, MAX_SUBJECT_PILLS);
  const rest = entry.subjects.slice(MAX_SUBJECT_PILLS);
  const last = shown[shown.length - 1];
  return (
    <span className="flex flex-wrap items-center gap-1 py-1">
      {shown.slice(0, -1).map((person) => (
        <SubjectPill key={person.id} person={person} board={entry.project} onPick={onPick} />
      ))}
      {/* The last pill and the count of the rest wrap together, so a "+n" never starts a line on its own. */}
      <span data-subjects-tail className="inline-flex min-w-0 items-center gap-1">
        <SubjectPill person={last} board={entry.project} onPick={onPick} />
        {rest.length > 0 ? (
          <Tooltip content={rest.map((person) => person.name).join(", ")}>
            <span className="mono shrink-0 rounded-full px-1.5 text-xs text-ink-low">
              +{formatCount(rest.length, { locale })}
              <span className="sr-only"> more: {rest.map((person) => person.name).join(", ")}</span>
            </span>
          </Tooltip>
        ) : null}
      </span>
    </span>
  );
}

function ViewerCell({ entry, onPick }: { entry: AccessLogEntry; onPick: (hash: string, name: string) => void }) {
  const role = viewerRoleLine(entry);
  return (
    <span className="flex min-w-0 flex-col items-start py-0.5">
      <Tooltip content={`Show only ${entry.viewer.name}'s reads`}>
        <button
          type="button"
          onClick={() => onPick(entry.viewer.hash, entry.viewer.name)}
          className="max-w-full truncate text-left text-ink decoration-rule-strong underline-offset-2 hover:underline"
        >
          {entry.viewer.name}
        </button>
      </Tooltip>
      {role ? <span className="text-xs text-ink-low">{role}</span> : null}
    </span>
  );
}

function TimeCell({ entry, className }: { entry: AccessLogEntry; className?: string }) {
  return <Timestamp value={entry.at} mode="datetime" className={cn("text-ink-mid", className)} />;
}

/* ------------------------------------------------------------- table --- */

const col = dataTableColumns<AccessLogEntry>();

function useColumns(pickPerson: (person: Person) => void, pickViewer: (hash: string, name: string) => void) {
  return useMemo(
    () =>
      col.columns([
        col.accessor("at", {
          header: "Time",
          enableSorting: false,
          cell: (info) => <TimeCell entry={info.row.original} />,
          meta: { width: "12.5rem" },
        }),
        col.accessor((entry) => entry.viewer.name, {
          id: "viewer",
          header: "Viewer",
          enableSorting: false,
          cell: (info) => <ViewerCell entry={info.row.original} onPick={pickViewer} />,
          meta: { width: "11rem" },
        }),
        col.accessor((entry) => ACCESS_ACTION_LABELS[entry.action], {
          id: "action",
          header: "Action",
          enableSorting: false,
          cell: (info) => {
            const detail = detailWords(info.row.original);
            return (
              <span className="flex flex-col py-0.5">
                <span className="text-ink">{info.getValue()}</span>
                {detail ? <span className="text-xs text-ink-low">{detail}</span> : null}
              </span>
            );
          },
          meta: { width: "13rem" },
        }),
        col.accessor((entry) => entry.project ?? "", {
          id: "board",
          header: "Board",
          enableSorting: false,
          cell: (info) =>
            info.row.original.project ? (
              <span className="mono text-ink-mid">{info.row.original.project}</span>
            ) : (
              <span className="text-ink-low">Every board</span>
            ),
          meta: { width: "7rem" },
        }),
        col.display({
          id: "subjects",
          header: "Whose figures",
          cell: (info) => <SubjectsCell entry={info.row.original} onPick={pickPerson} />,
          meta: { cellClassName: "whitespace-normal" },
        }),
      ]),
    [pickPerson, pickViewer],
  );
}

/* --------------------------------------------------------- phone list --- */

function EntryList({
  entries,
  empty,
  summary,
  actions,
  onPickPerson,
  onPickViewer,
}: {
  entries: AccessLogEntry[] | undefined;
  empty: ReactNode;
  summary: ReactNode;
  actions: ReactNode;
  onPickPerson: (person: Person) => void;
  onPickViewer: (hash: string, name: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-low">
        <p className="min-w-0">{summary}</p>
        {actions}
      </div>
      {entries === undefined ? (
        <SkeletonGroup label="Loading the access log" className="flex flex-col divide-y divide-rule-weak rounded-lg border border-rule-weak">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <span key={index} className="flex h-[5.5rem] flex-col justify-center gap-2 px-3.5">
              <Skeleton className="h-3.5 w-48" />
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-5 w-40 rounded-full" />
            </span>
          ))}
        </SkeletonGroup>
      ) : entries.length === 0 ? (
        <div className="rounded-lg border border-rule-weak">{empty}</div>
      ) : (
        <ol aria-label="Access log entries" className="flex flex-col divide-y divide-rule-weak rounded-lg border border-rule-weak">
          {entries.map((entry) => {
            const detail = detailWords(entry);
            const role = viewerRoleLine(entry);
            return (
              <li key={entry.id} className="flex flex-col gap-1.5 px-3.5 py-3">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 text-sm font-medium text-ink">{ACCESS_ACTION_LABELS[entry.action]}</span>
                  {detail ? <span className="shrink-0 text-xs text-ink-low">{detail}</span> : null}
                </span>
                <TimeCell entry={entry} className="text-xs" />
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-xs text-ink-low">
                  <button
                    type="button"
                    onClick={() => onPickViewer(entry.viewer.hash, entry.viewer.name)}
                    className="max-w-full truncate text-left text-sm text-ink decoration-rule-strong underline-offset-2 hover:underline"
                  >
                    {entry.viewer.name}
                  </button>
                  {role ? <span>{role}</span> : null}
                  <span aria-hidden>·</span>
                  {entry.project ? <span className="mono">{entry.project}</span> : <span>Every board</span>}
                </span>
                {entry.subjects.length > 0 ? <SubjectsCell entry={entry} onPick={onPickPerson} /> : null}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- export --- */

/** Every entry the filters keep (up to the service's 10,000, the newest), as CSV; the service records the export. */
function ExportButton({ filters, disabled }: { filters: Parameters<typeof getAccessLog>[0]; disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const log = await getAccessLog({ ...filters, export: true, limit: ACCESS_LOG_EXPORT_MAX });
      const name = csvFileName("access-log");
      downloadCsv(toCsv(log.entries, ACCESS_LOG_CSV_COLUMNS), name);
      const count = log.entries.length;
      const capped = log.next_cursor !== null ? ` Only the newest ${formatCount(count)} were saved.` : "";
      notify.ok("Export ready", {
        description: `${formatCount(count)} ${count === 1 ? "entry" : "entries"} saved as ${name}. ${capped}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The export could not be made.";
      notify.warn("Couldn't export the access log", { description: message });
    } finally {
      setBusy(false);
    }
  };
  const button = (
    <Button
      icon={Download}
      size="sm"
      loading={busy}
      onClick={disabled || busy ? undefined : () => void run()}
      aria-disabled={disabled || undefined}
    >
      {busy ? "Exporting" : "Export CSV"}
    </Button>
  );
  return disabled ? <Tooltip content="No entries to export">{button}</Tooltip> : button;
}

/* --------------------------------------------------------------- view --- */

/** The actions read when none is picked: all but views of the log itself, which its own loads would otherwise fill. */
export const DEFAULT_ACTIONS: readonly AccessAction[] = ACCESS_ACTIONS.filter((value) => value !== "access_log_view");

export function AccessLogView() {
  const locale = useFigureLocale();
  const [filters, setFilters] = useQueryStates(filterParsers, { history: "replace", scroll: false });
  const action = useMemo(() => filters.action ?? [], [filters.action]);
  const query = useMemo(
    () => ({
      from: filters.from ?? undefined,
      to: filters.to ?? undefined,
      action: action.length > 0 ? action : DEFAULT_ACTIONS,
      person: filters.person ?? undefined,
      viewer: filters.viewer ?? undefined,
    }),
    [filters.from, filters.to, action, filters.person, filters.viewer],
  );
  const backwards = query.from !== undefined && query.to !== undefined && query.from > query.to;
  const log = useAccessLog(query, { enabled: !backwards });
  const refreshLog = useAccessLogRefresh(query);
  const pages = log.data?.pages;
  const entries = useMemo(() => pages?.flatMap((page) => page.entries), [pages]);
  const meta = pages?.[0]?.meta;
  // Everyone the whole log holds (a first page's facets), so the filters offer them all, on any board.
  const facets = pages?.[0]?.facets ?? null;
  const zone = meta?.report_timezone ?? "UTC";
  const today = meta ? dayIn(meta.generated_at, zone) : null;
  // Other filters loading: the entries on screen are the last filters', dimmed and said so until the new ones arrive.
  const updating = log.isPlaceholderData;
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try {
      await refreshLog();
    } finally {
      setRefreshing(false);
    }
  };

  const [seen, setSeen] = useState<Seen>(NOTHING_SEEN);
  if (entries && entries !== seen.from) setSeen(seenWith(seen, entries));
  const seenPeople = seen.people;
  const seenViewers = seen.viewers;

  const pickPerson = useMemo(
    () => (person: Person) => {
      void setFilters({ person: person.id });
      acknowledge(`Whose figures: ${person.name}`);
    },
    [setFilters],
  );
  const pickViewer = useMemo(
    () => (hash: string, name: string) => {
      void setFilters({ viewer: hash });
      acknowledge(`Viewer: ${name}`);
    },
    [setFilters],
  );
  const columns = useColumns(pickPerson, pickViewer);

  const actionOptions = useMemo<ComboboxOption[]>(() => ACTION_MENU.map((value) => ({ value, label: ACCESS_ACTION_LABELS[value] })), []);
  const personOptions = useMemo<ComboboxOption[]>(() => {
    const people = new Map<string, Person>();
    for (const person of facets?.subjects ?? []) people.set(person.id, person);
    for (const [id, person] of seenPeople) if (!people.has(id)) people.set(id, person);
    if (filters.person && !people.has(filters.person)) {
      people.set(filters.person, { id: filters.person, name: facets ? NOT_IN_LOG : LOADING_NAME, avatar: null });
    }
    const former = (person: Person) => person.name === FORMER_MEMBER && person.avatar === null;
    return [...people.values()]
      .sort(
        (a, b) =>
          Number(former(a)) - Number(former(b)) || a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || (a.id < b.id ? -1 : 1),
      )
      .map((person) => ({
        value: person.id,
        label: person.name,
        leading: <PersonAvatar person={former(person) || person.name === NOT_IN_LOG || person.name === LOADING_NAME ? null : person} />,
      }));
  }, [facets, seenPeople, filters.person]);
  const viewerOptions = useMemo<ComboboxOption[]>(() => {
    const viewers = new Map<string, string>();
    for (const viewer of facets?.viewers ?? []) viewers.set(viewer.hash, viewer.name);
    for (const [hash, name] of seenViewers) if (!viewers.has(hash)) viewers.set(hash, name);
    if (filters.viewer && !viewers.has(filters.viewer)) viewers.set(filters.viewer, facets ? NOT_IN_LOG : LOADING_NAME);
    return [...viewers.entries()]
      .sort((a, b) => a[1].localeCompare(b[1], "en", { sensitivity: "base" }))
      .map(([value, label]) => ({ value, label, keywords: [value] }));
  }, [facets, seenViewers, filters.viewer]);

  const filtered = query.from !== undefined || query.to !== undefined || action.length > 0 || query.person !== undefined || query.viewer !== undefined;
  const clear = () => {
    void setFilters({ from: null, to: null, action: null, person: null, viewer: null });
    acknowledge("Every filter cleared");
  };

  const failure = log.error;
  const total = entries?.length ?? 0;
  const empty = filtered ? (
    <EmptyState
      size="compact"
      title="No reads match these filters"
      description="Try a wider period."
      action={
        <Button size="sm" onClick={clear}>
          Clear filters
        </Button>
      }
    />
  ) : (
    <EmptyState
      size="compact"
      icon={ScrollText}
      title="Nothing recorded yet"
      description="Reads of people's figures will appear here."
    />
  );
  const summary = entries ? (
    updating ? (
      <span aria-live="polite">Updating…</span>
    ) : (
      <span aria-live="polite">
        <span className="mono text-ink-mid">{formatCount(total, { locale })}</span> {total === 1 ? "entry" : "entries"}
        {log.hasNextPage ? " so far" : ""}
        {total > 1 ? ", newest first" : ""}, as of{" "}
        {meta ? <Timestamp value={meta.generated_at} mode="time" /> : null}.{action.length === 0 ? " Views of this log are left out." : null}
      </span>
    )
  ) : (
    <Skeleton className="h-3 w-56" />
  );
  const actions = (
    <span className="flex shrink-0 items-center gap-1.5">
      <Button
        icon={RotateCcw}
        size="sm"
        variant="ghost"
        loading={refreshing}
        onClick={!entries || refreshing ? undefined : () => void refresh()}
        aria-disabled={!entries || undefined}
      >
        {refreshing ? "Refreshing" : "Refresh"}
      </Button>
      <ExportButton filters={query} disabled={!entries || total === 0} />
    </span>
  );

  return (
    <div className="flex flex-col gap-5">
      <div role="search" aria-label="Filter the access log" data-print="hide" className="flex flex-wrap items-center gap-2">
        <PeriodFilter
          period={{ from: filters.from, to: filters.to }}
          today={today}
          onChange={(period, said) => {
            void setFilters({ from: period.from, to: period.to });
            acknowledge(said);
          }}
        />
        <Combobox
          label="Action"
          options={actionOptions}
          value={action}
          searchPlaceholder="Search actions"
          emptyText="No action matches that."
          onValueChange={(next) => {
            const chosen = next.filter((value): value is AccessAction => (ACCESS_ACTIONS as readonly string[]).includes(value));
            void setFilters({ action: chosen.length > 0 ? chosen : null });
            acknowledge(chosen.length > 0 ? `Action: ${chosen.map((value) => ACCESS_ACTION_LABELS[value].toLowerCase()).join(", ")}` : "Action: any");
          }}
        />
        <Combobox
          label="Whose figures"
          options={personOptions}
          value={filters.person ? [filters.person] : []}
          searchPlaceholder="Search people"
          emptyText={facets ? "No one by that name is in the access log." : "Loading the people…"}
          onValueChange={(next) => {
            // One person at a time, as the service filters: the newest choice replaces the one before.
            const chosen = next.find((value) => value !== filters.person) ?? null;
            void setFilters({ person: chosen });
            acknowledge(chosen ? `Whose figures: ${personOptions.find((option) => option.value === chosen)?.label ?? "someone"}` : "Whose figures: anyone");
          }}
        />
        <Combobox
          label="Viewer"
          options={viewerOptions}
          value={filters.viewer ? [filters.viewer] : []}
          searchPlaceholder="Search viewers"
          emptyText={facets ? "No viewer by that name is in the access log." : "Loading the viewers…"}
          onValueChange={(next) => {
            const chosen = next.find((value) => value !== filters.viewer) ?? null;
            void setFilters({ viewer: chosen });
            acknowledge(chosen ? `Viewer: ${viewerOptions.find((option) => option.value === chosen)?.label ?? "a viewer"}` : "Viewer: anyone");
          }}
        />
        {filtered ? (
          <Button size="sm" variant="ghost" icon={X} onClick={clear}>
            Clear filters
          </Button>
        ) : null}
      </div>

      {backwards ? (
        <EmptyState size="compact" title="That period ends before it starts" description="Choose a first day on or before the last." action={<Button size="sm" onClick={clear}>Clear filters</Button>} />
      ) : failure && !pages ? (
        <div className="rounded-md border border-rule-weak">
          <ErrorState
            title="The access log could not be read"
            description={failure.message}
            detail={errorDetail(failure)}
            onRetry={() => void log.refetch()}
            retrying={log.isFetching}
          />
        </div>
      ) : (
        <div
          aria-busy={updating || undefined}
          className={cn("@container transition-opacity duration-150 motion-reduce:transition-none", updating && "opacity-60")}
        >
          <div className="hidden @min-[48rem]:block">
            <DataTable
              caption="Access log"
              data={entries ?? NO_ENTRIES}
              columns={columns}
              getRowId={(entry) => entry.id}
              loading={!entries}
              loadingRows={8}
              minWidth="58rem"
              empty={empty}
              toolbar={summary}
              actions={actions}
            />
          </div>
          <div className="@min-[48rem]:hidden">
            <EntryList
              entries={entries}
              empty={empty}
              summary={summary}
              actions={actions}
              onPickPerson={pickPerson}
              onPickViewer={pickViewer}
            />
          </div>
        </div>
      )}

      {entries && log.hasNextPage ? (
        <div className="flex flex-col items-center gap-2" data-print="hide">
          <Button
            size="sm"
            loading={log.isFetchingNextPage}
            onClick={() => void log.fetchNextPage()}
          >
            {log.isFetchingNextPage ? "Loading" : `Show ${formatCount(ACCESS_LOG_DEFAULT_LIMIT, { locale })} more`}
          </Button>
          {log.isFetchNextPageError ? <p className="text-xs text-warn-ink">The next entries could not be read. Try again.</p> : null}
        </div>
      ) : null}
    </div>
  );
}

const NO_ENTRIES: AccessLogEntry[] = [];

interface Seen {
  from: readonly AccessLogEntry[] | undefined;
  people: ReadonlyMap<string, Person>;
  viewers: ReadonlyMap<string, string>;
}

const NOTHING_SEEN: Seen = { from: undefined, people: new Map(), viewers: new Map() };

function seenWith(seen: Seen, entries: readonly AccessLogEntry[]): Seen {
  const people = new Map(seen.people);
  const viewers = new Map(seen.viewers);
  for (const entry of entries) {
    for (const person of entry.subjects) if (!people.has(person.id)) people.set(person.id, person);
    if (!viewers.has(entry.viewer.hash)) viewers.set(entry.viewer.hash, entry.viewer.name);
  }
  return { from: entries, people, viewers };
}

/** While the address is read: the filter row and the table's frame, in their final places. */
export function AccessLogViewFallback(): ReactNode {
  return (
    <div aria-hidden className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2">
        {[9, 7, 9, 6].map((width, index) => (
          <Skeleton key={index} className="h-8 rounded-md" style={{ width: `${width}rem` }} still />
        ))}
      </div>
      <div className="h-[28rem] rounded-lg border border-rule-weak" />
    </div>
  );
}
