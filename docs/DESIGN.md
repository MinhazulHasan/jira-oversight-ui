# Jira Oversight — interface design

The front end for **Jira Oversight**: a read-only, "supercharged dashboard for
looking at the work" (Planning.md, Phase 8). Rules decide, AI explains, and
every number on screen can be traced to the tickets behind it.

This document is the brief. When code and this document disagree, fix the one
that is wrong, but never silently.

---

## 1. Who reads it

James Hudson (ManCo Central, UK) and his leads, and colleagues in the US and
EU. They own the delivery process; they are not Jira power users. They read on
large monitors, print pages (Cmd-P in the first minute), screenshot charts into
decks, and forward links. Every screen must survive all four.

What they should feel in the first ten seconds: *calm, exact, trustworthy.*
Not a developer tool, not a BI toy. An instrument.

Most of them read on **MacBooks** (13" to 16", Retina, Safari or Chrome, the
browser rarely full-screen), so the primary viewport is about 1440×900 with
roughly 800 px of usable height. Vertical space is the scarce resource; every
page must say something useful in its first screen. Their reference points for
quality are the US SaaS tools they use daily (Linear, Vercel, Stripe, Notion):
crisp at 2× pixel density, keyboard-driven, fast, with a command palette, dark
mode, and empty and loading states that look designed.

## 2. Family resemblance: Ask the System

Jira Oversight is a sibling of `ask_the_system_ui` (same client, same team,
same stack; Planning.md asks for "a consistent look"). Reuse its language:

- **Grounds.** Warm *paper* in light (the primary theme), institutional
  *slate* in dark. Light is authored first; dark is its own set of steps,
  never an inversion. Tokens are defined on `:root`, redefined under
  `prefers-color-scheme: dark` and again under `[data-theme]`, so an explicit
  toggle wins both ways.
- **Hairline rules**, a *sheet* on a *desk*, *raised* controls, `micro`
  uppercase labels (10.5 px, 0.08em tracking).
- **One accent** — the teal `--cite`. It means *traceable*: links to evidence,
  citation markers, bound values, the tick-and-tie line, the focus ring and the
  single primary action. It is never decoration, never a chart series, never a
  nav highlight.
- **Figures in IBM Plex Mono**, tabular and lining numerals, the same
  self-hosted files Ask the System ships.
- **The toast is a ruled status line** with a 3 px tone bar, bottom right.
- **Motion is restrained:** content rises 6 px as it fades in, a trace line
  draws itself, a wait sweeps. Nothing bounces or spins. `prefers-reduced-motion`
  turns it all off.
- **Print is a first-class medium.** Evidence prints with the claim.

Copy the token values from `../ask_the_system_ui/src/app/globals.css` and
extend them; do not invent a second palette.

## 3. Semantic colour

Status colour is reserved and always ships with an icon and a label, never
colour alone.

| Meaning | Token | Mark | Label |
|---|---|---|---|
| Breach ("blatantly bad") | `--breach` (clay) | filled square | Breach |
| Warning ("on its way to being bad") | `--warn` (amber) | triangle | Warning |
| Resolved / healthy | `--ok` (green) | check | Resolved |
| Not measurable (Jira can't prove it) | the **hatch** texture + `--text-low` | hatched square | Not measurable |
| Neutral / information | `--text-low` | dot | — |

"Not measurable" reuses Ask the System's redaction hatch. It means *the
process step exists but Jira holds no evidence for it*. For James that is a
finding in itself, so it gets a calm, deliberate look, not an error look.

## 4. Typography

- **Sans:** the system stack with San Francisco first (`-apple-system,
  BlinkMacSystemFont`), then self-hosted Inter, then `system-ui, "Segoe UI"`,
  exactly as Ask the System does. Mac readers get the native face; Windows and
  Linux readers get a close cousin. Weights 400, 500 and 600 only; never 300,
  which goes thin on Retina.
- **Mono:** IBM Plex Mono 400/500 for issue keys, numbers, timestamps, ids.
- **Scale** (from Ask the System): 10.5 micro · 12 · 13 · 15 base · 16 · 17 ·
  21 · 22 · 30 hero.
- **Numbers:** right-aligned in tables; units in `--text-low`; hours to 1 dp
  ("12.5 h"); ratios to 2 dp with a times sign ("1.42×"); shares as whole
  percentages ("16%"; "<1%" below one); counts with thousands separators.

## 5. Shell

- **Rail** (left, 232 px, collapsible to 64 px): product mark, navigation
  (Portfolio, Overview, Findings, People for people level only, Ask, Insights;
  Process, Baseline under Reference; Access log, Usage and Rule settings under
  Governance, for people level only, the group gone for anyone else), keyboard hints and
  the data source at the foot. The active item uses ink and a pressed ground,
  not the accent.
- **Top bar** (56 px): page title, the **data-source pill** ("Sample data ·
  read-only", or "Live · <project>"), **Last synced** (absolute time with zone
  plus relative; amber when older than 2 hours), the ⌘K search and the theme
  toggle (light, dark, system). With sign-in on, **Sign out** comes last: an
  icon with its tooltip, and on a phone a labelled row at the foot of the
  navigation sheet; the ⌘K palette has it too. It names no one.
- **Board picker** (JO-17): every board the service serves, which may be
  dozens: a search field first (the focus stays there; arrows, Page Up and
  Down, Enter, Escape), then "Synced" and "Not synced yet", each board by name
  and key, a synced one with its last sync. **Sync** (JO-18) is the sync time
  itself: it syncs the board on screen and names it ("Sync AILED"), then says
  "Queued" or "Syncing" until it ends, "Sync failed" after a failure, and "Not
  synced yet" for a board that has never synced. Such a board shows, in place
  of every page that reads one board, one calm state: "<Board> hasn't been
  synced yet.", one line on how long a first sync takes, and "Sync <Board>".
- The top bar never scrolls sideways. Its controls never shrink; the page
  name gives way first (its group shows only when the whole trail fits), then
  the board's name truncates. Below 1440 px it sheds words, never controls:
  "Synced" for "Last synced", "Search" for "Search or jump to", and no board
  key beside the board's name; below 1280 px the search is its icon and the
  sync time its relative age (the absolute time in its tooltip); below
  1024 px the pill says "Sample" or "Live", the sync time drops the word, and
  the theme moves to the palette, as on a phone. Words that go are still read
  out by screen readers.
- **Content:** a sheet on the desk, 24–32 px gutters. Every page opens with a
  header: title, one line on what the page answers, and its actions (Copy
  link, Export CSV where there is a table).
- Designed for 1440×900 and 1512×982 first (a 13" or 14" MacBook with the
  browser not full-screen), comfortable at 1728×1117 and 1920 wide, readable
  down to 390 px. The top bar is 56 px, section headers are compact, and the
  Overview's first screen already shows the headline numbers and the hot spots
  without scrolling.

## 6. Pages (Planning.md Phase 8)

1. **Overview** `/` — stat tiles (open breaches, open warnings, new this week,
   resolved this week, rules not measurable) with week-on-week deltas and
   sparklines (on a phone a label has its row to itself, the hover-only arrow
   gone, and a long one takes a second line rather than being cut, the
   figures in a row of tiles level; at any width a tile too narrow for its
   label and the arrow drops the arrow, and where one label in a row takes a
   second line every label in that row keeps two, measured in the browser,
   so the figures stay level with no blank line where all fit); hot spots
   (top epics by open findings, a long epic title wrapping, never cut); findings by rule; open
   findings by person (the top eight by open breaches, then warnings, with the
   unassigned tickets as a row of their own; at people level a person's
   picture and name open their card, the rest of the row their open findings,
   and in the Table view the name opens the card too;
   "All people" opens the Person
   menu on Findings); coverage of estimates, time logs and process evidence;
   trend cards (median cycle time, median effort ratio, skipped-stage share,
   reopen rate); where work sits now; a teaser of the latest insight. Every
   tile and bar clicks through to the filtered findings.
2. **Findings** `/findings` — one filter row (search, severity, state, rule,
   epic, person, first seen), a sortable table with each issue's assignee by
   name (the API cannot sort by assignee, so that header does not offer to),
   and an **evidence drawer** that shows why the rule fired: the rule and its
   threshold, the exact changelog entries (time, from → to, changelog id), a
   mini status timeline, first/last seen, and "warned on X, breached on Y"
   where a warning preceded the breach, and who has the issue now. The URL
   holds every filter and the open finding, so any view can be shared.
   First seen ("6 h ago") and Open for read one clock, rounded alike: an open
   finding is open for the time since it was first seen while the board's last
   sync is fresh; once that sync is older than the top bar's two hours, its age
   stops at the last rules run that saw it, and the column's header says so
   under its name ("at last sync", the sync's time in its tooltip), as the
   drawer does beside the figure. The export keeps the rules runs' own span
   (first seen to last seen), which its two columns beside it check.
3. **Issue** `/issues/[key]` — the assignee by name beside the status and epic
   (leading to their open findings), or Unassigned; facts (points, time
   logged, effort ratio against its threshold, cycle time, reopens, when the
   estimate was set), the status timeline as a swimlane coloured by stage with
   skipped stages marked, the changelog, worklog totals (never names) and the
   issue's findings.
4. **Ask** `/ask` — the Ask the System pattern: question, answer prose with
   bound values and citation markers, a facts ledger, and a tick-and-tie line
   from each cited value to its row. The **five outcomes** each get their own
   calm state: `answered`, `not_understood` (what can be asked, with
   suggestions), `no_data` (what was searched), `not_measurable` (the hatch, the
   missing evidence, and why that is a finding), `not_verified` (the facts table
   only, with a plain explanation). None of them looks like an error page.
   For an admin (and with sign-in off), @ in the question picks people from the
   board as in Jira and Confluence, and an answer marks the people it names;
   nothing about people is declined there: a question that evaluates someone
   is answered with figures next to the whole board's, drawn compact under the
   words (one scorecard with its one-line summary, several side by side with
   the whole board's column beside the measure, or everyone in order, nobody
   numbered and anyone with too few tickets labelled so; in a narrow column
   each mark heads its column as its icon, named by the key, so the
   comparison fits its frame), then the closing
   sentences: a personnel question's "The figures are above; the decision is
   yours.", and the caveat last. The marks' key shows wherever marks do.
   Where an organisation has turned comparison off,
   comparing people is said calmly in one sentence. For anyone else a question
   about a person is declined at team level, with the way to the Person
   filter. In the facts and the plan a person shows by name and picture, never
   by id.
5. **Insights** `/insights` — the weekly briefing (≤ 200 words) as an editorial
   sheet: each sentence carries its tone (blatantly bad / on its way to being
   bad) and links to the candidates and findings behind it; the ranked
   candidates with their score (issues affected × severity × trend); a note on
   how it was written (rules decided, AI wrote it from these candidates only,
   every number verified).
6. **Process** `/process` — James's process (estimate → development → code
   review → dev sign-off → testing → test review → test sign-off) against what
   Jira records: the statuses mapped to each stage, and per stage whether
   evidence is tracked or *not measurable*; the rule catalogue (id, title,
   severity, rule or warning, threshold, measurable, open findings, version)
   as the board runs it (JO-15): a rule an admin turned off is muted across
   its row (its severity a muted badge), "Off on this board", a customised
   one carries "Customised" (the neutral badge, as on Rule settings), a rule
   the board added (JO-20) "Custom" with its check's label, and an
   admin has "Edit rule settings" beside the heading and in the drawer.
7. **People** `/people` (people level only: an admin, or anyone with sign-in
   off; anyone else gets the not-found page) — how tickets are handled, next
   to the whole board, over 30, 90 or 180 days. With comparison on (the
   default), the everyone table: the marks' key above it, the person (20 px
   picture and name) held at the left while a column per measure scrolls,
   sortable by any column (a measure sorts closer to the process first, too
   few tickets always last), each header's tooltip saying what it counts, the
   whole board as the last row set apart by a rule and the rail's ground, the
   caveat under it, and a row's choice opening its scorecard below (and saying
   so); at 390 px it is a list with the sort above it, where someone compared
   on no measure reads "Too few tickets". A link to someone's scorecard lands
   on it. With comparison off, a person picker (the @ list's
   two groups, "With tickets" first) and one scorecard. The scorecard: the
   person at 24 px beside their name (the count of their tickets at the right
   where it is wide, under the name on a phone, so the name is never cut short
   beside it), one line on where they stand ("Closer
   to the process than the board on 5 of 8 measures; further on 2, level on
   1."), then a 52 px row per measure: the person's figure ("72%" over "18 of
   25", Plex Mono, tabular) beside the board's, the mark ("Closer to the
   process", "Further from the process", "Level with the board", "Too few
   tickets": a shape and words in the neutral inks, never the status colours,
   since none of them is good or bad; the shapes are told apart at 13 px: a
   ring with a dot, an empty ring, two bars, one bar), and a link to the
   tickets behind it in the accent (a list wider than its figure says so:
   "All findings", and for open findings per 10 open tickets, which counts
   those on open tickets, "Open findings on all their tickets"); a
   measure's name opens its definition with a press; the
   measures the board cannot show last, muted, with the hatch and the reason;
   the caveat at the foot. Loading keeps the final shape, sections and
   headings too, the marks' key and the caveat's lines, the table where it
   fits and the list where it does not: nothing below moves when the figures
   arrive, with comparison off as on: the page is laid out for the setting
   this server expects (the sample's, or the service's as it last reported
   it), so the person control, the note and the scorecard's place stand
   where they will. In Ask on a phone, one person's compact scorecard fits
   its frame (tighter cells, the name wrapping rather than cut); several
   stack, one compact card each (the measure, their figure with its mark,
   the board's), with what the board cannot show said once under them.
   Where the answer's column is wider (29rem and up: a desktop's answer column) several stand side by
   side and scroll inside the frame if they must, never the page.
   Ways in: "View scorecard" beside the Findings Person filter (one person
   chosen) and "View scorecards" on the Overview's open findings by person.
8. **Baseline** `/baseline` — the Phase 2 ground-truth report: the window,
   snapshot totals, coverage of estimates, points and logged time, straight
   To Do → Done, hours per point, time in status, cycle time, reopens, the
   Tempo share, issue-link types, and the comparison with ticket 4 (expected,
   actual, match, note). On a phone the comparison scrolls sideways in its
   frame, each figure's name and key read whole in its first column.

9. **Portfolio** `/portfolio` (JO-12; every reader, first in the rail; an
   admin lands here after signing in) — every board at a glance, an executive
   command centre: dense, calm, exact. One sentence across the boards (open
   breaches and warnings, new and resolved this week, how many have not synced
   in the last 2 hours, in amber), then a row per board: the name over its key and its last sync
   (relative; "Stale" with the warning mark past 2 hours on the reader's clock: the top bar's rule and clock, so the
   two never disagree, JO-14); open breaches and warnings with their marks; this
   week's change, net, with new and resolved under it ("Tracking since" and
   the day in a board's first tracked week, as the Overview's tiles say it, and
   no sparkline); an 8-week sparkline of open findings in the context grey;
   the active sprint ("No active sprint" alone when there is none; else at risk
   with the warning mark, on track, or "Risk not measured", over its
   unestimated work or "Estimates not measured"); the top rule, up to two
   lines. A board that has never synced shows a dash, read as "No figures
   yet", in every figure, never zeros, and is said apart in the sentence.
   Sortable by any column but the trend (most open breaches first; the Sprint
   column at risk first, then by unestimated work; a board with no value last
   either way), the sort in the address; a row opens the board's Overview,
   picking it in the top bar first (not a board that has never synced: it has
   no Overview yet, so its row has no pointer, hover or chevron and says why in
   its tooltip); Export CSV. Below 48rem a card per board with the sort above.
   Then "Needs attention": the oldest open breaches across the reader's
   boards, a ruled list with one row for each ticket and rule, never the
   same twice (ticket key in the accent, the rule, the board, first seen,
   seen for: the age counts from when the rules first saw it, on the clock
   Findings reads "Open for" on, so the same breach reads the same age on
   both, "140 d", stopping at the last sync once the board's sync is stale,
   and saying so, "at last sync"; a ticket holding more than one open
   finding of the rule shows how many after the rule's title, "2 findings",
   on the neutral badge at 16 px so the row keeps its height, the title cut
   short before the count, the row dated from the oldest), each opening its
   ticket on its board; empty, it says what is true of the boards above.
10. **Governance** (JO-12, JO-15; people level only, like People; anyone else gets
   the not-found page): **Access log** `/governance/access-log` (`/governance`
   opens it) — who viewed whose figures, and when: the filter row (period,
   action, whose figures, viewer; the pickers offer everyone the log holds),
   a dense table (the time in the organisation's zone with the date in full
   and the zone's short name, the viewer over their role, none under the
   local reader, the action in plain words over its period or count, the
   board, the people read as 20 px pills, three and "+n", each opening the
   person's card when the pointer rests on it), a pill or a viewer's name
   filtering by them, Show 50 more, Refresh, and Export CSV (recorded by the
   service, and said so). Above the table how many entries, when they were
   read and the zone in words, once ("Times in Central Time."); dimmed, busy
   and "Updating…" while other filters load. **Usage** `/governance/usage` —
   today's four figures as tiles, the daily AI budget as a meter (its share
   once, a whole percentage; amber from 90%), one line saying none is set, or
   that no AI model is set up, and the last 7 UTC days as a bar list of tokens
   (of questions when no model answered) with its table view; a week with
   nothing asked is the empty state. **Rule settings** `/governance/rules`
   (JO-15, JO-20; `g` then `r`; contract 4.20 to 4.23) — the board's rules, as an
   admin turns them on or off and sets their severity and thresholds for this
   board alone: a status line (the board, "Revision 3 · last changed 2:10 PM,
   17 Nov 2026 by Morgan Ellis", the 12-hour clock in the reader's zone and no
   zone named, and a chip: Applied with what the re-check did, Re-checking…,
   Will apply at the next sync, Couldn't re-check); the rules in two framed
   groups, "Hard and fast rules" and "Early warnings", a row each (one line
   under column heads where the list is 56rem wide, stacked below): the id
   and title ("What it checks" on demand, "Customised", "Edited"), an On/Off
   switch in ink (never the accent), a Breach/Warning segmented control, the
   thresholds inline as the sentence the check reads ("Flag when effort ≥
   [1.5 ×] the estimate", "≤ [2 days] left and > [30 %] not started"), each a
   compact Plex Mono spin button with its unit inside, "Default 1.5×" under
   it or what is wrong in the breach ink with its mark, "Reset to default",
   the open findings in the accent (traceable) and, where Jira cannot feed
   the rule, the hatch mark with "Not measurable on this board". Edits are a
   draft; a sticky bar rises at the foot ("3 unsaved changes · Discard ·
   Review and save", ⌘↵), its room always kept so nothing moves, and no
   control the keyboard reaches ever under it; leaving asks first. The
   review is a 680 px dialog that opens at its top: each change "from → to",
   the preview's closes / opens / stays open per rule with tickets to look at
   (a severity change's as "Re-filed"; a list of five with more findings past
   it ends "and more"), an optional reason with its counter,
   and "Save and re-check", the one primary action; a save that does not go
   through (a conflict, a refused setting with "Edit" to it, a failure) is
   said under its title, never down the body that scrolls. Every dialog
   gives the focus back to what opened it; an action that takes its own
   button away (Discard, a save, an undo) leaves it on the status. Then the history, newest first, the latest with Undo,
   which asks first ("Keep it" focused). No email address, account id or
   zone name anywhere on it. Since JO-20 (contract 4.20 to 4.23) an admin also
   adds rules of the board's own: "Add rule" in the header opens the "New
   rule" sheet from the right (the screen's width on a phone), where an
   optional "Describe it" (its example on the board's own names) with "Draft
   with AI" fills the form, what came of it said once in a quiet live line
   under it ("then changed", the AI's explanation gone, once the admin
   changes what the rule flags; a name or description still in the AI's
   words says to check it), and the form follows: Name,
   What to check (the check's one line under it), its settings by kind,
   Applies to (the categories as checkboxes, the issue types as a
   multi-select), How serious and a description, each problem said at its
   field in the breach ink; "Add to changes" is the one primary action and
   saves nothing. The board's own rules have a third framed group, "Custom
   rules", with a neutral "Custom" badge, the check's label under the title,
   Edit and Delete beside "What it checks" (a deleted row struck through, with
   Keep), and a rule added and not saved marked "New" with Discard.

Plus a styled 404, an error boundary and loading states.

With sign-in on (live data), two pages sit outside the shell, in the shape of
the root 404: one sheet on the desk under the mark. **Sign in** `/login` says
what signing in does (an Atlassian account; Jira is only ever read) and offers
"Sign in with Atlassian", the single primary action; a failed attempt, a
sign-out, or a server where sign-in is not set up is said calmly just above
it. **No access** `/no-access` says which rule turned the account away (email
domain, unverified address, no access to the Jira site) and how to try another
account. Neither shows anything taken from its address.

## 7. Interaction rules

From Planning.md's UX acceptance, made concrete:

- **Every action is acknowledged** with a toast: filter applied, link copied,
  question sent and answered, export done. A change of the same kind (the
  filters, the period) replaces its toast in place rather than stacking a
  second; one that comes as the last toast is leaving gets a fresh toast of
  its own, so no acknowledgement is lost (`src/lib/notify.ts`).
- **Every row is clickable** and opens something new (a drawer or a page).
  Rows show their affordance on hover and focus.
- **The URL is the state:** filters, sort, page and the open drawer.
- **Keyboard first:** ⌘K / Ctrl+K palette (navigate, jump to an issue key, ask a
  question, switch theme); `g` then `h o f a i p b` to navigate (and `e`, `l`,
  `u` and `r` for People, Access log, Usage and Rule settings at people level); `/` focuses the
  page's search; `j`/`k` move through table rows; Enter opens; Esc closes; `?`
  lists the shortcuts.
- **Every data region has four states:** loading (a skeleton in the final
  shape, no layout shift), empty (says what was looked at), error (inline, with
  retry), and data.
- **Last synced is always visible**, and stale data says so.
- **Nothing is cut short where it cannot be read.** On a narrow screen a
  label in a facts list, a status in a chart, a rule's title and the
  drawer's changelog wrap (in balanced lines) rather than end in an ellipsis.
  Where a table keeps one line a row, a cut value has its whole text in a
  tooltip and in what the row opens.
- **Shortcut hints follow the platform:** ⌘ ⇧ ⌥ ↩ ⎋ glyphs on macOS, Ctrl /
  Shift / Alt / Enter / Esc elsewhere, decided after mount so server and client
  markup match. ⌘K and Ctrl+K both open the palette everywhere.
- **macOS hides scrollbars until you scroll**, so every scroll region shows a
  soft edge shadow while there is more to see, wide tables fade at their right
  edge, panels use `overscroll-behavior: contain`, and horizontal trackpad
  scrolling works on wide tables. Browser back and forward (and the two-finger
  swipe) restore filters and the open drawer, because the URL is the state.

## 8. Charts

Follow the dataviz skill's procedure (form first, colour last; validate the
palette with its script in light *and* dark; thin marks, 2 px lines, 4 px
rounded data ends, 2 px surface gaps; recessive grid; a hover layer on every
chart; a legend for two or more series; a table view for every chart; never a
dual axis). Stages are ordered, so they use one hue stepped light to dark;
statuses use the status palette; "not measurable" uses the hatch. The validated
palette and its report are recorded in §11 below.

Range bars (time in status) put each status's bar between its name and its
three figures, the scale above them. Below a 42rem frame (a phone, a tablet's
column), where the bars would have no room and the scale's ticks would draw
over each other, each status reads as a stacked bar list's rows do: its name
and figures on one line, then its stage and its bar across the full width,
under one scale drawn above them all.

## 9. Accessibility, locale, privacy and platform

- **WCAG 2.2 AA** (what the EU Accessibility Act/EN 301 549, Section 508 and
  the ADA in the US, and UK public-sector guidance expect): text contrast ≥
  4.5:1 and UI ≥ 3:1, visible focus, full keyboard use, landmarks and a skip
  link, `aria-live` for answers and toasts, reflow at 200% zoom,
  `forced-colors` support, charts with an accessible name, a summary and a
  table alternative.
- **Dates are unambiguous on both sides of the Atlantic:** "4 Nov 2026";
  never 11/04/2026. Times read on the 12-hour clock for every reader, "PM" in
  one form ("2:32 PM", "4 Nov 2026, 2:32 PM"; the rule settings page says
  "2:10 PM, 17 Nov 2026"), in the viewer's own zone, which is never named:
  one clock across the app, the top bar's sync time included. A time set in
  another zone than the viewer's names it, since there it would be misread
  otherwise: the access log's, in the organisation's reporting zone ("4 Nov
  2026, 2:18 PM GMT"), Ask usage's UTC day ("since midnight UTC, to 2:32 PM
  UTC") and the baseline's report window. Relative times ("2 h ago") carry
  the absolute time in a tooltip. Weekly series are labelled "week of 2 Nov"
  with weeks starting on Monday; never ISO week numbers, which US readers don't
  use. Numbers follow the browser locale through `Intl`, with en-GB as the
  fallback. UI copy avoids words spelt differently in US and UK English where
  it can; where it can't, it uses UK spelling (the client is UK-based).
- **Retina and Safari:** rules are 0.5 px at 2× density (the hairline token),
  icons and charts are SVG only, `color-scheme` is set so native controls match
  the theme, and everything is checked in WebKit as well as Chromium. Print
  works on both A4 and US Letter: no fixed `@page` size, margins that suit
  both, and evidence tables that keep their header on every page.
- **People as Jira shows them:** a person is shown by the person object's
  name (the Jira display name) with their Jira picture beside it, as in Jira
  and Confluence, and findings can be grouped and filtered by person. The
  service fetches the pictures at sync and serves them itself; the browser
  gets them only from this dashboard's own route, by person id and version,
  never from Jira's picture address, which holds the account id (or, for
  Gravatar, a hash of the email address). Never an email address, a raw
  account id or Jira's picture URL, on screen or anywhere else. Worklogs stay
  totals. Ask names people only for an admin (and with sign-in off), which the
  oversight route decides on every question, never the browser; there it
  answers every question about people with figures next to the whole board's,
  never insults or labels anyone, and leaves the decision to the admin, and
  everyone else's Ask stays at team level. (The product owner's decisions of
  10 Nov 2026, JO-05 and JO-06, replacing "team and process level only", of
  11 Nov 2026, replacing "names only, never an avatar" and "Ask stays at team
  level", and of 11 Nov 2026, JO-11, replacing "never a judgement" with
  scorecards for admins.)
- **The avatar** (`PersonAvatar`, `src/components/ui/person-avatar.tsx`; the
  look in `components.css`, `.jo-avatar`): round, 20 px in tables, menus,
  chart rows and lines of text (the drawer, the ticket page), 48 px heading a
  person card (the initials at `--t-xl`), 24 px in Ask's
  @ list and beside the name that heads a scorecard, its width and height set so nothing shifts while a picture loads.
  The picture when the service holds one; otherwise, or when it fails to
  load, the initials (the first letters of the first and last words, "?" for
  an Unnamed account) in `--text-mid`, weight 600, on the pressed ground
  (`--paper-250`): micro size (10.5 px) in the 24 px round and micro less
  2 px (8.5 px) in the 20 px round, so two wide letters (MW, WW) clear the
  edge where the round is narrowest across their capitals. Nobody
  (Unassigned) is the same ground with a generic figure in `--text-low`, so
  the names in a list stay in line. A hairline edge in `--rule` keeps a pale
  picture round on the sheet. Always decorative: `aria-hidden` and `alt=""`,
  beside the name, never in its place; the initials are drawn by the
  stylesheet, so copied text and screen readers get the name alone. Light and
  dark from the tokens, an edge in forced colours, and it prints as it shows.
  `PersonName` pairs it with the name. Where the name is a link (the ticket
  page's assignee), only the name is underlined on hover, never the avatar.
  The picture heading a person card is 48 px, the size of the picture Jira
  gives (the only size the service fetches and keeps), so it is shown at its
  source's size: on a Retina screen it is exactly doubled, where the brief's
  56 px stretched it 2.33 times and left it visibly softer than the name
  beside it (the product owner's decision, 13 Nov 2026; how pictures are
  fetched is unchanged). It is the one picture shown above this section's
  24 px bar for a Retina-sharp picture: sharper still would need a larger
  copy from Jira. Its initials, at `--t-xl` (21 px), keep the 24 px round's
  proportion (micro, 10.5 px).
- **The @ list and mentions in Ask** (`question-box.tsx`, `mention-menu.tsx`,
  `answer-prose.tsx` in `src/components/ask/`): the list opens against the
  question box, just below the question's text (above it without room), on the
  kit's floating surface, `min(20rem, 100vw - 2rem)` wide and never past the
  box: it starts 12 px in from the box's edge and ends at least 12 px in from
  the other. It lists everyone
  Jira lets you assign the board's tickets to (`GET /people/directory`), in
  two groups of one listbox, each a `group` named by its heading: "With
  tickets" (assigned one of the board's tickets now), then "No tickets" (the
  board's members who hold none). A heading is the menu's group label: micro
  caps in `--text-low`, 28 px tall, its text in line with the avatars; the
  second group opens on a hairline in `--rule-weak`. A search filters both
  groups as one list, and a group it empties goes, heading and all; the
  keyboard runs through both groups as one list. Compact 32 px rows, each a
  24 px avatar and the name, cut short with the whole name in its tooltip;
  the highlighted row is a ground change (`--paper-200`) that follows the
  keyboard and the pointer, never the accent. The list is about the first
  heading and eight rows tall (18.5rem, less where the room is less), fitted
  after layout so its clipped edge always cuts a row in half, the half row
  saying there is more, never the gap between the groups or a heading; when
  the "No tickets" heading and half its first row lie just past that (up to
  21.5rem), it grows to show them, so both groups are seen at once. Past
  that it scrolls, the listbox itself the scroller, 4 px inside the menu's
  edge. Whichever edge it can still scroll towards takes the kit's fade
  (`ScrollArea`) and a hairline in `--rule` along the clipped edge (the fade
  alone shows nothing where the clip falls in white space), both shown and
  hidden at once (no transition), as macOS hides the scrollbar. A row the
  keyboard scrolls to stops clear of the fade (24 px of scroll padding), the
  first row of a group brings its heading into view with it, and the first
  and last rows take the list all the way to its end. A new search starts
  the list at its top, on its first row; the pointer never scrolls it.
  It opens and closes with the kit's pop, still with reduced motion. While the
  board's people load it shows three rows in their final shape; if they fail,
  one line and Try again, which Enter in the field does too (the list says
  so), the loading rows showing while it tries; when no one matches, it says
  so ("No people on this board yet." when the board lists no one at all), and
  a search with a space that finds no one closes, so the list never sits over
  plain words. A person who cannot be added (an eleventh mention, or
  a name with no room left in the 500 characters) gets the kit's warning, so
  the refusal is seen as well as heard. The question box is a small editor
  (`question-editor.tsx`: contenteditable, drawn from the model in
  `draft.ts`), a multi-line `textbox` driving the listbox through
  `aria-controls` and `aria-activedescendant`. The person chosen stands in the
  question where the @ was, as a chip: a 20 px avatar and the name on the
  `--paper-200` pill, as the answer marks them, on the text's baseline and
  shorter than its line, never split across lines (a long name cut short at
  14rem, the whole name in its card). A chip is one piece: one Backspace
  just after it (or Delete just before it) removes it whole, an arrow steps
  over it in one press, and its text cannot be edited; inside a selection the
  whole pill takes the selection colour. A press on a chip opens the person's
  card (below) anchored to it, as Jira's editor does for a mention, and moves
  nothing in the question: not the caret, not a selection, not a character
  (Shift and a press still reach a selection to its nearer side). Escape,
  the card's close button or a press on the chip again closes it and gives
  focus back to the field with the caret just after the chip; a press in the
  text closes it and puts the caret where the press was. Resting on a chip
  opens the card too, and the pill takes the `--paper-250` ground while the
  pointer is on it and while its card is open; nothing typed ever opens a
  card, even with the pointer resting where a chip is drawn (it waits for the
  pointer to move). A screen reader reads it as the name in the sentence. The
  question is sent with each chip written "@Name", and the chips' people
  (each once, in order, ten at most) go with it by id; the address, the
  session, ↑, "Ask again" and "Try again" rebuild the chips from the text and
  the ids. A copy is plain text with "@Name"; a paste or drop is plain text
  only and never makes a chip. There is no line of mentions under the
  question. The placeholder is drawn in `--text-low` behind the empty field
  (`aria-placeholder` for screen readers), the field grows to six lines and
  then scrolls with the caret's whole 24 px line in view (a new empty line
  included), and a team-level reader gets the same field with no @ list. A
  question brought back (↑, the address, history) gets every chip it was
  sent with: the same person twice, and a chip with a letter typed against it.
  Undo and redo (⌘Z, ⇧⌘Z; Ctrl+Z, Ctrl+Y) are the box's own. An input
  method's composition is left to the browser and read back when it ends.
  The hint line under the field keeps each hint whole on one line, in
  order of what matters most: "↵ to ask", "@ mention someone", "⇧↵ new
  line", "↑ last question". A hint the line has no room for wraps whole
  onto a second row that is never shown, so the last steps aside first,
  whatever the keyboard's key names (Windows' are wider than a Mac's
  glyphs), and "@ mention someone" stays wherever the box shows, the
  character counter beside it or not. On a phone it is the only hint: Enter
  and Shift are no on-screen keyboard's (every hint is in the line's
  screen-reader text). In an answer, each person the response
  lists is marked where their name stands: a 20 px avatar and the name on a
  `--paper-200` pill (`--paper-250` on hover and while its card is open)
  that shares the sentence's baseline and is shorter than its line, and
  opens the person's card (below), which leads on to their open findings.
  Asked about members with no tickets, the answer (outcome "No data") is the
  service's one sentence, "Noor Haddad has no tickets on this board.", set as
  an answer and marked the same way, then one line on how to pick someone
  else and the suggestions; the ledger says nothing was read. When others
  mentioned hold tickets, their answer ends with that sentence as a paragraph
  of its own. The people that sentence names get the same pill, whose card
  says they hold no tickets here and offers no findings (an empty page), and
  the footer
  names no writer: the service built the sentence in code, with no model and
  no script ("scripted" is the sample's and the stub's).
- **The person card** (`src/components/person-card/`, JO-13; contract 4.19):
  for people level alone, as Atlassian's profile card, but about the work.
  Wherever a person is named at people level (Ask's chips, pills, facts and
  everyone-in-order table; Findings' Assignee column, Person filter and
  drawer; the Overview's open findings by person; the People table and the
  scorecard's heading; the ticket page's assignee; the access log's people),
  resting on the name or the picture for 350 ms opens the card. It stays
  while the pointer is on the name or the card, or on its way between them,
  curves and all: leaving the name (or the card) draws the way, the smallest
  convex shape holding the whole name, the whole card and the side the
  pointer left by, 96 px either side of where it left (`grace.ts`). A hand's
  path that bows on its way to the card's foot stays on it, and one that
  leaves by a side facing away from the card is off it at once. The way is
  read from where the pointer crossed the edge it left by, and drawn once the
  card stands beside the name, so a browser that reports a hand only every
  150 px or so (WebKit under load) keeps the card as surely (JO-14). On the
  straight ways from where it left to the card (its lane) no other name the
  pointer crosses opens its card; elsewhere on the way a name it rests on
  opens its own card after 350 ms, as anywhere, once the pointer has been
  reported at a second place on it: a pointer passing over a name is
  reported on it once, however long the next report takes, and one that
  stops at its first report there opens that name's card when its journey
  ends. The card closes 150 ms after
  the pointer leaves all three, or after it has stood still on the way for
  half a second (resting on another name there opens that name's card
  next). A
  press (Enter, Space) pins it, a non-modal dialog with focus inside and a
  close button; Escape, a press on the name again or a press on the page
  closes it and gives focus back to the name. In a pinned card Tab and
  Shift+Tab are the card's own, the same in every browser (Safari's Tab
  passes over links elsewhere): through its controls in order, links
  included; Shift+Tab from the card itself or its first control closes it
  and gives focus back to the name; Tab past its last control closes it and
  moves on to whatever follows the name on the page, as if the card stood
  right after the name. A question box chip is pressed for its card as a
  name is (above), focus going back to the box. On the access log's pills
  the press on the name is the filter's, and the picture at the pill's start
  is the card's own button (Enter, Space, a click or a tap). In the Person
  filter and on the ticket page's assignee (a link to their open findings)
  the press stays the control's and the card is the pointer's alone (on
  Findings the same card is a key or a tap away in the Assignee column and
  the drawer). One card at a time. Presses and keys inside a card stay
  there: the row, the field or the tooltip its name sits in never hears
  them. Backspace means nothing in a card, which holds no field, so a pinned
  card and the bottom sheet alike keep it from the browser: WebKit would take
  it for Back and leave the page, with an answer or a question being written
  on it. A name that opens a card looks as it always has, its name alone
  underlined on hover and while the card is open (never the picture), and
  has no tooltip of its own: the card says the whole name. On a touch
  screen or a phone the same card is a bottom sheet (`Sheet` with
  `side="bottom"`: the screen's width up to 40rem, centred, a grab handle,
  the 48 px picture beside the title, Close with no Esc key cap (a touch
  screen has no key to name), the ways on a bar of 44 px cells; its
  body scrolls between the header and the bar, so on a short screen (a
  phone held sideways, Safari's toolbars showing) nothing runs under the
  bar or off the screen; a toast steps aside as it rises, rather than cover
  it; closing it gives focus back to the name, given, since Safari focuses
  nothing on a tap). The card is 340 px wide on the raised ground
  (`--paper-150`, so it lifts off the sheet in dark too) with the pop shadow
  and the large radius. A header band on the rail's ground, 72 px at least
  (the picture and 12 px above and below it, so a one-line name and its line
  sit centred on the picture; a two-line name grows it): the 48 px
  picture (the initials at `--t-xl` where there is none) with a 2 px ring of
  the sheet, the name in 17 px semibold, wrapping, never cut, and one plain
  line in 12 px ("Holds 13 open tickets on Demo project", the count in Plex
  Mono, the board by its name as the top bar names it, its key in the
  tooltip). Then, 16 px in and 12 px apart: three figures in one ruled frame,
  as the Overview's tiles (Open, In progress, Done in 90 days; 21 px Plex
  Mono, a nought in `--text-low`), the third a little wider so its period is
  said whole; "Open findings on all their tickets" in micro caps (they are the
  open findings on every ticket the person holds, done ones too, as Findings
  filtered to them lists them, so they can outnumber the open tickets; the
  label says so where everyone sees it, the tooltip in full) over the
  breaches and warnings with their severity marks; "Process, last 90 days"
  in micro caps over the scorecard's sentence on two lines ("Closer to the
  process than the board / on 5 of 8 measures.", the figures in Plex Mono),
  a 6 px bar of closer, level, further and too few tickets in the neutral
  inks (`--text-hi`, `--text-low`, `--text-dim`, and `--chart-too-few`, the
  quietest: `--rule` on paper, `--rule-strong` on slate, where `--rule` all
  but vanishes on the raised ground), 2 px apart, and its key with each
  count; "Working on now" in micro caps with the last activity at its
  right, over a framed list exactly as tall as its rows, divided by
  hairlines, each its key in the accent (traceable: it opens the ticket),
  its status on the neutral badge, how long in progress at the right, and
  its summary on one line (how long, measured to now, on the last
  activity's clock; once the board's last sync is older than the top bar's
  two hours, the heading reads "In progress at last sync", the sync's time
  in its tooltip, and how long is measured to the sync); "and 4 more" in the accent at the section's foot
  (Ask's list of everything they work on); the other boards they hold open
  tickets on (keys in Plex Mono, in the accent where the top bar can open
  them), as many as fit whole on the one line, then "+2 more", which the
  tooltip and a screen reader name in full (nothing cut short, nothing out
  of sight that a key could reach). A frame (the tiles, the list; a `--rule`
  hairline, a step firmer than a frame on the sheet, as the card stands on
  the raised ground; `--rule-weak` inside it, the medium radius) holds what
  is there and nothing more: a section keeps its room, so the card is one
  size from its first frame, and the room a short list leaves is plain
  card. Where a section has nothing to show (nothing compared, nothing in
  progress) it says so in one muted line at the top of its room, unframed.
  The ways on are a ruled bar across the foot on the rail's ground, three
  cells divided by hairlines, each as wide as its words with the room left
  shared out: View scorecard, Open findings, Ask about Ada, never cut short
  (only a long first name wraps the third). A way on that would lead
  nowhere is drawn in its place in `--text-low`, saying why in its tooltip:
  a member's Open findings, and all three for a person not on the board (or
  a board the service does not serve). The band and the bar are plain
  blocks, not a banner and a content-information landmark: the card is part
  of a page that has its own. A card read on another board than the top
  bar's (an access log entry's) is about that board throughout: its
  picture, its figures and every link, which picks that board before it
  opens (a whole page load, as the Portfolio's links; a new tab or window
  opens on it, the page staying as it is). Every part has a fixed height
  and the loading state stands in the same places, so nothing moves when
  the figures arrive; a card that could not be read says why in the body's
  room (Try again where trying can help) and leaves the line under the name
  empty, never a placeholder still loading. The card fades in as it rises
  4 px in 120 ms, and simply appears with reduced motion. Placed below the
  name, or above it, where the whole card fits, else beside it, its top
  level with the name's (moved up only as far as it must), never past the
  window's edge. It scrolls on its own, keeping the wheel, only while the
  window is too short for it; otherwise a wheel over it moves the page. A
  reader at team level gets names as before, with no card.
- **No third-party requests at runtime:** fonts are self-hosted, no analytics,
  no CDNs. Strict security headers. Secrets live only in server route handlers;
  nothing secret is ever `NEXT_PUBLIC_`.
- **Sample data is always labelled** as sample data, uses the project key
  `DEMO`, and never imitates real tickets or real people: its people are
  fictional names, and the two of them with a picture have an abstract
  pattern drawn in code, never a photograph.

## 10. Quality gates

`npm run build`, `npm run lint`, `npm run typecheck` and `npm test` are clean;
Playwright end-to-end tests pass in **both Chromium and WebKit** with zero
serious or critical axe violations; `npm run shots` captures every page and
every state in light and dark under `shots/` at 1440×900 and 1512×982 with a
device scale factor of 2 (what a MacBook shows), plus 1728×1117 for the
Overview. A page isn't done until someone has looked at its screenshots.

## 11. Chart palette (validated)

The chart colours live in `src/styles/charts.css`: light on `:root`, dark
redefined under `prefers-color-scheme: dark` and again under
`[data-theme="dark"]`, like every other token. Components use them by role
through `src/components/charts/palette.ts` (`seriesColour(slot)`,
`stageColour(stage)`, `STATUS_COLOURS`, `MEASURE_COLOURS`), in SVG attributes
and inline styles, or as `bg-(--series-1)` in a class. They are plain custom
properties rather than `@theme` utilities: `globals.css` imports `charts.css`
before its `--color-*: initial` reset, which would wipe a theme block declared
there (checked with Tailwind's own compiler).

Every value was validated with the dataviz skill's `validate_palette.js`
against the surface the charts are drawn on, the sheet: `#ffffff` on paper and
`#12181f` on slate. Change a value only by re-running the checks below in both
modes and updating this section.

### Categorical: identity (epics, series)

| Slot | Hue | Paper | Slate | Note |
|---|---|---|---|---|
| 1 | blue | `#5674be` | `#6a89d5` | |
| 2 | olive | `#78822b` | `#8a943f` | |
| 3 | plum | `#7c3d70` | `#98578b` | |
| 4 | sand | `#b29e4c` | `#a79341` | 2.66:1 on paper, so from four series the lines are labelled directly, and every chart has its table view |
| 5 | violet | `#8c6ebd` | `#9e80d1` | |
| 6 | sepia | `#85491a` | `#a16336` | |
| Other | warm grey | `#8c877d` | `#6b7682` | context, and the folded tail past six |

- Assigned in this order, by entity: an epic keeps its slot when a filter
  hides its neighbours, and survivors are never repainted. Never cycled; a
  seventh series is "Other".
- Lines, bars and stacks (adjacent pairs) carry up to six. Forms where any two
  marks can meet (scatter, small multiples) carry three: only the first three
  slots clear the all-pairs gates. From four series, lines are labelled at
  their ends as well as in the legend.
- The accent `--cite` is never a series, and the series keep off the reserved
  status hues (clay, amber, green) and the teal.
- **Near-equal lightness, measured.** The brief asked for near-equal luminance,
  like Ask the System's service palette (L 0.55 to 0.58). On slate it holds
  (L 0.55 to 0.66). On paper the slots span L 0.46 to 0.70, deliberately. With
  green, teal, amber and clay reserved, an order search at a lightness spread
  of 0.08 found no palette that clears the gates, and at 0.10 to 0.12 the
  only passing sets were four purples and two warm hues. Pulling sand and
  sepia to the middle lightness puts them on top of the warning amber and the
  breach clay (ΔE about 8). The lighter sand and the darker plum and sepia
  are what keep series and status apart.

### Ordinal: James's stages

One hue (266°) stepped in process order. On paper the ramp runs pale to deep;
on slate it turns round, dim to bright, so a later stage always has more
contrast against its ground.

| Stage | Paper | Slate |
|---|---|---|
| backlog | `#a7b5d6` | `#374973` |
| estimate | `#8fa2cc` | `#43598e` |
| development | `#798fc1` | `#516aa7` |
| code_review | `#637cb6` | `#617cbd` |
| dev_signoff | `#4f69a8` | `#728fd1` |
| testing | `#3d5798` | `#87a2df` |
| test_review | `#2e4682` | `#9fb6eb` |
| test_signoff | `#22366a` | `#b8caf2` |
| done | `#162653` | `#d1def9` |

Percentiles in range bars reuse three steps of the ramp, the median the
strongest: paper `testing` / `development` / `backlog`, slate `test_review` /
`code_review` / `estimate`.

### Status inside charts

Breach and resolved marks are the interface's own `--breach` and `--ok`. A
warning segment sits beside a breach segment in a stack, and the interface
amber (`#a86f14`) measures ΔE 11.3 there in normal vision, under the floor of
15, so on paper charts step warning lighter: `--chart-warn` `#bf851e`, ΔE
16.4, 3.19:1 on the sheet. On slate the interface amber already clears every
gate beside the clay and is used as it is. Status marks always ship with their
shape (square, triangle, tick) and a word or a count; their labels use the
`-ink` text steps, never the mark colour.

### Chrome and texture

Gridlines `--rule-weak`, axis `--rule-strong`, tick text `--text-low` in Plex
Mono, crosshair `--text-dim`, the now line `--text-mid`; solid hairlines, never
dashed. The only dashed line is a rule's threshold, in its status colour and
named. A meter's track is the fill's own hue set back (series 1 at 14% on
paper, 22% on slate). A neutral meter's quietest part (the person card's too
few tickets to compare) is `--chart-too-few`: `--rule` on paper, a step up to
`--rule-strong` on slate, where `--rule` all but vanishes on the raised
ground. Not measurable is the hatch, never a colour.

### Validator reports

Paper, sheet `#ffffff`:

```text
$ node validate_palette.js "#5674be,#78822b,#7c3d70,#b29e4c,#8c6ebd,#85491a" --mode light --surface "#ffffff"
Palette (light, surface #ffffff, categorical): 6 slots
  [PASS] Lightness band         all 6 inside L 0.43–0.77
  [PASS] Chroma floor           all 6 >= 0.1
  [PASS] CVD separation         worst adjacent #7c3d70↔#78822b ΔE 18.6 (deutan) · tritan 10.1
  [PASS] Normal-vision floor    worst adjacent #78822b↔#5674be ΔE 22.3 (normal)
  [WARN] Contrast vs surface    below 3:1 — relief required (visible labels or table view): [["#b29e4c",2.66]]
  → ALL CHECKS PASS

$ node validate_palette.js "#5674be,#78822b,#7c3d70" --mode light --surface "#ffffff" --pairs all
  [PASS] CVD separation         worst all-pairs #7c3d70↔#5674be ΔE 13.1 (deutan) · tritan 10.1
  [PASS] Normal-vision floor    worst all-pairs #7c3d70↔#5674be ΔE 17.2 (normal)
  [PASS] Contrast vs surface    all 3 >= 3:1
  → ALL CHECKS PASS

$ node validate_palette.js "#a7b5d6,#8fa2cc,#798fc1,#637cb6,#4f69a8,#3d5798,#2e4682,#22366a,#162653" --ordinal --mode light --surface "#ffffff"
  [PASS] Lightness monotone     steps read light→dark
  [PASS] Adjacent ΔL            all gaps >= 0.06
  [PASS] Light-end contrast     #a7b5d6 at 2.05:1 vs surface
  [PASS] Single hue             hue spread 2°
  → ALL CHECKS PASS

$ node validate_palette.js "#a2565c,#bf851e" --mode light --surface "#ffffff"
  [PASS] CVD separation         worst adjacent #bf851e↔#a2565c ΔE 15.0 (deutan) · tritan 11.7
  [PASS] Normal-vision floor    worst adjacent #bf851e↔#a2565c ΔE 16.4 (normal)
  [PASS] Contrast vs surface    all 2 >= 3:1
  → ALL CHECKS PASS   (with the interface amber #a86f14 instead: normal-vision ΔE 11.3, FAIL)
```

Slate, sheet `#12181f`:

```text
$ node validate_palette.js "#6a89d5,#8a943f,#98578b,#a79341,#9e80d1,#a16336" --mode dark --surface "#12181f"
Palette (dark, surface #12181f, categorical): 6 slots
  [PASS] Lightness band         all 6 inside L 0.48–0.67
  [PASS] Chroma floor           all 6 >= 0.1
  [PASS] CVD separation         worst adjacent #98578b↔#8a943f ΔE 16.7 (deutan) · tritan 5.9
  [PASS] Normal-vision floor    worst adjacent #a16336↔#9e80d1 ΔE 21.2 (normal)
  [PASS] Contrast vs surface    all 6 >= 3:1
  → ALL CHECKS PASS

$ node validate_palette.js "#6a89d5,#8a943f,#98578b" --mode dark --surface "#12181f" --pairs all
  [PASS] CVD separation         worst all-pairs #98578b↔#6a89d5 ΔE 11.6 (deutan) · tritan 10.0
  [PASS] Normal-vision floor    worst all-pairs #98578b↔#6a89d5 ΔE 15.8 (normal)
  [PASS] Contrast vs surface    all 3 >= 3:1
  → ALL CHECKS PASS

$ node validate_palette.js "#374973,#43598e,#516aa7,#617cbd,#728fd1,#87a2df,#9fb6eb,#b8caf2,#d1def9" --ordinal --mode dark --surface "#12181f"
  [PASS] Lightness monotone     steps read light→dark
  [PASS] Adjacent ΔL            all gaps >= 0.06
  [PASS] Light-end contrast     #374973 at 2.01:1 vs surface
  [PASS] Single hue             hue spread 1°
  → ALL CHECKS PASS

$ node validate_palette.js "#e06c75,#d9a441" --mode dark --surface "#12181f"
  [PASS] CVD separation         worst adjacent #d9a441↔#e06c75 ΔE 11.0 (deutan) · tritan 11.4
  [PASS] Normal-vision floor    worst adjacent #d9a441↔#e06c75 ΔE 16.4 (normal)
  [PASS] Contrast vs surface    all 2 >= 3:1
  (Lightness band reports L 0.67 and 0.75: that band governs series, not the
  reserved status marks, which on slate also serve as text.)
```

The one WARN, sand at 2.66:1 on paper, is legal only with relief, and it has
both kinds: lines are labelled directly from four series, and every chart has
its table view.
