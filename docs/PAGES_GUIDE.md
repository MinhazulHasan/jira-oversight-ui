# Building a page: the short guide

Everything a page builder needs, in one place. The design brief is
[DESIGN.md](DESIGN.md) (read §1, §2, §3, §5, §7 and your page in §6); the data
contract is [API_CONTRACT.md](API_CONTRACT.md) (read §2, §3 and your endpoint in
§4); exact response shapes are in [sample-responses/](sample-responses/). Do not
read the whole codebase: the kit is proven, use it as below.

## Where things are

| Need | Import | Notes |
|---|---|---|
| Page frame | `PageSheet`, `PageHeader`, `PageBody` from `@/components/shell/page` | `PageHeader` takes `title`, `purpose`, optional `eyebrow`, `actions` (Copy link, Export CSV). See the placeholder `page.tsx` you replace. |
| Data | hooks from `@/lib/api/hooks` | `useOverview()`, `usePeople()` (who holds the board's tickets), `usePeopleDirectory({ enabled })` (everyone on the board, members with no tickets too: Ask's @ list only), `useFindings(query)` (`person: [id or "unassigned"]` among its filters), `useFinding(id)`, `useIssueTimeline(key)`, `useAsk()` (mutation, `.mutate({ question, mentions })`, mentions being person ids), `useInsights()`, `useTrend(metric, lastN?)`, `useRules()`, `useBaseline()`, `useHealth()`, and (JO-12) `usePortfolio()` (every board the reader may open), `useAccessLog(filters)` (people level only; an infinite query: `fetchNextPage()` follows the cursor; reading it is recorded, so it never refetches on its own) and `useUsage()` (people level only), and (JO-13) `usePersonCard(id, { days, board })` (people level only; read when a card opens, fresh for a minute; pages never call it: they use the triggers below), and (JO-15) `useRuleSettings()` (people level only; read every 2 s while the service re-checks the board after a save), `useRuleSettingsPreview()` and `useSaveRuleSettings()` (mutations; a save marks every figure the rules decide as stale; never retried), and (JO-20) `useRuleDraft()` (mutation, `.mutate(text)`: an AI draft of a rule; saves nothing and marks nothing stale; never retried). Never fetch directly. Errors are `ApiError` (`.notFound`, `.retryable`). Types come from `@/lib/api/schemas`. |
| Figures | `formatByKind(value, kind, { locale })`, `formatCount`, `formatHours`, `formatRatio`, `formatShare`, `formatDate`, `formatDateTime`, `formatRelative` from `@/lib/format`; `useFigureLocale()` from `@/components/ui/use-figures` | Always pass the locale from `useFigureLocale()` (server and browser must agree). `Timestamp` (`@/components/ui/timestamp`) renders a time with its zone and a relative tooltip: use it for every date in the UI. |
| Toasts | `notify.ok / .cite / .warn / .info` from `@/lib/notify` | Every action is acknowledged: filter applied, link copied, export done, question answered. |
| URL state | `useQueryState` / `useQueryStates` from `nuqs` | Filters, sort, page, the open drawer (`?finding=<id>`). The URL is the state. |
| Severity | `SeverityBadge`, `SeverityMark`, `StateDot` from `@/components/ui/badge` | breach / warning / resolved / not measurable: mark + label, never colour alone. |
| Layout pieces | `Section` (micro label + hairline), `Card`, `KeyValueList`, `Callout` (info, and the hatched not-measurable variant) | |
| States | `Skeleton*`, `EmptyState`, `ErrorState` (with retry) | Every data region has loading (skeleton in the final shape), empty (say what was looked at), error (inline, retry) and data. |
| Controls | `Button`, `IconButton`, `SegmentedControl`, `Select`, `Combobox` (multi-select), `DateRange`, `SearchInput`, `Chip`, `Tabs`, `DropdownMenu`, `Popover`, `Tooltip`, `Kbd`, `CopyButton`, `ExportCsvButton`, `Pagination`, and (JO-15) `Switch` (On/Off, in ink) and `NumberField` (a compact spin button with its bounds and unit, read leniently), and (JO-20) `Checkbox` (a choice among others, named by its words), `TextInput` and `TextArea` (a form field in the kit's edge, `invalid` in the breach ink) | All in `@/components/ui/*`. |
| Tables | `DataTable` from `@/components/ui/data-table` | Sortable, sticky head (`maxHeight`), right-aligned figures, row click + Enter, `j`/`k`, `keyboardScope="page"`, `selectedRowId`, `toolbar`/`actions` render props that receive the rows as shown (feed `ExportCsvButton`). Accessors return `undefined` for missing values. |
| Drawer | `Sheet` from `@/components/ui/sheet` | 560 px from the right, focus trapped, Esc closes. The evidence drawer, driven by `?finding=` with nuqs, is in `src/components/findings/finding-drawer.tsx`: copy its structure. |
| Charts | `@/components/charts/*`: `ChartFrame`, `TrendLine`, `Sparkline`, `BarList`, `StackedBarList`, `Meter`, `RangeBars`, `StatusTimeline`, `Legend`; table builders `trendTable`, `barListTable`, `stackedBarTable`, `timelineTable`; scales `axisHours`, `axisRatio`, `axisShare`; colours `seriesColour(slot)`, `stageColour`, `STATUS_COLOURS` from `palette.ts` | Every chart sits in a `ChartFrame` with a title, a one-sentence screen-reader summary and a table view. Colour follows the entity (fixed slot), never its rank. TrendLine wants weekly rows `{ week: "YYYY-MM-DD" (Monday), [series]: number \| null }`. StatusTimeline's lane/interval/skip shapes are exported from `status-timeline.tsx`. |
| Headline numbers | `StatTile`, `StatTileGrid`, `Delta`, `signed()` from `@/components/ui/stat-tile` | `signed(formatHours)` for deltas; `direction_good` from the contract decides better/worse. A tile with `href` leads somewhere (filtered findings). |
| Ask citations | `segmentAnswer()` from `@/lib/api/citations` | Splits an answer into text and cited values without landing inside a rule id or a longer number. |
| A person's card | `PersonCardTrigger` (with `NAME_TRIGGER`), `PersonCardChip`, `PersonCardPill`, `PersonCardHover` from `@/components/person-card/person-card-trigger` | Wrap a person's name (`PersonName`, or the picture and the name) in `PersonCardTrigger`: at people level it becomes a button that opens their card on hover and pins it on a press (a bottom sheet on a phone); at team level the name is left exactly as it was. In a table row with its own press and keys, pass `inRow` and `tabbable={false}`. A mention chip in an editable field (the question box) is a `PersonCardChip`: hover and a press open its card, the field keeps the press from moving its caret, and `onReturnFocus` gives focus back to the field just after the chip. A pill whose press is its own (the access log's people, who filter the log) is a `PersonCardPill`: the card on hover over the whole pill, and its picture the card's own button for the keyboard and a tap. Where the name sits inside a control that presses for something else (the Person filter, a link to their findings), use `PersonCardHover`: a card on hover alone, so only where the same card is a key or a tap away elsewhere on the page. Inside a trigger, render the name with `PersonName` or `NameText` (`@/components/ui/person-name`), which drop their tooltip there: the card says the whole name. Pass the page's period as `days` where it has one, and `board` where the person is from another board than the top bar's (an access log entry). What happens inside a card never reaches the row or field the name sits in (`CONTAINED_EVENTS`, `src/components/ui/contained-events.ts`). |

**See a component in use:** search `src/components` for its name.

## Rules of the house

- **Mac first.** Design for 1440×900 and 1512×982 (a MacBook with the browser not
  full-screen, about 800 px of height): the first screen of every page says
  something useful. Readers are in the US, UK and EU; their bar is Linear,
  Stripe, Vercel. Calm, exact, dense but never cramped.
- **The accent (`--cite`, teal) means traceable** only: links to evidence,
  citation markers, focus, the one primary action. Never decoration.
- **People as the API names them:** an assignee is a person object
  (`{id, name, avatar}`, the Jira display name and their picture's version) or
  null ("Unassigned"); show the name with `PersonAvatar` beside it (or use
  `PersonName`, which does both), filter by the id. The picture comes only from
  `/api/oversight/people/{id}/avatar`; never an email address, an account id or
  Jira's picture URL on screen. Worklogs are totals. Ask names people only for
  an admin (and with sign-in off), decided by the oversight route on every
  question; everyone else's Ask stays at team level. Lists of people come from
  `usePeople()` (who holds the board's tickets); only Ask's @ list reads
  `usePeopleDirectory()`, everyone Jira lets you assign the board's tickets to,
  in two groups ("With tickets", "No tickets"). A member with no tickets has
  no findings: `/findings?person=<their id>` is an empty list.
- **Sample data is labelled** (the shell's pill does it) and uses `DEMO-…` keys.
  `issue.url` is null in sample mode: render "Open in Jira" disabled with a
  tooltip ("Sample data: no Jira link") rather than hiding it.
- **Every row is clickable** and opens something new (drawer or page). Rows show
  the affordance on hover and focus.
- **Keyboard:** `/` focuses the page search (`SearchInput` handles it), `j`/`k`
  move through table rows, Enter opens, Esc closes. Never steal keys while the
  user types.
- **Print** must work (A4 and US Letter): no fixed heights that clip, evidence
  prints with its claim.
- **No new dependencies.** Everything above is installed.
- **Sign-in is the shell's business, not the page's.** With sign-in on, every
  page under `(app)` is behind it already (`src/proxy.ts`), and a data hook
  that meets an ended session sends the reader to `/login` and back. The
  sign-in pages, `/login` and `/no-access`, live in `(sign-in)`, outside the
  shell, and never call the oversight API.

## Working here

- Server components by default; `"use client"` only where interaction needs it
  (every data hook is client-side, so data regions are client components).
- **Do not run `next build`, `next start` or `next dev`, and do not take
  screenshots:** six page builders share one `.next` folder and port 3400. A QA
  pass after you builds, runs the end-to-end suite and captures every page.
  You run: `npx tsc --noEmit` (or `npm run typecheck`), `npx eslint <your files>`,
  and `npx vitest run <your test files>`.
- Write an end-to-end spec for your page in `e2e/<page>.spec.ts` (Playwright;
  see `e2e/smoke.spec.ts` for the setup: the sample server, the frozen clock,
  axe). The QA pass runs it.
- Write component tests next to your components (`__tests__/`), with Testing
  Library; the kit's jsdom shims are in `src/components/ui/__tests__/kit.tsx`.
- Work in small pieces: at most about 250 lines per file write, build up, test
  as you go.
