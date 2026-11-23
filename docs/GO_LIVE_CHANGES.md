# Go-live changes: plain words and less clutter (JO-19)

Every removal and every page whose copy changed, one line of reason each, so anything can be reviewed or restored.
The standard: short, plain, concrete. A page purpose is about 10 words, an empty state is a line and the action, a
tooltip is a few words, and nothing explains or praises itself.

## Removed

| What | Why |
|---|---|
| The `/design` component showcase (`src/app/design/**`) | A developer page. It must not exist in a production build. |
| "How it was checked" copy on every Ask answer ("Every number verified against the facts") | Shortened to "Numbers verified". The check itself is unchanged. |
| The "Counted by the oversight service from its own records..." note on Usage | It only explained where the numbers come from. |
| The time and zone name on Usage "Today" | A UTC time read as a local one is misleading, and zone names are not shown. |
| "Evidence configured for this report" line on Baseline | A developer detail that repeats the evidence list above it. |
| Time zone names on screen: Baseline window ("in Europe/London time"), Access log ("Times in ...", "Period, in ...", "GMT"), "UTC" on Usage and Issue | The UI never shows a zone name. Times stay in AM/PM. |
| The "ticket 4" and "ground truth" search keywords on Baseline | Prototype wording. |
| The `/design` links in `docs/PAGES_GUIDE.md` | The page no longer exists. |
| Baseline: "Comparison with the reference audit" table, the "Reference audit" card, its CSV export and the "Check again" button on an empty board (SQA) | A proof-of-concept check against an old audit ("ticket 4"); the export only exported it; a sync never writes a baseline, so "Check again" could not help. |
| Baseline: run id and process version under "Generated", "Logged time, counted three ways", the time-tracking app's share and "Largest single account" (SQA) | Developer and audit detail; each figure is still shown once. |
| Insights: "How this was written" (model name, rules and process versions), the "Verified" badge, the score formula on each problem, and the sentence and word counts (SQA) | Developer and self-praising detail. The number check is unchanged: an unverified briefing still says so. |
| Overview: the "Rules not measurable" tile, the "Every figure checked" badge, people with nothing open in "Open findings by person", and four empty trend charts on a board with no finished work (one line instead) (SQA) | A figure that never moves and is said twice elsewhere; self-praise; rows that inform no one. |
| Ask: the model's name, the time taken, the answer reference and its copy button, "Numbers verified", the raw call names and SQL in the sources panel (SQA) | Developer internals. The number check is unchanged. |
| Process: the Version column and the box that listed the not-measurable steps a second time (SQA) | Every rule carried the same version; the steps are marked in the process strip. |
| Issue page: the column of Jira's changelog ids (SQA) | A number no reader looks up; the CSV keeps it. |
| Data source popover: "API version" (SQA) | Developer detail. |
| Command palette: "Every figure traces back to Jira" (SQA) | Self-praise. |
| Access log: views of the log itself, unless picked under Action (SQA) | Each load added one; they filled the first page. |

## Pages whose copy changed

| Page | What changed | Why |
|---|---|---|
| Every page header (`src/lib/nav.ts`) | Purpose lines cut to about 10 words | The standard above. |
| Sign-in and No access | Failure notices and refusals cut to one or two short lines; the "only reads Jira" line and all titles kept | Plain words. |
| Overview | Section descriptions, empty states, tile links and tooltips shortened | Plain words. |
| Findings and the finding drawer | Empty, error and not-found lines shortened | Plain words. |
| People and scorecard | Page note, measure definitions and empty states shortened | Plain words. |
| Ask | Start note, outcomes, ledger lines, toasts and the people-picker error shortened | Plain words. |
| Insights | "How this was written" steps, the not-verified notice, empty state and ranking note shortened | No self-explaining text. |
| Process | Section descriptions, not-measurable notes and empty states shortened | Plain words. |
| Baseline | Every section description, empty state and report flag shortened | Plain words. |
| Portfolio | Section description, empty states and tooltips shortened | Plain words. |
| Access log | Empty states, export message and summary line shortened; zone names removed | Plain words; no zone names. |
| Usage | Budget lines, section descriptions and empty state shortened; footnote removed | Plain words. |
| Rule settings | Group descriptions, history, review dialog and conflict messages shortened; "Hard and fast rules" heading kept | Plain words. |
| Issue page | Not-found, empty states, axis note and worklog notes shortened | Plain words. |
| Every error state | "Nothing in Jira has changed; only this page failed to load. Trying again fetches it afresh." became "Try again." | Self-explaining. |
| Page error, global error, 404 | Shortened | Plain words. |
| Site description (page metadata) | "Read-only oversight of delivery work in Jira." | Removes the "rules decide, AI explains" slogan. |
| Top bar Sync button (SQA) | Named "Sync <board>"; the sync time is its description. A press that never reaches the service says "Couldn't reach the service. Try again." and Sync shows "Sync failed" until a press gets through | A short name; no HTTP codes on screen. |
| Top bar (SQA) | A page's rail group no longer shows before its name; on a phone the board's key shows instead | One pattern on every board; a phone says which board. |
| Insights and Overview's latest insight (SQA) | Tones read "Serious", "Getting worse", "For information"; "Ranked candidates" is "Top problems"; a briefing from a week that is over says "From an earlier week. Figures may have changed since."; the page purpose is "The latest weekly briefing." | Plain, professional words; an old briefing is never passed off as this week's. |
| Ask (SQA) | "Facts ledger" is "Sources"; the footer says only the outcome and when; the hint is "Point at a figure to see its source."; the "Answer ready" toast adds nothing for an answer | Plain words. |
| Portfolio (SQA) | One summary line (the table says only its order); a sprint with no risk finding reads "No risk flagged", not "On track" | No repeats; the rule cannot vouch for a sprint. |
| Findings (SQA) | The rule's title gets its own line; the table fits a MacBook Air at 1280 px; on a phone the findings are a list | Readable without scrolling sideways. |
| Rule settings (SQA) | Percentile thresholds read "Longer in the status than 90% of finished work"; "No changes yet" said once; times date first; toasts name the board | Plain words; one date pattern. |
| Access log (SQA) | Times in the reader's own zone, as everywhere else | An unlabelled time in another zone read hours off. |
| Usage (SQA) | "AI tokens used" replaces model calls, input and output tokens; "Today" says when it resets, in the reader's time | Plain words; the day's end is clear. |
| Process (SQA) | "Rule catalogue" is "Rules"; the not-measurable box names only the rules that cannot run | Plain words; said once. |
| Data source popover (SQA) | "Board" for "Projects"; one short line for each mode | Plain words. |
| 404 (SQA) | Icon in its box; the tab reads "Page not found" | It stood empty; the title said nothing. |
| First-sync failure (SQA) | The service's words alone, else "The last sync didn't finish. Try again in a few minutes." | Said once. |
| Sample data (SQA) | Percentile thresholds in plain words; the hot-spot note shortened | As the service is asked to word them. |

## Backend text

| Where | What changed | Why |
|---|---|---|
| Ask: answer writing instructions (team answers, people answers, analyst) | Lead with the answer, no preamble, praise, restating, closing offer or boilerplate caveat; 80 words at most | Short, plain answers. Every number check is unchanged. |
| Weekly Insights: writing instructions | One short sentence per candidate, 120 words at most, no preamble or summary | Short, plain briefing. The number check is unchanged. |
| Ask messages sent to the screen | "Not verified", "not understood", "not measurable", "no data" messages shortened | Plain words. |
| Weekly Insights empty briefing | "Nothing stood out this week." | Plain words. |

## Not changed yet

The top bar, Sync button, command palette and data source popover were done in the SQA pass (above). Still as they
were: the scorecard caveat sentence in `src/lib/api/schemas.ts`, and the sentences the backend and the sample share
word for word (the team-level decline, "Comparing people side by side is turned off..."). Changing those means
changing the backend's copy in the same release, so they wait for a joint pass.
