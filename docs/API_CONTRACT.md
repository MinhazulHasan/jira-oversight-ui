# Jira Oversight: dashboard API contract

The JSON the oversight dashboard API (FastAPI, `oversight/api/app.py`, port 3300)
serves, and what the interface does with it. Written for the Python team: implement
`create_app()` against this document and the interface works unchanged in live mode.

| | |
|---|---|
| Contract version | `api_version` 0.1.0, `rules_version` 0.1.0, `process_version` 0.1.0 |
| Source of truth | `src/lib/api/schemas.ts` (zod). This document describes it; when they differ, the schema wins and this document is fixed. |
| Query parameters | `src/lib/api/params.ts` |
| Tested by | `src/server/__tests__/` (every sample response round-trips through its schema unchanged) |
| Full example bodies | `docs/sample-responses/*.json`, captured from a running interface in sample mode |

---

## 1. The shape of it

- **Base path** `/api/v1` on the dashboard API, for example `http://127.0.0.1:3300/api/v1/overview`.
- **Authentication.** Every request carries `X-Service-Key: <API_SERVICE_KEY>`. The interface's
  server holds the key (`OVERSIGHT_SERVICE_KEY`); browsers never see it and never call the API.
  Compare in constant time; answer 401 when the key is missing or wrong. Beside the key, the interface names
  the reader on every request: `X-Oversight-Viewer` and `X-Oversight-Viewer-Name` (4.16), for the service's
  access log; never an email address or an account id.
- **Read-only over Jira.** Nineteen `GET` endpoints and five `POST`s: `/ask`, which reads and writes only its own
  audit rows; (JO-15) a board's rule settings, previewed (`/rules/settings/preview`, which writes nothing) and
  saved (`/rules/settings`, which writes only the service's own settings tables and re-runs the rules); (JO-20) an
  AI draft of a rule (`/rules/settings/draft`, which writes only its model calls' audit rows); and (JO-18)
  `/refresh`, which syncs one board into the service's snapshot, reading Jira only; and one `PUT`, a board's credit
  setting (`/people/credit`, 4.29, which writes only the service's own setting). Three more `POST`s
  set findings aside (4.26, 4.27): an ignore's preview, which writes nothing, and the ignore and the restore, which
  write only the service's own ignores and resolve or re-check the board's findings. Nothing here can change Jira.
- **JSON, UTF-8**, with `Cache-Control: no-store`. Every field the contract names is always present: a
  value that is unknown or does not apply is `null`, never left out. Fields the contract does not name are
  ignored (the interface strips them before they reach a page), so adding one is safe and removing one is not.
  The one answer that is not JSON is a person's picture (4.13): image bytes, cached privately.
- **Every response carries `meta`** (section 3), the picture excepted.

| Method | Path | Answers |
|---|---|---|
| GET | `/health` | Is the service up, what it serves, when it last synced |
| GET | `/overview` | Headline figures, hot spots, findings by rule, coverage, trend cards, where work sits, the latest briefing's first lines |
| GET | `/findings` | One page of findings, filtered and sorted, with facet counts |
| GET | `/findings/{finding_id}` | One finding with its issue's status timeline |
| GET | `/findings/ignored` | People level only: the board's standing ignores, a page at a time (4.28) |
| POST | `/findings/ignore/preview` | People level only: what ignoring findings would do now, writing nothing (4.26) |
| POST | `/findings/ignore` | People level only: ignores findings, one rule on a ticket or every rule on it, without changing a rule (4.26) |
| POST | `/findings/restore` | People level only: removes ignores, then re-checks the board's findings (4.27) |
| GET | `/issues/{key}/timeline` | One issue: facts, status intervals, skipped stages, changelog, weekly worklog totals, findings |
| POST | `/ask` | A question (and the people it mentions) in; answer, citations, facts, outcome and the people it names out |
| GET | `/insights/latest` | The latest weekly briefing and the candidates it was written from |
| GET | `/trends` | A weekly series for one metric |
| GET | `/rules` | The rule catalogue as the board runs it (every rule, on or off, and the board's own rules after it) and the process map |
| GET | `/rules/settings` | People level only: one board's rule settings over the catalogue, its own rules, the checks a new rule may use, whether its findings reflect them, and every change to them (4.20) |
| POST | `/rules/settings/preview` | People level only: what changes to the board's rule settings (its own rules added, edited and deleted among them) would do to its open findings, without writing anything (4.21) |
| POST | `/rules/settings` | People level only: saves changes to the board's rule settings, then re-checks its findings (4.22) |
| POST | `/rules/settings/draft` | People level only: an AI draft of a new rule from an admin's words, built only from the board's checks and names; saves nothing (4.23) |
| GET | `/baseline/latest` | The latest ground-truth baseline report |
| GET | `/people` | Who has the board's tickets (the credit rule, 4.29), with their open tickets, and the open findings on the tickets each is assigned now |
| GET | `/people/directory` | Everyone on the board (assignees, and the members Jira lets you assign its tickets to), with their tickets (the credit rule, 4.29): Ask's @ list |
| GET | `/people/scorecard` | People level only: how each person's tickets are handled next to the whole board, over 30, 90 or 180 days (4.15) |
| GET | `/people/credit` | People level only: whom the board's tickets count for, and each choice's coverage over 30, 90 or 180 days (4.29) |
| PUT | `/people/credit` | People level only: changes whom the board's tickets count for, from the revision read (4.29) |
| GET | `/people/{person_id}/avatar` | A person's Jira picture, as the service fetched and keeps it: image bytes |
| GET | `/people/{person_id}/card` | People level only: one person's card, their work, findings and process on the board next to its figures, what they work on now and the other boards they hold open tickets on (4.19) |
| GET | `/access-log` | People level only: who viewed whose person-level figures, and when, a page at a time (4.16) |
| GET | `/usage` | People level only: Ask's questions, model calls and tokens today and over 7 days, against the daily AI budget (4.17) |
| GET | `/portfolio` | Every synced board at a glance, with the Overview's figures for each, the oldest open breaches across them, and how many boards have not synced yet (4.18) |
| GET | `/refresh` | The sync of one board: queued, running, or how it last ended (4.24) |
| POST | `/refresh` | Syncs one board (reading Jira only), queued behind another board's sync while one runs (4.24) |

## 2. Conventions

**Times.** Timestamps are ISO 8601 in UTC with `Z`, milliseconds optional:
`"2026-11-04T14:28:00.000Z"`. An offset (`+00:00`) is accepted so a Python `isoformat()` slip
is not an outage, but send `Z`. Calendar days are `YYYY-MM-DD`.

**Weeks** start on Monday at 00:00 UTC, oldest first, and a series ends with the current week to date.
The only exception is the weekly briefing's `week_of`, which is the Monday in the report zone (`meta.report_timezone`).

**Boards.** The service serves every Jira board (a Jira project, a "space" in Jira Cloud's words) its Jira
account can browse, which it discovers itself (JO-17), and every board in its `JIRA_PROJECTS`, one per request.
Every endpoint takes an optional `?project=KEY` (any case); without it the first board in `JIRA_PROJECTS` is
served, and a key the service does not serve is a 404 with the code `unknown_board`. A board it serves that has
never synced has nothing to read yet: every board-scoped endpoint answers it 409 with the code
`board_not_synced` (section 5), except its sync (4.24) and the endpoints that belong to no one board. `meta.projects` (and `projects` in health) names the board that
was served. The interface keeps the board picked in the top bar in the `jo-board` cookie and adds
`project` to every request it forwards, except `GET /projects`. See 4.11.

**Keys and ids.**

| Value | Pattern | Example |
|---|---|---|
| Issue key | `^[A-Z][A-Z0-9_]{1,19}-[1-9]\d{0,8}$` | `DEMO-142` |
| Project key | `^[A-Z][A-Z0-9_]{1,19}$` | `DEMO` |
| Rule id | `^[RW]-[A-Z]+-\d{2,3}$`: the catalogue's (rules.yaml), and (JO-20) a board's own, `R-CUS-nn` for a breach rule and `W-CUS-nn` for a warning, numbered across every board and never reused, three digits from 100 on | `R-EFF-01`, `W-CUS-07` |
| Finding id | `^[0-9a-f]{32}$`: the first 32 hex characters of sha256 of rule id, rule version, issue key and evidence key joined by U+001F (`rules/engine.py`) | `0b7b3b0f61c477e61699982f24892735` |
| Ask id (`qa_id`) | `^[0-9a-f]{32}$` (uuid4 hex) | |
| Fact reference | `^F\d+$`, in plan order | `F1` |
| Person id | `^p[0-9a-f]{12}$`: `p` and the first 12 hex characters of sha256 of the Jira account id (UTF-8). Stable across runs; never the account id. The hash is one way but unsalted, so it is not a secret: anyone who already knows an account id (any signed-in user of the Jira site can find them) can work out its person id | `p3f9a2c41b0de` |
| Picture version (`avatar`) | `^[0-9a-f]{12}$`: the first 12 hex characters of sha256 of the bytes of the picture the service holds for a person. A version, never an address: it changes exactly when the picture does | `55ea1804e5bd` |

**Numbers.**

| Kind | Sent as | Shown as |
|---|---|---|
| count | integer | `1,136` |
| hours | calendar hours, a float (4 decimals is plenty) | `12.5 h` |
| ratio | a float: logged hours over estimated hours | `1.42×` |
| share | a fraction from 0 to 1, `null` when the whole is 0 | `16%` |
| points | story points | `5` |
| days | a float | `1.9 days` |

Where a bare number needs to say which it is, it travels with a `unit` from this list:
`count`, `hours`, `ratio`, `share`, `points`, `days`.

**Scope.** "Work" means every issue type except Epic (rules.yaml `defaults.exclude_types`). A figure
that counts Epics says so.

**People.** A response names a person only as a **person** object,
`{"id": person id, "name": string, "avatar": picture version | null}`, and every response that sends a
person sends all three fields. `name` is the account's Jira display name as of the last sync, trimmed, 1 to
128 characters (Unicode characters, as Python's `len` counts them, not UTF-16 units), and
`"Unnamed account"` when Jira gave none, or gave a name with an email address in it (`x@y.z`; some invited
or partly set-up accounts have one), so an address never reaches a page by way of a name. `avatar` is the version of
the person's Jira picture, which the service fetched at sync, keeps, and serves itself by person id (4.13);
`null` when it holds none. The interface shows the picture beside the name, as Jira and Confluence do
(the product owner's decision of 11 Nov 2026, which replaced "names only, never an avatar"), and the
person's initials when there is none. Jira's own picture addresses never leave the service: they hold the
raw account id, or for Gravatar an MD5 hash of the email address. Nothing else about anyone is ever sent:
no email address, no picture address (`avatarUrls`, or any Atlassian or Gravatar URL), no raw account id
(`accountId`), no assignee's time zone (`timeZone`). The one zone sent is the organisation's report zone,
`meta.report_timezone` (section 3): a setting, never the syncing account's zone. The interface drops any
other field of a person object before it reaches a page. Where a person goes and nobody is assigned, the value is `null`; as a filter or facet
value that is `"unassigned"`, labelled `"Unassigned"`. Lists of people go by name, case-insensitive
(compared lower-cased, character by character), then by id. Assignee changes in a changelog still read
`Assigned` or `Unassigned`; worklogs are totals; the account that logs time is reported as a share, never
an id (Planning.md principle 8). Ask names people only at people level, which this interface's server
decides on every question: an admin, or anyone with sign-in off; everyone else's Ask stays at team level,
its facts and answers naming no one (4.6, the product owner's decision of 11 Nov 2026). At people level
nothing about people is declined (JO-11): Ask names them, counts and ranks their tickets and findings, and
answers a question that evaluates someone with their figures next to the whole board's (4.15); it never
insults or labels anyone, and the decision about a person stays the admin's. The weekly insights and the
daily digest stay team level.

## 3. `meta`: on every response

| Field | Type | Meaning |
|---|---|---|
| `data_mode` | `"sample"` \| `"live"` | The service always sends `"live"`. `"sample"` is the interface's bundled DEMO project. |
| `last_synced_at` | timestamp | Start of the last successful Jira sync. Every figure is as of this moment. On the responses that belong to no one board (4.16 to 4.18) it is the latest of every board's, and null until the first board has synced. |
| `projects` | project key[] (at least one) | Projects in scope |
| `rules_version` | string | The rule catalogue version the findings were produced under (rules.yaml's; a board's rule settings never change it, JO-15) |
| `process_version` | string | `config/process.yaml` version |
| `generated_at` | timestamp | When this response was computed |
| `report_timezone` | IANA zone | The organisation's reporting time zone: the service's `REPORT_TIMEZONE` setting, UTC when unset. Report days are cut in it. Never read from a Jira profile |

## 4. Endpoints

### 4.1 `GET /health`

Polled every minute by the interface's shell (the data-source pill, "Last synced", the print header).
Keep it cheap. No parameters. For a board that has never synced (JO-17) the service may answer either way: 200
with `last_synced_at: null` (and `meta` with no sync time, or none), or 409 `board_not_synced`; for the latter the
interface asks for the service's health without a board and answers it with the board's key in `projects` and
`last_synced_at: null`, so the shell says the board has not synced yet, never that the service is down. The
browser always sees the first form.

| Field | Type | Meaning |
|---|---|---|
| `meta` | meta | As everywhere. The interface tolerates its absence here only. |
| `status` | `"ok"` \| `"degraded"` | Degraded: serving, but something needs attention (for example the last sync failed) |
| `message` | string \| null | Why it is degraded, in plain words; `null` when ok |
| `data_mode` | `"sample"` \| `"live"` | As `meta.data_mode` |
| `read_only` | `true` | Always `true`. Anything else fails validation. |
| `api_version` | string | This contract's version, `"0.1.0"` |
| `last_synced_at` | timestamp \| null | As `meta.last_synced_at`. The interface shows it, and calls data older than 2 hours stale. `null` for a board that has never synced: the top bar says "Not synced yet" |
| `projects` | project key[] | As `meta.projects` |
| `report_timezone` | IANA zone | As `meta.report_timezone` |

### 4.2 `GET /overview`

The Overview page's first screen. No parameters.

| Field | Type | Meaning |
|---|---|---|
| `meta` | meta | |
| `totals` | object of six window totals | See below |
| `hot_spots` | hot spot[] (at most 5) | Epics ranked by open breaches, then open warnings, then epic key |
| `by_rule` | rule summary[] | Every rule the board runs, in catalogue order, measurable or not (JO-15: a rule turned off in the board's rule settings is left out) |
| `coverage` | object of five coverage entries | `estimate`, `story_points`, `time_logged`, `code_review`, `test_evidence` |
| `trend_cards` | object of four trend cards | `median_cycle_time_h`, `median_effort_ratio`, `skipped_stage_share`, `reopen_rate` |
| `status_mix` | status count[] | Where work sits now |
| `latest_insight` | teaser \| null | The latest briefing's first two sentences; `null` before the first briefing |
| `tracking_since` | timestamp \| null, optional | When the rules first saw the project (the earliest finding's `first_seen_at`). When it falls after the previous window's end, the findings tiles show "Tracking since …" instead of a week-on-week change, since every finding would otherwise read as new |

**Window total** (each entry of `totals`). Rolling 7-day windows that end now, so a tile's sparkline
and its delta always agree:

| Field | Type | Meaning |
|---|---|---|
| `current` | count | The window ending now (= the last point of `series`) |
| `previous` | count | The window before it (= the second-to-last point) |
| `series` | `{end_at: timestamp, value: count}[]`, 2 to 12, oldest first | Windows ending at now, now − 7 days, … |

| Total | Each window's value |
|---|---|
| `open_breaches` | Breach findings open at `end_at`: first seen at or before it, not resolved by then |
| `open_warnings` | The same for warning findings |
| `new_7d` | Findings first seen in the 7 days ending at `end_at` (both edges included) |
| `resolved_7d` | Findings resolved in the 7 days ending at `end_at` |
| `issues_in_scope` | Work (Epics left out) created at or before `end_at` |
| `rules_not_measurable` | Rules whose evidence Jira does not hold |

**Hot spot.**

| Field | Type | Meaning |
|---|---|---|
| `epic_key` | issue key \| null | `null` groups findings with no epic: work outside every epic, and sprint findings |
| `epic_title` | string | The epic's summary; `"(no epic)"` for the null group |
| `open_breaches`, `open_warnings` | count | Open findings of each severity in the group |
| `issues` | count | Distinct issues with at least one open finding |
| `series` | trend point[] (12 weeks) | Open findings (both severities) at the end of each week; the last point equals `open_breaches + open_warnings` |

A hot spot must click through exactly: `/findings?state=open&epic=<epic_key or none>` lists the same findings.

**Rule summary.** `rule_id`, `title`, `severity` (`breach` \| `warning`), `kind` (`rule` \| `warning`),
`open` (count of open findings), `measurable` (boolean), `missing_evidence` (string[]: evidence sources
and workflow stages the project lacks, in process order, for example `["code_review", "testing"]`;
empty when measurable).

Note that `kind` and `severity` are independent: R-EST-02 and R-FLOW-03 are rules (`kind: "rule"`)
reported as warnings (`severity: "warning"`), as rules.yaml sets them.

**Coverage entry.** Over work created in the last 90 days (Epics left out), as `oversight_coverage` counts it:

| Field | Type | Meaning |
|---|---|---|
| `covered` | count \| null | Issues that have it; `null` when Jira holds no evidence to count |
| `total` | count | Issues counted over |
| `share` | share \| null | `covered / total`; `null` when not measurable or nothing was counted |
| `measurable` | boolean | `false` for `code_review` and `test_evidence` while process.yaml has no source for them |
| `note` | string | What was counted, over which issues, in plain words |

`estimate` follows the project's estimate basis (story points for DEMO and AIL), so it equals `story_points` there.

**Trend card.** `metric`, `label`, `unit`, `current` (the last point's value), `previous` (the one before),
`direction_good` (`"up"` \| `"down"`: which way is better, so a delta can be called good or bad), and
`points` (12 trend points). The points equal `GET /trends?metric=<metric>&last_n=12`.

**Status count.** `status`, `stage` (James's stage, or null if unmapped), `status_category`
(`new` \| `indeterminate` \| `done`), `count` (work in that status now). The counts add up to
`totals.issues_in_scope.current`.

**Teaser.** `week_of` (date), `generated_at` (timestamp), `verified` (boolean), `sentences` (the first
two insight sentences, section 4.7).

### 4.3 `GET /findings`

One page of findings, with facet counts for the filter menus.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `rule` | rule id, repeatable | all | Any of these rules |
| `severity` | `breach` \| `warning` | both | |
| `state` | `open` \| `resolved` \| `ignored` \| `all` | `open` | `ignored`: the findings an admin set aside (4.26). `resolved` leaves them out; `all` takes them in |
| `epic` | issue key or `none`, repeatable | all | Any of these epics; `none` is findings with no epic (work outside every epic, and sprint findings) |
| `person` | person id or `unassigned`, repeatable, at most 50 | all | Any of these people: findings whose issue is assigned to that person **now** (the page says "assigned now": a finding follows its ticket's current assignee, whatever the board's credit setting says of finished work, 4.29); `unassigned` is issue findings whose issue nobody is assigned to. With any `person` given, sprint findings never match (they belong to no one), nor do findings whose issue is no longer in the snapshot (see `assignee`). An id nobody on the board has matches nothing: an empty page, not an error, and so does a member of the board who holds none of its tickets (4.14) |
| `q` | string, at most 100 characters | none | An exact key (`DEMO-142`, any case), a bare number (`142` or `#142`, matched against the key's number), or words found in the key, the summary or the sprint's name, any case |
| `first_seen` | `7d` \| `30d` \| `90d` \| `all` | `all` | First seen in the last 7, 30 or 90 days, counted back from now |
| `ticket` | `open` \| `finished` | any | Findings on open tickets (not done) or on finished ones (done), by the ticket's status category now. A sprint's finding is on no ticket and never matches |
| `sort` | `first_seen_at` \| `last_seen_at` \| `resolved_at` \| `severity` \| `rule_id` \| `issue_key` \| `epic_key` | `first_seen_at` | `severity` puts breach above warning; key columns sort by issue number |
| `order` | `asc` \| `desc` | `desc` | Empty values (an open finding's `resolved_at`, a sprint finding's keys) sort last in either order. Ties: newest first, then `finding_id`. |
| `page` | integer ≥ 1 | 1 | A page past the end is an empty page, not an error |
| `page_size` | 1 to 100 | 25 | |

The interface refuses (400) unknown parameter names, a single-valued parameter given twice, and values
out of range (a `person` that is not an id or `unassigned`, in exactly that case, among them), and it
forwards only the canonical form: defaults left out, lists de-duplicated and sorted. It adds `level` (`team` |
`people`, the level it decided for the reader) to every read: the service names who ignored a finding at the people
level alone, and when `person` names someone (an id, not only `unassigned`) it records the read in its access log as
`person_findings_view` (4.16). The reads of one finding and of an issue (4.4, 4.5) carry `level` too.

| Field | Type | Meaning |
|---|---|---|
| `meta` | meta | |
| `items` | finding[] | This page |
| `total` | count | Findings matching every filter |
| `page`, `page_size` | integers | As requested |
| `facets.rules` | facet entry[] | Every rule in catalogue order |
| `facets.epics` | facet entry[] | Every epic by key, then `{"value": "none", "label": "No epic"}` |
| `facets.people` | facet entry[] | Everyone assigned at least one ticket on the board now (any status or type) as `{value: person id, label: name, count, avatar: picture version \| null}` (the person object's `avatar`, so the Person menu can show their picture), by name (section 2), then `{"value": "unassigned", "label": "Unassigned", "count": …, "avatar": null}` last, always. Issue findings on the board's tickets only, so the counts add up to `total` less its sprint findings (and any finding whose issue is no longer in the snapshot) |
| `facets.severity` | facet entry[] | `breach`, `warning` |
| `facets.state` | facet entry[] | `open`, `resolved`, `ignored` |

A **facet entry** is `{value, label, count}`; a people facet entry adds `avatar`, `null` for
`"unassigned"`. The other facets are unchanged. Each facet's counts apply every filter except its own,
so a menu shows what each choice would give. Entries are listed even at count 0, in a fixed order, so
menus never reshuffle.

**Finding.**

| Field | Type | Meaning |
|---|---|---|
| `finding_id` | finding id | Stable across runs (section 2) |
| `rule_id`, `rule_title`, `rule_version` | | The rule and the version it fired under: the catalogue's (`0.1.0`), or `0.1.0+breach` where the board's settings report the rule at another severity than the catalogue's (JO-15, 4.22) |
| `kind` | `rule` \| `warning` | From the catalogue |
| `severity` | `breach` \| `warning` | What it is reported as |
| `state` | `open` \| `resolved` \| `ignored` | `open` exactly when `resolved_at` is null; `ignored` exactly when `resolved_why` is `ignored` |
| `message` | string | Short, team level, names nobody: `"Logged 18.0 h against an estimate of 8.0 h (2.25×, threshold 1.5×)"` |
| `scope` | `issue` \| `sprint` | W-SPR-01 looks at a sprint; every other rule at an issue |
| `issue_key` | issue key \| null | Set exactly when `scope` is `issue` |
| `issue_summary`, `issue_type` | string \| null | The issue's, for issue findings |
| `epic_key`, `epic_title` | issue key \| null, string \| null | The issue's epic (a subtask's epic is its parent's) |
| `assignee` | person \| null | The issue's assignee **now**, not when the rule fired; `null` when nobody is assigned, and for every sprint finding. Also `null` for a finding whose issue is no longer in the snapshot (deleted or moved in Jira since the rules last ran, which leaves it open until a run resolves it): like a sprint finding it belongs to no one, so no `person` value matches it, `unassigned` included, and `/people` counts it for nobody. Such a finding keeps its `issue_key` but has `issue_summary` and `issue_type` null (Jira gives every live ticket a type), which is how the interface tells it from an unassigned ticket's: it reads "No one: the ticket is no longer in the synced data", never "Unassigned" |
| `sprint` | `{sprint_id: integer, name: string}` \| null | Set exactly when `scope` is `sprint` |
| `first_seen_at` | timestamp | The rules run that first saw it |
| `last_seen_at` | timestamp | The last run that still saw it |
| `resolved_at` | timestamp \| null | The first run that no longer saw it |
| `resolved_why` | `cleared` \| `superseded` \| `settings_changed` \| `ignored` \| null | Why it is resolved; null while open. `ignored` (4.26): an admin set it aside, so it is neither open nor fixed and no open, resolved, fixed or new figure counts it; the interface says "Ignored" with who, when and why wherever it is shown. `cleared`: the condition stopped. `superseded`: a newer rules version replaced it (a catalogue bump, or the board's severity for the rule changed). `settings_changed` (JO-15): the board's rule settings changed (a threshold moved, the rule was turned off) and the rule no longer holds it; never counted as fixed (the digest's "resolved" lists `cleared` alone), and the interface says "Closed: rule settings changed" wherever a resolution is shown (the Findings table's narrow State column shows "Closed" over "settings changed", with the whole sentence in its tooltip and to a screen reader) |
| `threshold` | string \| null | The rule's threshold on the board as a reader says it: `"1.5×"`, `"p90 of To Do: 524.8 h"` |
| `evidence` | evidence item[] | Why it fired (below) |
| `warned_before` | object \| null | "Warned on X, breached on Y": `{warning_rule_id, warning_finding_id, warned_at}` from `warning_links` |
| `ignore` | ignore \| null | The ignore that holds it (4.26): `{scope, rule_id, reason, by, at}`, `scope` `finding` (one rule on the ticket, `rule_id` its rule) or `ticket` (every rule, `rule_id` null), `reason` the admin's words or null, `by` who ignored it by the name the access log keeps (null below the people level; never an email address), `at` when. `ignore_id` beside them names the ignore, which Restore takes; where it is left out the interface looks the ignore up (4.28). Null for a finding no ignore holds, and between a restore and its re-check |

The engine stores sprint findings under `issue_key = "sprint:<id>"`. The API turns that into
`scope: "sprint"`, `issue_key: null` and the `sprint` object.

**Evidence item.**

| Field | Type | Meaning |
|---|---|---|
| `kind` | `status_change` \| `field_change` \| `metric` \| `sprint` | |
| `label` | string | `"Work started"`, `"Story points set"`, `"Effort ratio"` |
| `value` | string \| number \| null | A number to format by `unit`, a text value (`"To Do → In Progress"`), or null for none |
| `unit` | unit \| null | How to read a number |
| `from`, `to` | string \| null | For changes: the value before and after |
| `at` | timestamp \| null | When it happened in Jira, for events |
| `changelog_id` | string \| null | The Jira changelog entry, for changes |

### 4.4 `GET /findings/{finding_id}`

The evidence drawer. 404 when no finding has that id.

| Field | Type | Meaning |
|---|---|---|
| `meta` | meta | |
| `finding` | finding | Identical to the same finding in `/findings`, `assignee` and `ignore` included (who ignored it named at the people level alone: the interface sends `level`) |
| `timeline` | interval[] | The issue's status intervals, oldest first; empty for a sprint finding |

**Interval.** `status`, `stage` (or null), `status_category`, `entered_at`, `left_at` (null while still
in it), `hours` (calendar hours, null while still in it).

### 4.5 `GET /issues/{key}/timeline`

The Issue page. The key is upper-cased before it is looked up (`demo-12` means `DEMO-12`). 404 when the
issue is not in the synced data.

| Field | Type | Meaning |
|---|---|---|
| `meta` | meta | |
| `issue` | object | Below |
| `intervals` | interval[] | Every status the issue sat in, oldest first |
| `skipped` | `{changelog_id, changed_at, from, to, skipped: stage[]}`[] | Forward jumps over mapped stages (`metrics.skipped_stages`) |
| `changes` | `{changelog_id, changed_at, kind: "status" \| "field", field, from, to}`[] | Status and tracked-field changes, oldest first. `field` is `status`, `story_points`, `original_estimate`, `sprint` or `assignee`; assignee values read `Assigned` / `Unassigned`, never a person. |
| `worklogs` | `{week: date (Monday, UTC), hours}`[] | Logged hours per week, totals only, oldest first |
| `findings` | finding[] | Every finding about the issue: open first, then newest first, each with its `ignore` (4.3) |

`issue`:

| Field | Type | Meaning |
|---|---|---|
| `key`, `summary`, `type`, `status`, `status_category`, `stage` | | |
| `epic` | `{key, title}` \| null | |
| `assignee` | person \| null | Who it is assigned to now; `null` when nobody is. The `changes` list still reads only `Assigned` / `Unassigned` |
| `created_at`, `resolved_at` | timestamp, timestamp \| null | |
| `story_points` | number \| null | |
| `time_spent_h` | hours \| null | Logged time; null when nothing is logged |
| `estimate_basis` | `points` \| `hours` \| `none` | What the estimate is, if there is one |
| `estimate_set_at` | timestamp \| null | When the estimate was first set (`metrics.estimate_set_at`) |
| `started_at` | timestamp \| null | First entry into development or later |
| `effort_ratio` | ratio \| null | `time_spent_h` over the estimate in hours; null without an estimate |
| `effort_threshold` | number | R-EFF-01's threshold (1.5), to draw the ratio against |
| `cycle_time_h` | hours \| null | Start of development to Done |
| `reopen_count` | count | |
| `url` | https URL \| null | Send `null`. The interface fills it from `OVERSIGHT_JIRA_BASE_URL` (`<base>/browse/<key>`), so the service never decides where a click goes. |

### 4.6 `POST /ask`

The Ask page (Planning.md Phase 6). The interface refuses bodies over 2,000 characters; the service declines
questions over 500 characters (`ASK_MAX_LENGTH`) as `not_understood` without planning, and a blank one the
same way.

**Request, browser to interface:** `{"question": "<text>", "mentions"?: [person id]}` and nothing else (any
other key, `level` included, is 400 `bad_request`). `mentions` are the people picked from the Ask box's @
list (the chips in the question, each written `@Name` in `question`): person ids (`^p[0-9a-f]{12}$`), each
once, in the order they first appear, at most 10. The browser never says how far Ask may go.

**The level, decided by the interface on every question.** `"people"` when sign-in is off or the
signed-in reader is an admin (everyone who signs in, unless `ACCESS_MODE` is `admin-list`: then the addresses on
`ADMIN_EMAILS`, read as they are now, as for the boards in section 5);
`"team"` for everyone else. A team-level reader's question that carries any mention is refused with 403
`people_not_allowed` before the service is asked anything. The page offers @ only to people-level readers,
from the same check made on the server.

**Request, interface to service:** `{"question": str, "level": "team" | "people", "mentions": [person id]}`.
`level` defaults to `"team"` and `mentions` to `[]`. The service answers 422 to mentions that are more than
10, repeated, or not person ids, and to any mention at team level. A mention of someone who is not on the
board at all (neither a current assignee of one of its tickets nor a member from its last successful member
fetch, 4.14) is `not_understood` with the message exactly
`Someone you mentioned has no tickets on this board.`, and no model is asked.

**Mentions of people with no tickets (JO-10).** Someone on the board none of whose tickets count for them (a
member, or someone the credit setting does not name, 4.29) may be mentioned (the @ list's "No tickets" group, 4.14). At people level, checked right after the unknown-mention
check above and before anything else (a judgement included):

- **Every mention has no tickets:** no model is asked and nothing is planned. `outcome` `no_data`;
  `answer` exactly the sentence below, built in code; `message` `null` (the answer says it, and names stay
  in `answer`); `facts`, `plan` and `citations` `[]`; `people` those people, in mention order. The sentence:
  one name, `<Name> has no tickets on this board.`; two, `<A> and <B> have no tickets on this board.`; three
  or more, `<A>, <B> and <C> have no tickets on this board.` (no comma before the "and"). The names are the
  people's display names, in mention order (`noTicketsSentence()` in `src/lib/api/schemas.ts`).
- **Some mentions have tickets:** the question is answered as ever, about the people with tickets only; the
  answer then ends with one more paragraph (`\n\n`, then the same sentence for the rest, in mention
  order). `people` names everyone the answer names, in the order of first appearance.
  The name and figure checks pass the sentence: its names are mentions, and it has no figures.
- **Team level** is unchanged: any mention is refused before the service is asked (403 `people_not_allowed`),
  and the service declines a question about a person in its words below.

| Field | Type | Meaning |
|---|---|---|
| `meta` | meta | |
| `qa_id` | 32 hex | The `qa_log` row, which records the level and the mention ids (ids only, never names) |
| `question` | string | As asked, trimmed: the reader's own words, `@Name` and all |
| `outcome` | `answered` \| `not_understood` \| `no_data` \| `not_measurable` \| `not_verified` | |
| `answer` | string \| null | Markdown without citation markers: paragraphs, `-` bullet lists, bold, tables (no links, images or HTML; the interface links every cited issue key itself). The catalogue path writes plain prose, which is valid Markdown. Set only when `answered`, and for the `no_data` that says mentioned people have no tickets (exactly that sentence; see above). |
| `citations` | citation[] | Empty unless `answered` |
| `facts` | fact set[] | What the catalogue calls returned (kept for `no_data` and `not_verified`) |
| `plan` | `{tool, params}`[] | The catalogue calls, in order |
| `missing_evidence` | string[] | For `not_measurable`: the evidence Jira lacks (`["code_review"]`) |
| `message` | string \| null | What happened, for every outcome but `answered` |
| `suggestions` | string[] | Questions that can be answered (always for `not_understood`) |
| `latency_ms` | count | The whole request |
| `model` | string \| null | The model that wrote the answer; `null` when none was asked |
| `asked_at` | timestamp | |
| `people` | person[] | The people the answer names, each verified (below), in the order the answer first names them; for the `no_data` about mentioned people with no tickets, those people in mention order. `[]` at team level and whenever the answer names no one. The page marks each where their name stands: their picture and name on a neutral pill, leading to their open findings (for the people of the no-tickets sentence, the same pill with no link: they have no findings) |
| `note` | string | null | A line the page shows under the answer in the muted note style (JO-12). Today only `Today's AI budget is used up, so this answer was built without the AI model.`, when the day's AI budget (4.17) was used up and the answer was built in code; null otherwise. A service that predates it sends nothing, which reads as null |

What each outcome carries:

| Outcome | `answer` | `citations` | `facts` | `plan` | `message` |
|---|---|---|---|---|---|
| `answered` | prose | every number, key and date in it | yes | yes | null |
| `not_understood` | null | [] | [] | [] | why, plus `suggestions` |
| `no_data` | null | [] | the calls' empty results | yes | what was looked at |
| `no_data`, mentioned people with no tickets | the sentence | [] | [] | [] | null |
| `not_measurable` | null | [] | [] | yes | which evidence is missing and why that is itself a finding |
| `not_verified` | null | [] | yes | yes | "The written answer could not be verified against the facts, so only the facts are shown." |

**Team level** (`level: "team"`) is as it always was: the facts and the answer name no one, and `people` is
`[]`. A question about a person is `not_understood` with the message exactly
`Ask answers at team level. To see one person's findings, use the Person filter on Findings.` A question is
about a person when it carries an @ or names anyone on the board in its own words: a ticket holder or a member
who holds none, in any case, with or without accents. At people level such a question with no mention (one
that neither ranks the board nor judges anyone) gets the pointer to the ranking and to @, never the whole
board's figures. The interface passes on a team-level answer only when its `people` is empty (otherwise 502
`upstream_invalid`).

**People level** (`level: "people"`). The analyst's views gain exactly this: `issues` the `assignee_id`
(person id, or NULL) and `assignee` (the display name by the person rules of section 2, NULL when
unassigned); `findings`, and any view built on issue findings, the `assignee_id` and `assignee` of the
issue's current assignee (NULL for unassigned issues and for sprint findings); and a `people` view with
`GET /people`'s figures (4.12) as Ask reads them: one row per person with tickets on the board (the work that
counts for them, by the board's credit setting, 4.29), plus an Unassigned row (`person_id` NULL, name
`Unassigned`) for the tickets that count for no one, columns `person_id, name, tickets, open_tickets,
open_breaches, open_warnings, tickets_with_findings` (a person's tickets, open or finished, are the board's work
that counts for them, Epics left out, as everywhere: JO-12; their findings are the open findings on those tickets,
where `GET /people`'s stay with the assignee). Every person tool reads a person's tickets the same way (the
board's credit setting): their open tickets, those in progress, those done, and their findings. Never a raw
account id, an email address, a picture or its address, a time zone, the reporter, creator or any other person
field, a name in the changelog (assignee changes stay `Assigned` / `Unassigned`), or a worklog's author. The model
is told the mentioned people by name and person id, and filters by person id. It names people only by their
display name as the data gives it: it may rank by a count (most open breaches, say), and then says that a
person's findings are those on their tickets. A ranking ranks people only: the Unassigned row is never ranked,
and its figure is said after the ranking in one sentence, `Unassigned: <n> open tickets.` (the figure ranked).

**Nothing is declined at people level (JO-11, the product owner's direction of 11 Nov 2026).** A question that
evaluates someone (how they are doing, whether they follow the process, best, worst, rank, top, slowest...) is
answered with figures next to the whole board's (4.15), through two more person tools, offered at people level
only and never by the MCP server:

- `oversight_person_scorecard(project, person_ids 1..10, days=90)`: one row per person asked about and measure,
  `{person_id, name, measure, label, kind, value, numerator, denominator, shown, enough, vs_board, board_value,
  board_numerator, board_denominator, board_shown, measurable, reason, rule_ids}` (`shown` the figure as the page
  writes it, "72% · 18 of 25"). One mention: their scorecard; two to ten: side by side.
- `oversight_people_compare(project, measure, days?, order, n?)`, only while comparison is on: everyone with
  tickets, in the order the question asks, too few tickets last whatever the order, by one measure (rows as above
  with `standing`, then the board's row, `person_id` null, name `Whole board`) or `overall` (`{person_id, name,
  closer, further, level, compared, too_few, open_findings_per_10, open_findings, open_tickets, enough,
  standing}`: the measures on which each is closer to the process than the board, ties by open findings per 10
  open tickets, a figure on too few tickets counting as the most (it is never compared); `open_findings` and
  `open_tickets` are that ratio's numerator and denominator, `enough` whether it rests on at least 5; `standing`
  `Too few tickets` for someone compared on no measure; no board row), or by a count, `open_tickets`,
  `in_progress` or `done_in_period` (whose backlog is biggest, who has the most in progress, who finished the
  most; ties by name; `standing` null; then, when the board has work that counts for no one, one row for it, `person_id`
  null, name `Unassigned`, never ranked; then the board's row, always the last). **The order (JO-14, the product
  owner's decision of 13 Nov 2026: answer exactly what was asked)** is one parameter, `order`, accepted for every
  measure: `"most"` the figure highest first (most, highest, largest, biggest, top N, more, higher, and close
  paraphrases), `"fewest"` lowest first (fewest, least, lowest, smallest, bottom N, fewer, less, lower), and
  `"closer"`, the default, closer to the process first (a question with no direction word: rank everyone, who
  follows the process best, who is best). A count has no closer side, so `"closer"` is most first there; overall,
  the most measures closer is the closer order itself, and `"fewest"` its exact reverse (the fewest measures closer
  first, ties by open findings per 10 open tickets highest first), people compared on no measure still last. The
  fact set's `params` always carry the order used (a count's `"closer"` recorded as `"most"`, overall's `"most"` as
  `"closer"`), and so does `plan` wherever Ask plans in code (the catalogue's router, a question that evaluates
  people; the sample always); the page's plan line, read from the facts, says it in the answer's words: a rate or
  the ratio `highest first`, `lowest first` or `closer to the process first`; a count, JO-09's ranking by one and
  the overall number of measures closer `most first` or `fewest first` (overall's default, `closer to the process
  first`). A question that names a rate the other way round turns its order: "who overruns the most?" and "who has
  the highest effort ratio?" are `within_estimate` lowest first, "who has the most work without an estimate?" and
  "who has the most unestimated work?" `estimated_before_start` lowest first. A question about the other side of
  the process (worst, worse, weakest, poorest, slowest, struggling, falling behind, needs help, underperforming,
  trouble or problems with, mistakes, furthest from, deviating from, straying from or ignoring the process, not
  compliant) puts those further from it first: overall `"fewest"`, a rate or the ratio where lower is closer
  `"most"`, one where higher is closer `"fewest"`; with "the least", "less" or "fewest" ("who needs the least
  help?", "who struggles less?"), closer first; a negation before the word ("never needs help") is no such
  question. So "who is worst for reopened work?" is `reopened` highest first, "who is worst at estimating?"
  `estimated_before_start` lowest first, "who needs the most help?" overall fewest first. The answer still only
  reports the order: it never says worst. The tool's description, the analyst's prompt and the live planner's
  prompt say all of this, so a model plans these questions alike. `vs_board`, `standing`, the caveat and every
  figure are the same whatever the order. `open_tickets` and
  `in_progress` are counts of now: their call carries no `days`, and their answer states no period and has no
  caveat. `days` is 30, 90 (the default) or 180 otherwise. `n` (at most 50) only for a question's "top N",
  "bottom N", "highest N", "lowest N" or "which N people" ("the N developers", ...); without it, everyone. `person_ids` (two to ten, the people mentioned) sets only those people side by
  side, then the board's row, never the Unassigned row: "who has more in progress, @A or @B?", "who closed more
  this month, @A or @B?", "who has more reopened tickets, @A or @B?", and with a measure named whatever else the
  question says ("rank @A and @B by reopened tickets, highest first", "who is worse on reopened tickets, @A or
  @B?"; with no measure named, their scorecards). Never labelled "best". The answer's first
  sentence says the order it used in plain words, never calling the highest worst or the lowest best: by a rate or
  the ratio `Reopened after Done, last 90 days, highest first: ...`, `Open findings per 10 open tickets, lowest
  first: ...` or `Skipped a stage, last 90 days, closest to the process first: ...`; overall `Measures closer to
  the process than the board, last 90 days, most first: ...` (`fewest first`); by a count `Open tickets, most
  first: Ada Brooks 58, ... and Hana Mori 2. Unassigned: 148 open tickets. The whole board: 425.` (`fewest
  first`; the Unassigned sentence only when its count is above 0: `Unassigned: <n> open tickets.`, `... tickets in
  progress.`, `... tickets done.`, and `open ticket`, `ticket in progress`, `ticket done` for 1). A rate or the
  ratio of now (`stuck_now`, `open_findings_per_10`) states no period: `Open tickets stuck in a status, lowest
  first: ...`. The ratio is the comparison when the question names it as one ("open findings per 10 open
  tickets", "findings per ticket", "the findings rate"); findings named alone are `oversight_people`'s count.

**Each question with the figure it names (the JO-12 review).** Two to ten people mentioned are set side by side by
the figure the question names: a scorecard measure, read first (time logged, stuck, reopened, skipped a stage,
estimates, effort, code review: `oversight_people_compare` with that `measure`, the question's period and
`person_ids`, those people and then the whole board, so "the time they log on their done work" is time logged, not
work done; with comparison off, the comparison-off sentence); one person asked about such a measure gets their
scorecard (`oversight_person_scorecard`), never their tickets and findings; their open tickets, findings, warnings
or tickets with findings (`oversight_people` with `person_ids`, a raw count: `Ada Brooks has the most open tickets:
58, then Dev Malhotra with 49.`), what they
finished or have in progress (the comparison above with `person_ids`; for three people or fewer asked what they work
on, or with comparison off, each one's tickets), and their open breaches and warnings when the question names none of
these, or both. `oversight_people`'s `rank_by` also takes `open_findings` (open breaches and warnings together, a
column of its own: "who has the most findings?") and `tickets_with_findings` ("who has the most tickets with
findings?"). The qualifier or negation of a workload question decides its order: "at full capacity", "the least
bandwidth", "isn't available", "can't take on more", "flat out", "overworked" and "who has the most on" are the
busiest (open tickets, most first); "not overloaded", "the least loaded", "light on work", "spare time" have room
(fewest first, with the members who hold none); "not idle" has work in progress (most first). Logging time said in
hours, in either word order ("not logging hours", "booking their hours", "who logged the most hours?", "who has the
most hours logged?"), time tracked, recorded, booked or filled in ("do they track time?", "who records their time?")
and hours worked or spent ("who worked the most hours?") are the time-logged measure: hours are not added up per
person. A surname typed alone names its one
holder, or asks to pick with @ when two people share it. "How many open tickets are there?" counts the board's work
by status category, Epics left out (`oversight_count_issues` with `state`: `open`, `in_progress` or `done`), so it
equals the Portfolio's and the Overview's open tickets; the sample answers it alike.
- `oversight_board_people(project, holding)`: everyone on the board as the @ list shows them, `{person_id, name,
  tickets}`: those with its tickets (`tickets` every ticket that counts for them, any status, Epics left out), then
  the people on the board with none (`tickets` 0: its members, anyone the credit setting names on none of its work,
  and anyone assigned only Epics), each by name (`holding: "any"`); or only those (`holding: "none"`). The answer
  names each person once: `11 people are on this board: Ada Brooks, ... and Hana Mori, and 3 members who have none
  of its tickets: Noor Haddad, Tomás Ferreira and Yuki Tanabe.` (`1 member who has`; with no one with tickets, `{n}
  people are on this board, all members who have none of its tickets: {names}.`; with everyone with tickets, `{n}
  people are on this board: {names}.`).
- `oversight_ticket_assignee(project, issue_key)`: the ticket's row (`{issue_key, summary, issue_type, status,
  epic_key, assignee_id, assignee}`) and who holds it now (`Unassigned`, `assignee_id` null, when nobody does).
- `oversight_people` (JO-09's ranking) ranks people only, by the figure, most first or, with `order: "fewest"`,
  lowest first, ties by name (the directory's order, so a count gives one order whichever tool ranks by it); the
  tickets that count for no one come after them as one unranked row (`person_id` null, name `Unassigned`), and the
  answer says it after the ranking: `Ada Brooks has the most open tickets: 58, then Dev Malhotra with 49.
  Unassigned: 148 open tickets.` (the sentence only when its figure is above 0). A ranking by findings ends `A
  person's findings are those on their tickets.`
- `oversight_person_tickets(project, person, state, days?, n?)`: one person's tickets, the ones that count for them
  (`open`, `in_progress`, `done` over `days`, or `all`; Epics left out), each row with `assignee_id` and `assignee`
  (headed "Counts for") the person asked about.

A personnel question (fire, sack, let go, dismiss, lay off, demote, replace, promote, reward, a bonus or a pay rise,
an appraisal, deserve, blame, trust, lazy, attitude, competence, skill, reliability, and the labels an answer never
uses: useless, careless, dishonest, ...) gets the same figures, then `The figures are above; the decision is yours.`
"Compare", "versus" and "side by side" with two or more mentions set their scorecards side by side (with a count
named, "by open breaches", JO-09's raw counts). "Backlog", "to do", "open work" or a heavy load with one mention is
`oversight_person_tickets` (state open: the whole list, up to 200, Epics left out as the scorecard's Open tickets
leaves them out; the call carries no `days`); finished, done, closed or contributed work is state `done` over the
period (as "Done in the period" counts it). Who is struggling, needs help, is falling behind or is the MVP gets the
comparison. With no one mentioned, nothing about people is turned away (JO-12): finished work or work in progress
puts everyone in order by that count, a measure named (stuck, reopened, estimates, time logged, ...) is that
measure's comparison, an issue key is `oversight_ticket_assignee`; the biggest backlog, or who is overloaded, is the
comparison by `open_tickets` (the same figure as one person's backlog); who is idle (nothing in progress) is the
count of work in progress, fewest first, with `oversight_board_people` (`none`) beside it; who has no tickets is
`oversight_board_people` (`none`); who is on the board, or its members, is `oversight_board_people` (`any`). Every
comparison is in the order the question asks (above): the most, the highest or the top N, highest first; the
fewest, the least, the lowest or the bottom N, lowest first. A range's first word decides ("from most to least");
"top N", "bottom N", "at the top" and "at the bottom" decide only where no other direction word stands ("top 3
people with the fewest reopened tickets" is lowest first); a question that asks both ways ("the most reopened and
the fewest stuck") takes the word nearest the measure it is answered by; "at least", "at most", "most closely" and
"more closely" are none. A measure named is read before work done or in progress, whose words name the tickets a
rate is of: "who has the most tickets reopened after Done?", "who has the most time logged on done work?" and "who
has the most stuck tickets in progress?" are those rates. The busiest beside "top N" ("top 3 busiest people") is the
comparison by `open_tickets`, most first, that many. The last resort's overall comparison is closer first, unless
the question is about the other side of the process ("who makes the most mistakes?": further from it first). A
synonym table
reads how much work people have (`_SPARE`, `_BUSIEST` and `_DOING` in the service's `oversight/ask/router.py`):
the busiest, busy, the most work, working the most, the most on their plate, over capacity, is the comparison by
`open_tickets`, most first, and doing the most (do, does, doing, did; never "to do") adds the comparison by
`done_in_period` (the question's period, 90 days by default), most first; the least, doing or working the least,
underworked, capacity, bandwidth, could take (on) more, the lightest load, not busy, available, nothing to do, is
the comparison by `open_tickets`, fewest first, with `oversight_board_people` (`none`) beside it. Words that only
say how little ("the least work", "does the least", "the fewest tasks"), with no word of room itself, are the
figure a question names beside them (JO-14): "who reopens the least work?" is `reopened`, "who has the least work in
progress?" `in_progress`, "who finished the least work?" `done_in_period`, each fewest first; "who has capacity to
review code?" stays the open tickets. Any other
question about people that nothing places (cycle time by person, say) is answered with the overall
comparison (`measure: "overall"`, the question's period), the answer starting with the paragraph `This answer uses
the overall comparison: the number of measures on which each person is closer to the process than the whole
board.`; one that mentions people and that a model could not plan gets their scorecards, after `This answer uses
the scorecard: each measure next to the whole board's.` Only with comparison off is such a question still
`not_understood`, with exactly `There is no per-person figure for that here. Ask who follows the process most
closely or who has the most open breaches, or type @ to pick someone on the board.` A name typed where a person's
name stands (after is, was, has, does, did, how's, what's, for, of, about, by, from, with, show or me, or before a
possessive) that no one on the board goes by is `not_understood` with exactly `No one called {Name} is on this
board.` (the word as typed, with a capital), when nothing else made sense of the question and it asks something of
one person or types the word with a capital, not at a sentence's start; never a word of the service's `NOT_NAMES`
(`oversight/ask/people.py`), a word of anyone's name on the board, a word in capitals or one with a digit. A
person's full display name typed in the question (case and
accents folded) is that person, as if picked with @, when exactly one person on the board has it; so is a first
name typed on its own (as the data writes it, not where a sentence starts) when one person on the board has it; and,
for a question nothing else answers that asks something of one person, a first name typed in lower case where a name
stands ("how is ada doing?", "ada's backlog"). A
name two share is `not_understood`, asking the admin to pick with @ (a first name: `{First} could be {names}. Type @
and pick the one you mean.`); part of a name after an @ that is no one's is `Type @ and pick the person you mean
from the list, so the answer is about them.` Every scorecard or comparison answer over a period (not a ranking by a
count of now alone) ends, in code, with the caveat
`Figures from Jira over the last {days} days, next to the whole board.`, then whom the figures count for as the
board's credit setting has it (4.15), plus
` Code review isn't recorded on this board, so reviewers' work doesn't show.` where code review is not measurable for
want of it ("This board doesn't record code review in Jira."; not where R-FLOW-01 is only turned off, JO-15);
an answer whose figures mix periods names each ("over the last 30 and 180 days"). The answer orders and summarises;
it never insults or labels anyone (lazy, useless, incompetent, careless, dishonest, insincere, stupid, idiot,
hopeless, worthless, pathetic in any form of the word, slacker, liar, sloppy: one rewrite, then the answer built in
code; a message a model writes with no facts is held to the same words). The answer built in code cites each figure
to the row of the person it is about; a measure's label is never cited as a figure. Where an organisation has
turned comparison off (`PEOPLE_COMPARISON=off`), setting people side by side (two or more mentions, no one named,
or a second person's scorecard asked for within one ask, however the calls are split) is `not_understood` with
the message exactly `Comparing people side by side is turned off. Ask about one person at a time instead.`

The page shows each such answer's figures compact under its words (the scorecard, several side by side, or everyone
in order), and in the facts and the plan shows people by name and picture, never by id: an id column beside a name
column (`person_id`, `assignee_id`) is not shown, the name stands with the person's picture, and an id in a call's
parameters or a query reads as the person.

The messages are the contract's own words (`ASK_DECLINES` in `src/lib/api/schemas.ts`): the page tells the
declines apart by them, so they are sent to the letter. (JO-09's judgement decline, `I can show facts about
someone's tickets and findings, but not judge their performance.`, is no longer sent at people level; the page
still reads it as what it is.)

**Citation.** `marker` (1, 2, … in text order), `text` (an exact substring of `answer`: a number as written,
`"16%"`, `"1,134"`, `"12.5"`; an issue key; or a date, `"26 Oct 2026"`), `fact_ref`, `row_index`,
`column`. A value from a plan parameter or a row count has `row_index: -1` and `column` `"params"` or
`"row_count"`; one from a fact's note or `as_of`, `-1` and `"note"` or `"as_of"`. These are the
validator's bindings (`ask/validate.py`): every number, key and date it verified is cited, so the
interface can find each citation by searching `answer` from the end of the one before, on the
validator's token boundaries (never inside a rule id, a key or a longer number). `segmentAnswer()` in
`src/lib/api/citations.ts` does exactly that for the Ask page.

**Fact set.** `ref` (`F1`, …), `tool` (an `oversight_*` catalogue name), `params`, `columns`
(`{key, label, kind}`, with `kind` one of `text`, `number`, `count`, `hours`, `share`, `ratio`, `date`,
`issue_key`), `rows` (objects of string, number, boolean or null), `truncated` (more rows existed),
`as_of` (timestamp or null), `note` (string or null). These are `catalog.Facts.to_dict()` exactly. A row
of the `people` view (it has `person_id`) opens that person's open findings on the page, the Unassigned
row the findings on unassigned tickets.

Principle 3 applies: every number and issue key in `answer` must be in the facts or the plan parameters,
or the answer is withheld as `not_verified`. At people level, so must every name: every name of a person on
the board that appears in the answer (as a whole word, never inside another word) must appear in this
answer's query results or among the mentions; otherwise the rewrite runs, then `not_verified`.

### 4.7 `GET /insights/latest`

The weekly briefing (Planning.md Phase 7, `insights/weekly.py`). 404 before the first briefing (the
Overview's `latest_insight` is `null` then).

| Field | Type | Meaning |
|---|---|---|
| `meta` | meta | |
| `week_of` | date | The Monday of the week, in the report zone |
| `generated_at` | timestamp | When it was written; its figures are as of then |
| `verified` | boolean | Every number and key in the sentences was checked against the candidates. When false, the sentences are the plain candidate table (`render_insights_table`). |
| `sentences` | sentence[] | At most 200 words in all |
| `candidates` | candidate[] | The ranked candidates it was written from, highest score first (the top five) |
| `method` | string | How it was written, for the reader |
| `model` | string \| null | The model that wrote it |

**Sentence.** `id` (`s1`, …), `text`, `tone` (`blatantly_bad` \| `trending_bad` \| `neutral`),
`candidate_ids`, `issue_keys`, `finding_ids`: the candidates behind it, and their keys and findings, so
every sentence clicks through.

**Candidate.**

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Stable within the briefing, for example `hot-spot-demo-704` |
| `kind` | `wow_change` \| `breach_hot_spot` \| `rising_rule` \| `outlier` \| `coverage` | weekly.py's definitions |
| `title` | string | |
| `score` | number | `affected × severity weight × trend`; weights breach 3, warning 2, info 1 |
| `affected` | count | Issues affected |
| `severity` | `breach` \| `warning` \| `info` | |
| `trend` | number | This week over last week; 1 is steady |
| `detail` | `{key, label, value: number \| string \| null, unit: unit \| null}`[] | The figures the sentences may quote, as a list the page can render as a table |
| `issue_keys`, `finding_ids` | arrays | What it is about |

### 4.8 `GET /trends`

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `metric` | one of the six below | required | |
| `period` | `week` | `week` | The only period today |
| `last_n` | 1 to 12 | 12 | Weeks, ending with the current one |

| Field | Type | Meaning |
|---|---|---|
| `meta` | meta | |
| `metric`, `period`, `last_n` | | As requested |
| `label`, `unit`, `direction_good`, `note` | | How to title and read it |
| `series` | trend point[] (`last_n` of them) | `{t: Monday, value: number \| null}`; null when nothing was finished that week |

| Metric | Unit | Value for each week |
|---|---|---|
| `median_cycle_time_h` | hours | Median `cycle_time_h` of issues whose `done_at` falls in the week |
| `median_effort_ratio` | ratio | Median `effort_ratio` of issues done in the week **that have both an estimate and logged time** |
| `skipped_stage_share` | share | Share of issues done in the week whose history skipped a stage |
| `reopen_rate` | share | Share of issues done in the week that had been reopened |
| `open_breaches` | count | Breach findings open at the end of the week (`first_seen_at < end` and not resolved before it); for the current week, open now |
| `open_warnings` | count | The same for warnings |

"Done in the week" counts every issue type, Epics included, as `oversight_trend` does.

### 4.9 `GET /rules`

The Process page. No parameters. The catalogue as the board runs it (JO-15): every rule rules.yaml holds, the ones
an admin turned off on the board too, each as the board's rule settings make it (4.20), and (JO-20) the rules an
admin added to the board, after the catalogue's.

| Field | Type | Meaning |
|---|---|---|
| `meta` | meta | `rules_version` the catalogue's, whatever the board's settings; `last_synced_at` null for a board that has never synced: the catalogue does not wait on a sync, so the Process page opens for it, as its rule settings (4.20) do |
| `rules` | rule[] | Every catalogue rule, on or off, in catalogue order (rules.yaml), then the board's own rules in the order they were added (deleted ones left out) |
| `process.version` | string | process.yaml's `process_version` |
| `process.project` | project key | |
| `process.stages` | stage[] | James's nine stages in order |
| `process.estimate` | `{basis: "points" \| "hours", field, hours_per_point: number \| null}` | |

**Rule.** `rule_id`, `title`, `description`, `kind`, `severity` (the board's), `version` (the catalogue's),
`threshold` (string or null: the board's, in words: `"2×"`, `"≤ 3 days left, > 40% not started"`), `needs`
(string[]: what it reads from Jira, in plain words), `measurable` (on the board), `missing_evidence`, `open` (its
open findings on the board), `escalates_to` (the breach rule a warning foreshadows, or null), and (JO-15)
`enabled` (whether the rule runs on the board) and `customised` (whether anything of it differs from rules.yaml on
the board: on or off, the severity, a threshold). A rule that is off holds no open findings: the board stopped
running it, which is not the same as nothing being wrong. JO-20 adds `custom` (whether an admin added it to the
board) and `check_label` (its check in plain words, "Time in a status", from the check registry, 4.20; null where a
check has none). A custom rule's `version` is its own identity version, `c<revision that created it>` (`c3`), with
`+<severity>` while the board reports it at another severity than it was added with (4.22); its `customised` is
always false. An interface that predates them reads both as absent: `custom` false, `check_label` null.

**The page** (`/process`): a rule that is off is shown muted across its row (its title, kind, severity, threshold and
measurability in the quiet ink, its severity a muted badge) with "Off on this board", its open findings a dash
(said as "off on this board" to a screen reader), and the summary counts them ("7 rules and 5 early warnings (1 off
on this board)"); a customised rule carries a small "Customised" badge; the drawer says how the board runs it ("On",
"On, customised", "Off"). A custom rule (JO-20) carries a "Custom" badge with its check's label beside it, never
"Customised", and its drawer says "Custom rule" with the check; the catalogue's CSV export has a Custom and a Check
column. An admin (people level) gets "Edit rule settings" beside the catalogue's heading and in the drawer, leading
to `/governance/rules` (4.20); no one else is offered it.

**Stage.** `stage`, `label` (`"Code review"`), `mapped_statuses` (the project's statuses mapped to it),
`evidence` (`status` \| `field` \| `none`: where Jira records that the stage happened), `measurable`
(`evidence` is not `none`), `note` (one sentence for the reader).

### 4.10 `GET /baseline/latest`

The Baseline page: the newest `reports/baseline_<project>_<as_of>.json`, exactly as
`oversight/baseline.py` writes it (`{metadata, figures, comparison}`), plus `meta`. 404 before the first
report. Shares are fractions, null when the whole is 0.

`metadata`: `project`, `as_of` (date: the window's exclusive end), `window_days`, `zone`, `window`
(`start`, `end` in UTC and `start_local`, `end_local` with offsets), `generated_at`, `process_version`,
`last_synced_at` (or null), `metrics_computed_at` (or null), `metrics_stale`, `issues_without_metrics`,
`comparison_status` (`compared` \| `skipped` \| `not requested`), `comparison_note`, `run_id`.

`figures`:

| Key | Contents |
|---|---|
| `snapshot` | `last_synced_at`, `total_issues`, `created_before_window_end`, `by_type`, `by_status`, `by_status_category` (counts by value, largest first) |
| `resolved` | `in_window`; `with_original_estimate`, `with_story_points` (each `{count, share}`); `with_logged_time` with variants `timespent`, `aggregate`, `worklog_rows`; `straight_todo_to_done` (`{count, share, from_statuses, to_statuses}`); `created_in_done`; `done_entered_in_window` |
| `estimates` | `hours_per_point` (`n`, `median`, `p25`, `p75`); `within_25pct` (`{hours_per_point, count, share}` or null); `estimate_set_after_start` (`{count, of, share}`) |
| `time_in_status` | Keyed by status, in stage order: `{stage, n, median, p75, p90}` |
| `cycle_time` | `{n, median, p75, p90}` |
| `reopens` | `{count, share}` |
| `worklogs` | `count`, `total_hours`, `authors` (how many accounts: a count, never who), `top_author_share` and, when configured, `tempo_share` (each `{seconds, count}` as fractions) |
| `evidence` | `not_measurable` (process order), `configured` |
| `issue_links` | `issues_with_issue_links`, `issue_links`, `issue_links_by_title`, `remote_links`, `remote_links_by_host` |

`comparison`: `{metric, expected, actual (or null), match, note}` per expected figure (empty unless compared).

### 4.11 `GET /projects`

The boards the top bar can switch between (JO-17): every board the service serves, which may be dozens: the
projects its Jira account can browse (archived and trashed ones left out), and `JIRA_PROJECTS`. In the service's
order: the default first, then the synced boards by name, then the boards not synced yet by name. The same body
whichever board is picked, and no `meta`. A board that has never synced is listed with `issues: 0`,
`last_synced_at: null` and `synced: false`: it can be picked, and every page on it offers its first sync. Fast
with dozens of boards: the service works the list out in a few queries, never one per board, and looks for new
boards in the background (a request never waits on Jira).

| Field | Type | Meaning |
|---|---|---|
| `default` | project key | The board served when none is picked (the first of `JIRA_PROJECTS`); always one of `projects` |
| `projects[].key` | project key | |
| `projects[].name` | string | The board's name as people know it (`name` in process.yaml, else Jira's); the key when unset |
| `projects[].issues` | count | Issues of this board in the snapshot |
| `projects[].last_synced_at` | timestamp \| null | The start of its last successful sync; `null` before the first |
| `projects[].synced` | boolean | Whether it has synced at least once: `true` exactly when `last_synced_at` is set (the interface refuses a body that says otherwise) |
| `projects[].type` | string \| null | Jira's project type: `software`, `business`, `service_desk`, ...; `null` when the service does not know it |

**The board picker** (the top bar from 768 px, the navigation sheet below that) lists them all: a search field
that narrows by name or key as one types, then "Synced" and "Not synced yet", each board by name and key, a synced
board with its last sync ("4 min ago", the time in its tooltip). It is keyboard-complete: the focus stays in the
search field, the arrow keys and Page Up and Down move, Enter picks, Escape clears the search, then closes.

### 4.12 `GET /people`

Who has the board's tickets, with each person's open tickets, and the open findings grouped by the person each
ticket is assigned to now: the Overview's open findings by person. Board-scoped like `/overview` (`?project=`,
section 2), whole: everyone who may read the board sees every person on it. No other parameter.

| Field | Type | Meaning |
|---|---|---|
| `meta` | meta | |
| `people` | row[] | One row per person at least one of the board's work tickets (Epics left out) counts for (the credit rule, 4.29), one per person assigned work now that carries open findings, and one row with `person: null` for the work that counts for no one and the open findings on work nobody is assigned to now, only when there is either |

**Row.** One meaning of a person's tickets everywhere (JO-12): the board's work, every type but Epic (section 2's
"work"), that counts for them by the board's credit setting (4.29), open or finished, as the scorecard (4.15), the
directory (4.14), the person card (4.19) and every Ask tool and view count them. Someone the setting names on none of
the work (with Programmer chosen, an assignee never named as Programmer), or assigned only Epics, has no tickets (the
directory lists them with 0). Open findings alone stay with whoever is assigned a ticket now, as Findings' Person
filter reads them (4.3) and the Overview's open findings by person shows them; so someone assigned work that counts
for others has a row for its findings, with `tickets` 0.

| Field | Type | Meaning |
|---|---|---|
| `person` | person \| null | `null`: the work that counts for no one, and the findings on the unassigned tickets, shown as "Unassigned" |
| `tickets` | count | Their tickets, of every status (Epics left out): the board's work that counts for them; 0 for a row of findings alone. The `null` row's: the work that counts for no one |
| `open_tickets` | count | Those of their tickets whose status category is not `done`: the scorecard's `open_tickets`, figure for figure |
| `open_breaches`, `open_warnings` | count | Open findings on the tickets they are assigned now, by severity, as Findings filtered to them lists them. Issue findings only: a sprint finding belongs to no one, and so does a finding whose issue is no longer in the snapshot |
| `tickets_with_findings` | count | Distinct tickets they are assigned now with at least one open finding |

Ordered by `open_breaches`, then `open_warnings`, then `open_tickets`, each most first; then by name
(section 2), the unassigned row as "Unassigned"; then by id, the unassigned row's being `unassigned`.

A row must click through exactly: `/findings?state=open&person=<id or unassigned>` lists
`open_breaches + open_warnings` findings, and the same page's `facets.people` entry counts as many (no rule
applies to an Epic unless the catalogue names Epics, which by default it does not; a finding on one would be on
Findings only). The rows' `tickets` add up to the board's work (`issues` in `/projects`, less its Epics) only
where every ticket counts for exactly one person or no one, as on a board that credits its assignees (DEMO): a
ticket with several people in the field the setting reads counts once for each. The interface checks each row's
arithmetic (`open_tickets` at most `tickets`; `tickets_with_findings` at most the open findings, and at least 1 when
there are any; never a row with neither tickets nor open findings) and that nobody is listed twice; a body that
fails is answered 502 `upstream_invalid`.

### 4.13 `GET /people/{person_id}/avatar`

A person's Jira picture, as the service fetched it at sync and keeps it. Board-scoped like `/people`
(`?project=`, section 2): a picture only of someone on the board (assigned one of its tickets now, or a
member from its last successful member fetch, 4.14). No other parameter
matters: the interface asks for `/api/oversight/people/{id}/avatar?v=<avatar>`, so a changed picture (a new
version, so a new address) is never hidden by a cached one, and never forwards `v`, which the service
ignores anyway.

| Status | Answer |
|---|---|
| 200 | The stored bytes, with the stored `Content-Type`: `image/png`, `image/jpeg`, `image/gif` or `image/webp`, never anything else (never SVG). Headers `Cache-Control: private, max-age=86400`, `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; sandbox` |
| 404 | The contract's error body: the id is malformed, nobody by that id is on the board (neither assigned one of its tickets now nor a member), or the service holds no picture of them |

The interface checks the id (`^p[0-9a-f]{12}$`, exactly; otherwise 404) and `v` (12 lower-case hex
characters, at most once; any other parameter is 400), holds the request to the reader's boards as it
holds every route (403 `board_not_allowed`), and passes the bytes on only when the `Content-Type` is one of
the four, the bytes start as that type says (the PNG, JPEG, GIF or WebP signature) and they come to at most
256 KB, the most the service keeps; anything else is 502 `upstream_invalid`. It answers with the same three
headers. The browser shows the person's initials whenever no picture arrives, whatever the reason.

**Where the pictures come from** (the service, after every sync, full or incremental): Jira's 48×48
picture address for each person on the synced boards (current assignees and members) is kept with the person, and their picture fetched
when the service has none, when the address has changed, or when the one it holds is over 7 days old, at
most 200 a run. Fetching is https only, from `secure.gravatar.com` and from hosts matching
`^avatar-management--avatars\.[a-z0-9-]+\.prod\.public\.atl-paas\.net$` and nowhere else, with an HTTP client
that carries no credentials (never the Jira token); redirects are followed by hand, at most 3, each held to
the same rules. Gravatar sends someone without a Gravatar on to the default picture its address names (`d=`,
which Jira points at their Atlassian initials picture) through an image proxy of its own, which is neither
host: that redirect is never followed, and the default picture is fetched from Atlassian instead, once,
under the same rules. 5 s and 256 KB at most; PNG, JPEG, GIF or WebP by their first bytes. A failure keeps any
picture already held, is logged with the person id and the reason (never the address), and never fails the
sync. The version is the first 12 hex characters of sha256 of the stored bytes.

### 4.14 `GET /people/directory`

Everyone on the board, as Jira's own assignee picker lists them: what Ask's @ list offers (JO-10).
Board-scoped like `/people` (`?project=`, section 2): the only parameter is `project` (any other name, or a
name given twice, is 422, as for `/people`), with the same board checks. `Cache-Control: no-store`. The
interface serves it as `/api/oversight/people/directory`, taking no parameter at all (any is 400) and
adding the board picked in the top bar, never one from the query. Only people level reads it: the @ list is
theirs alone, so with sign-in on, a reader Ask answers at team level (not an admin) is refused with 403
`people_not_allowed` ("Only admins can pick people to ask about."), after the board checks and before the
sample or the service is asked anything.

| Field | Type | Meaning |
|---|---|---|
| `meta` | meta | |
| `people` | entry[] | One entry per person on the board, each once: everyone currently assigned at least one of the board's tickets (any status or type, an Epic too), everyone a people field of its tickets names (the fields 4.29 offers), and every member of the board's last successful member fetch. No Unassigned entry |

**Entry.**

| Field | Type | Meaning |
|---|---|---|
| `person` | person | Never `null` |
| `tickets` | count | Their tickets (Epics left out): the board's work that counts for them under its credit setting (4.29), `GET /people`'s `tickets` for the same person; `0` for a member who has none, for someone assigned only Epics, and for someone assigned, or named in a people field, whose work the setting credits elsewhere |

Ordered by name folded for case and accents (lower case, accents taken off, as the @ list's filter folds a
search: `foldText()` in `src/lib/names.ts`), compared code point by code point; then by id.

**Members.** At every sync, full or incremental (so `POST /refresh` too), the service asks Jira for each
synced board's assignable users (`GET /rest/api/3/user/assignable/search?project=<key>`, read-only, paged
100 at a time: Jira reads its users in the range `[startAt, startAt + 100)` and sends only those who can be
assigned, so `startAt` moves on by 100 each page and only an empty page ends the read; a page that brings no
account not already seen stops it and logs `board_members_page_repeated`, and at 2,000 a board it stops and
logs `board_members_capped`; the whole step has 60 seconds, retries and their waits included). Only
`accountType` `atlassian` accounts that are
`active` are members: app accounts (time tracking, automation), customer accounts and inactive accounts
never are. Of each, only the identity the people rules of section 2 allow is kept (never the email address,
time zone, locale or `self`). A fetch that fails keeps the board's previous members, is logged
(`board_members_not_refreshed`, the board and a short reason, never a person), and never fails the sync.

**"On the board" now includes members.** A person is on the board when they are a current assignee of one of
its tickets, a person one of its people fields names, or a member from its last successful member fetch. That widens
exactly three things: this directory, a person's picture (4.13) and Ask's mention check (4.6). `GET /people` and the
views built on it count a person's tickets by the credit rule (4.12); the findings' people facet stays with the
assignees. A member assigned nothing owns no finding: `/findings?person=<their id>` is an empty list (4.3), and so is
the list of someone whose tickets count for them but who is assigned none of the board's tickets now.

The interface checks each entry's person as everywhere (an id, a name and a picture's version, nothing else),
`tickets` a count, and that nobody is listed twice; a body that fails is answered 502 `upstream_invalid`.

### 4.15 `GET /people/scorecard`

How each person's tickets are handled, next to the whole board (JO-11, the product owner's decision of 11 Nov
2026): process figures from Jira, each beside the board's, with the counts behind them. People level only. The
figures are facts: what is written about them never labels anyone, and the decision about a person is always the
admin's. Board-scoped like `/people` (`?project=`, section 2); `Cache-Control: no-store`.

**Request, interface to service.** `project` (added by the interface, as everywhere), `level` (`team` | `people`,
`team` when left out: the level this interface's server decided for the reader, exactly as it sets Ask's `level`,
never anything the browser said), `days` (`30` | `90` | `180`, default `90`) and `person` (a person id, repeatable,
at most 10). Any other name, a name given twice (but `person`), a bad `days` or an eleventh `person` is 422. A
`person` who is not on the board (neither a current assignee, a person one of its people fields names, nor a member,
4.14) is 404, as the picture route answers. At team level the service answers 403 with code `people_level_only`; with `PEOPLE_COMPARISON=off`, two or
more `person` values are 403 with code `comparison_off` (the code anywhere in FastAPI's body: `{"detail", "code"}`).

**Request, browser to interface.** `/api/oversight/people/scorecard?days=&person=`: `days` and `person` only, each
checked (`src/lib/api/params.ts`: 30, 90 or 180; person ids, each once, ten at most) and rebuilt; anything else is
400 `bad_request`, `project` and `level` included (the board is the top bar's pick; the level is this server's).
With sign-in on, a reader Ask answers at team level is refused with 403 `people_not_allowed` ("Only admins can see
people's scorecards."), after the board checks and before the sample or the service is asked anything. The page
that shows the figures (`/people`) answers such a reader with the app's not-found page.

**Comparison.** `PEOPLE_COMPARISON` on the service (`on` by default; `off` only where an organisation does not want
people compared; `SAMPLE_PEOPLE_COMPARISON` in the sample). With it `on`, no `person` is everyone with at least one of
the board's work tickets (Epics left out) that counts for them (the credit rule, 4.29): "Everyone with tickets". With it `off`, no `person` is `comparison: "off"`, `people: []` and the board's
figures (so a one-person view needs one call), one `person` is that person, and two or more are refused: the
interface answers 403 `comparison_off` with the contract's sentence, `Comparing people side by side is turned off.
Ask about one person at a time instead.`

| Field | Type | Meaning |
|---|---|---|
| `meta` | meta | |
| `period` | `{days, from, to}` | `to` is the snapshot's as-of (the last successful sync); `from` is `days` before it. "In the period" is from ≤ t ≤ to |
| `basis` | `"credit"` | Whose a ticket is (the credit rule, 4.29): every measure, of now (`open_tickets`, `in_progress`, `stuck_now`, `open_findings_per_10`) and of finished work alike, counts each ticket for the people the board's credit setting names on it, and for no one where it names no one |
| `comparison` | `"on"` \| `"off"` | As above |
| `measures` | measure[] | Always all eleven, in the order of the table below |
| `board` | `{tickets, values}` | Every ticket on the board, whoever it counts for. `tickets` counts the board's work, Epics left out, as `GET /people`'s count does (JO-12: one meaning of tickets everywhere) |
| `people` | row[] | `{person, tickets, values}`, by name folded for case and accents, then id (the directory's order). `tickets` is `GET /people`'s and the directory's count for the same person: the board's work that counts for them (Epics left out). Anyone on the board asked for who has no work (a member with no ticket, someone the setting names on none of it, someone assigned only Epics) is `tickets: 0` with every value null, `enough: false`, `vs_board: null`. With comparison off, at most one row |

**Measure** `{key, label, kind, direction, rule_ids, measurable, reason}`: `kind` `count` \| `rate` \| `ratio`;
`direction` `neutral` \| `higher_is_closer` \| `lower_is_closer`; `rule_ids` the rules whose findings are its tickets
(open findings per 10 counts every issue rule); `measurable` false, with `reason` in the contract's words and every
value null, where the board cannot show it.

**Value** `{value, numerator, denominator, enough, vs_board}`: a count's `value` is the count (numerator and
denominator null, always `enough`); a rate's is a whole percentage of `numerator` over `denominator` (half up); the
ratio's is ten times findings over open tickets, to one decimal. `enough` is a denominator of at least 5 tickets
(`MIN_TICKETS`, one constant on the service); with fewer, `value` is still given ("1 of 2" shows) but never
compared. `vs_board`, for rates and the ratio only and only when both sides have enough: `level` within 5
percentage points (0.5 for the ratio) of the board on the figures as shown, otherwise `closer` or `further` by the
measure's direction; null otherwise.

| key | label | kind | direction | counts, over each person's work (Epics left out, as every rule leaves them out): the tickets that count for them, for every measure | rule_ids |
|---|---|---|---|---|---|
| `open_tickets` | Open tickets | count | neutral | not in a done category now | |
| `in_progress` | In progress now | count | neutral | in an in-progress category now | |
| `done_in_period` | Done in the period | count | neutral | `done_at` in the period | |
| `estimated_before_start` | Estimated before work started | rate | higher_is_closer | of those started in the period, those whose estimate was set no later than the start (within R-EST-02's grace) | R-EST-01, R-EST-02 |
| `time_logged` | Time logged on done work | rate | higher_is_closer | of those done in the period, those with time logged (`time_spent_s` or `aggregate_time_spent_s` above 0) | |
| `within_estimate` | Done within the effort limit | rate | higher_is_closer | of those done in the period with an effort ratio and time logged, those under R-EFF-01's threshold (read from the rules; R-EFF-01 breaches at it or over) | R-EFF-01 |
| `stuck_now` | Open tickets stuck in a status | rate | lower_is_closer | of the open ones, those with an open W-AGE-01 finding | W-AGE-01 |
| `reopened` | Reopened after Done | rate | lower_is_closer | of those done in the period, those with `reopen_count` above 0 | R-FLOW-03 |
| `skipped_stage` | Skipped a stage | rate | lower_is_closer | of those done in the period, those with skipped stages | R-FLOW-02 |
| `code_review` | Code review recorded | rate | higher_is_closer | of those done in the period that reached testing and that the rules have checked (within the rules' look-back of their first run that could measure R-FLOW-01, or with an R-FLOW-01 finding), those without an R-FLOW-01 breach | R-FLOW-01, W-REV-01 |
| `open_findings_per_10` | Open findings per 10 open tickets | ratio | lower_is_closer | open breaches and warnings on the open ones ÷ the open ones × 10 | (every issue rule) |

Not measurable, with the reason to the letter: `skipped_stage` where the rules engine does not measure R-FLOW-02 on
the board ("This board has no stages to skip."); `code_review` where it does not measure R-FLOW-01 ("This board
doesn't record code review in Jira."). One truth per board (JO-12): "measures" is what the engine recorded in
`rule_status` in its latest rules run on the board (measurable 1), for a rule the catalogue still has enabled, and
before any rules run has reached the board, the engine's own test (nothing the rule needs is missing), so these two
are measurable exactly where the Overview's `by_rule` lists the rule as measurable. R-FLOW-02 needs no stage or
evidence, so skipped stages are measured on AIL and DEMO, and code review on neither; `time_logged` where no one
logged time on the board in the period ("No one logged time on this board in the period."); `estimated_before_start`
and `within_estimate` where the board has no estimate field ("This board has no estimates."). A measure whose rules
the board has turned off (JO-15: its rule settings, or rules.yaml itself) holds no one to them there: "Its rule is off
on this board." (`within_estimate` R-EFF-01, `stuck_now` W-AGE-01, `reopened` R-FLOW-03, `skipped_stage` R-FLOW-02,
`code_review` R-FLOW-01), "Its rules are off on this board." for `estimated_before_start` with both R-EST-01 and
R-EST-02 off; a board that could not show the measure with them on keeps that reason (DEMO, R-FLOW-01 off: "This
board doesn't record code review in Jira."). So `stuck_now` never reads 0% for want of a W-AGE-01 that is off.

The interface checks the body (`peopleScorecardSchema`): the eleven measures in order with the contract's kinds and
directions; a value for every measure, everywhere; each rate and ratio against its numerator and denominator (either
rounding of a half); a measure the board cannot show holding nothing (never a zero); no comparison with too few
tickets on either side, and a comparison wherever both have enough; nobody twice; at most one person with comparison
off; and, against the request, the period asked for and no one who was not asked for. A body that fails is 502
`upstream_invalid`, with the failing paths.

**The page** (`/people`, people level only; the rail, the palette and `g` then `e` offer it there and nowhere else):
the period (30, 90 or 180 days) and the board picked in the top bar. With comparison on, the everyone table (the
person held at the left, a column per measure the board can show, sortable by any column: a measure sorts closer to
the process first, and too few tickets always last; a header's tooltip says what it counts, which way is closer, and
whom it counts for in the note's words), the note under it in plain words following the setting (Programmer:
"Tickets count for their Programmer in Jira; tickets without one count for no one."; Assignee: "Tickets count for
their assignee; tickets without one count for no one."; Automatic: "Tickets count for their Programmer in Jira, or
their assignee where there is no Programmer."), then the scorecard of the row chosen. Beside the period, the
setting's control, "Counts for: Automatic" (4.29). At phone width the table is a list with the sort above it. With
comparison off, a person picker (the directory's two groups, "With tickets" first) and that person's scorecard. The
scorecard: the count of their tickets beside the name ("142 tickets"), a row per measure, the
person's figure ("72% · 18 of 25") beside the board's, its mark ("Closer to the process", "Further from the
process", "Level with the board" or "Too few tickets", in the neutral inks: none of them is good or bad), and a link
to its tickets (Findings by person and rule, or Ask's list of their tickets); the measures the board cannot show last,
muted, with the reason; the caveat at the foot, the service's words to the letter (its Ask answers end with them):
"Figures from Jira over the last 90 days, next to the whole board.", then the note's words for the setting ("Tickets
count for their Programmer in Jira, or their assignee where there is no Programmer." on Automatic). The address holds
`days`, `person`, `sort` and `order`. Ways in:
"View scorecard" beside the Findings Person filter when one person is chosen, "View scorecards" on the
Overview's open findings by person, and an Ask comparison's "Open on the People page", sorted by its measure in the
answer's order (`order` only where it is not the column's own first order: `/people?sort=reopened&order=desc` for
"who has the most reopened tickets?", JO-14).

### 4.16 `GET /access-log`

Who viewed whose person-level figures, and when (JO-12): every scorecard, comparison, person's findings, question
about people and person card (JO-13) read through the API (the seven actions below; the people list behind the
Overview's open findings by person and the @ list's directory are not recorded), so an
organisation can answer "who looked at this person's figures, and when" (GDPR accountability). People level only;
not board-scoped (an entry names its board); `Cache-Control: no-store`.

**The viewer, on every request.** The interface's server names the reader to the service beside the service key,
from the session, never from the browser:

| Header | Value |
|---|---|
| `X-Oversight-Viewer` | A keyed hash of the session's Atlassian account id: HMAC-SHA-256 under `AUTH_SECRET`, lower-case hex, its first 32 characters (`src/server/auth/viewer.ts`); `local` while sign-in is off |
| `X-Oversight-Viewer-Name` | The viewer's Atlassian display name, kept in the session from the `/me` call signing in makes, percent-encoded (UTF-8, as `encodeURIComponent` writes it); `Local (sign-in off)` while sign-in is off; `Signed-in user` for a session from before the name was kept |

Never an email address, never the raw account id: a display name that holds an address is not kept in the session
at all. The hash is stable for a person while `AUTH_SECRET` stays the same, so their reads can be listed together;
it cannot be turned back into the account without the secret. A request the service must record (below) that names
no viewer is 422 on the service; the interface always names one. The level travels as it always has: Ask's body,
and `level` on the routes that take it (this one, 4.15, 4.17, and `GET /findings` when it filters by a person,
4.3).

**What is recorded**, by the service, once per request and only when the request succeeds; the person ids read are
the entry's subjects:

| `action` | Recorded for | `detail` (the service's) |
|---|---|---|
| `scorecard_view` | `GET /people/scorecard` with one `person` | `{days}` |
| `people_compare_view` | `GET /people/scorecard` with no `person`, or several (a response that holds no one, such as the board's figures alone with comparison off, is not recorded) | `{days}` |
| `person_findings_view` | `GET /findings` filtered by one or more people (`unassigned` is no one) | `{state, page}` |
| `person_ask` | a people-level `POST /ask` that read person-level data, whatever its outcome: it mentioned people, used a person tool, ran an analyst query over the `people` or `scorecard` view or an `assignee` column, or sent facts holding someone on the board by person id or by display name (subjects: the people mentioned, those the answer names, then everyone the facts hold) | `{qa_id, outcome}` |
| `access_log_view` | `GET /access-log` | `{from, to, actions, viewer, entries}` |
| `access_log_export` | `GET /access-log?export=true` | `{from, to, actions, viewer, entries}` |
| `person_card_view` | `GET /people/{person_id}/card` (JO-13), at most once per viewer, person and board in any ten minutes, so hovering back and forth over a name does not flood the log | `{days}` |
| `scorecard_tickets_view` | `GET /people/scorecard/tickets` (4.25), with the person (none for the whole board) | `{measure, days}` |

A failure to write the entry fails the request closed: the service serves nothing and answers 500 with code
`access_log_unavailable`; the interface says so in its own words (503 `access_log_unavailable`, section 5). Entries
are kept `ACCESS_LOG_DAYS` (default 365, at least 30), purged at start and once a day.

**Request, interface to service.** `level` (`team` | `people`, the interface's decision), `from`, `to` (calendar
days, `YYYY-MM-DD`, in the report zone, both included, from 2000-01-01 to 2100-12-31: any other day is 422, never a
fault), `action` (repeatable, any of the seven), `person` (a person
id among an entry's subjects), `viewer` (a viewer hash, or `local`), `cursor` (the `next_cursor` of the page
before), `limit` (1 to 200, default 50) and `export` (`true` for an export: the same filters, `limit` up to
10,000, recorded as `access_log_export`). The interface always sends `limit`. At team level the service answers
403 `people_level_only`.

**Request, browser to interface.** `/api/oversight/access-log` with `from`, `to`, `action`, `person`, `viewer`,
`cursor`, `limit` (at most 200, or 10,000 with `export=true`) and `export`, each checked
(`parseAccessLogQuery` in `src/lib/api/params.ts`: a calendar day from 2000 to 2100, a range that ends on or after it
starts, one of the seven actions, a person id, a viewer hash) and rebuilt in canonical form (actions in the order above, each once,
the limit always written); anything else, `level` and `project` included, is 400 `bad_request`. A reader Ask answers
at team level is refused with 403 `people_not_allowed` ("Only admins can see the access log.") before the sample or
the service is asked anything; the pages (`/governance`, `/governance/access-log`) answer them with the not-found
page.

| Field | Type | Meaning |
|---|---|---|
| `meta` | meta | `projects` names every board the service serves; `last_synced_at` is the latest of their syncs, null until the first board has synced (the page still opens then) |
| `entries` | entry[] | Newest first (by time, then id); at most `limit` |
| `next_cursor` | string \| null | Opaque (printable ASCII, at most 512 characters); null on the last page |
| `facets` | `{viewers, subjects}` \| null | On a first page (no `cursor`, not an export; null otherwise): everyone the whole log holds, whatever the filters, so the filters can offer them all, on any board. `viewers` `{hash, name}`[], each viewer once by the name of their latest entry, by name; `subjects` person objects, everyone ever read, by name, a former member after everyone else |

**Entry** `{id, at, viewer: {hash, name}, level, project, action, subjects, detail}`: `id` the service's own key
(1 to 64 of `A-Za-z0-9_-`), `at` when, `level` the level read at (`people` or `team`), `project` the board read
(null for the access log's own reads), `subjects` person objects, as everywhere (a person on no board the service
serves any more is `{"id", "name": "Former member", "avatar": null}`). The interface keeps of `detail` only `days`
(a whole number, at least 1), `qa_id` (32 hex) and `entries` (a whole number), each null where it does not apply,
and drops the rest; a viewer name that holds an email address reads as `Signed-in user`. It checks the body
(`accessLogSchema`: no entry twice, newest first) and, against the request, refuses a page that holds more than
`limit` entries or an entry the filters leave out (an action, a viewer, a person not asked for): 502
`upstream_invalid`.

**The page** (Governance, `/governance/access-log`; `/governance` opens it; people level only, `g` then `l`): the
filters in a row (period: the last 7, 30, 90 or 365 days to the log's today in the organisation's zone, all
recorded, or two days typed in; action; whose figures, a person picker; viewer), all in the address; the person and
viewer pickers offer everyone the log holds (the first page's `facets`, and anyone seen since), and a person or
viewer in the address that it does not hold reads "Someone not in the log". A dense table (the time in the
organisation's zone with the date in full and the zone's short name, "4 Nov 2026, 2:18 PM GMT"; the viewer by name
with "Admin" or "User" under it, nothing under "Local (sign-in off)"; the action in plain words, with the period or
the entries read under it; the board, or "Every board"; whose figures, as pills with their picture, three and
"+n"); a person's pill or a viewer's name filters by them. Above it, how many entries, "as of" the time the page was
read, and the zone in words once ("Times in Central Time."; UTC as "UTC"; never the zone's IANA id); while other
filters load, the entries shown are dimmed and busy and the line says "Updating…". `Show 50 more` follows the
cursor. Refresh reads the first page again, and only it (one recorded view), so a read made meanwhile shows. Export
CSV writes every entry the filters keep (the service's newest 10,000 at most, said so when there are more), built in
the browser with the csv util, in the page's words (a Role column, "Every board"); the service records the export
itself. Reading the log is recorded too, so the page reads it only when asked: opening the page (its first page
anew, never every page read before), a filter, Show more, Refresh, Try again; never on focus, a reconnect, a timer
or a sync. Empty and error states as everywhere. The plain words:

| `action` | Shown as |
|---|---|
| `scorecard_view` | Viewed a scorecard |
| `people_compare_view` | Compared people |
| `person_findings_view` | Viewed findings for a person |
| `person_ask` | Asked about people |
| `access_log_view` | Viewed the access log |
| `access_log_export` | Exported the access log |
| `person_card_view` | Viewed a person card |
| `scorecard_tickets_view` | Viewed the tickets behind a figure |

Resting the pointer on a person's pill opens their card (4.19), read on the entry's board; a press on it still shows only
the reads of their figures (the pill says so to a screen reader). A former member's pill has no card.

### 4.17 `GET /usage`

How much Ask is used (JO-12): today's questions, model calls and tokens, against the daily AI budget where one is
set, and the last seven days. People level only; not board-scoped; `Cache-Control: no-store`. Request, interface to
service: `level` alone (403 `people_level_only` at team level). Browser to interface: no parameters (400 for any);
a team-level reader is refused with 403 `people_not_allowed` ("Only admins can see Ask's usage.").

| Field | Type | Meaning |
|---|---|---|
| `meta` | meta | `last_synced_at` null until the first board has synced, as in 4.16 |
| `today` | object | The current UTC day, to now: `questions` (Ask's, from `qa_log`), `model_calls`, `input_tokens`, `output_tokens` (Ask's and the weekly briefing's calls, from `llm_calls`), `budget_tokens` (`LLM_DAILY_TOKEN_BUDGET`; null when it is 0, no budget) and `budget_used_pct` (input and output tokens over the budget, a percentage, one decimal, past 100 when the last call took the day over; null exactly when `budget_tokens` is) |
| `last_7_days` | `{date, questions, model_calls, tokens}`[] | The last seven UTC days, oldest first, today last; `tokens` is input and output together |
| `ai_model` | `"on"` \| `"off"` | Whether an AI model is set up on the service (`LLM_MODE=live`); `"off"` when every answer is built in code, which uses no tokens |

**The guardrails behind it**, on the service: `ASK_RATE_LIMIT` (`off` by default, so admins are never limited unless
an organisation chooses to; `<count>/<n>m`, per viewer, kept in memory per process): over it, `POST /ask` answers
429 with code `ask_rate_limited` and `Retry-After` in seconds, logs nothing to `qa_log` and never calls the model;
the interface passes it on as 429 `ask_rate_limited` with the message `You've asked a lot of questions in a short
time. Try again in {n} minutes.` (`n` the wait rounded up to whole minutes, "1 minute" singular) and the same
`Retry-After`, and the Ask box keeps the question and says so under it. `LLM_DAILY_TOKEN_BUDGET` (input and output
tokens per UTC day across Ask and insights; 0, the default, is no limit): once it is reached, Ask answers in
catalogue mode, with no model, and the answer's `note` (4.6) is `Today's AI budget is used up, so this answer was
built without the AI model.`; insights skip with a log line. It resets at 00:00 UTC.

**The page** (Governance, `/governance/usage`, people level only, `g` then `u`): today's four figures as tiles; with
a budget, a meter of how much is used (its share once, a whole percentage; amber from 90%), with the tokens left or,
used up (the tokens at or over the budget, as the service decides it, never a share rounded to 100%), what that
means; without one, one line saying none is set; with no model set up (`ai_model` off), one line saying Ask builds
every answer without one. Then the last seven days as a bar list of tokens, or of questions when no model is set up
or none was used all week (a table view with the questions, model calls and tokens each day); its summary names the
busiest day only when there was one, and a week with nothing asked is the empty state. No chart library.

### 4.18 `GET /portfolio`

Every synced board at a glance (JO-12, JO-17): the admin's home after signing in. Not board-scoped: one row for
each synced board the service serves, every figure worked out by the same functions, from the same records, as that
board's `GET /overview`, so the two always agree; the oldest open breaches across the boards; and how many of the
boards served have not synced yet (`boards_not_synced`), which have no row. Request, interface to
service: `board` (repeatable, each once: the boards to list and to find the oldest breaches across, in the service's
order; a well-formed key the service does not serve lists nothing; a malformed one, or one given twice, is 422).
The interface's server sends the boards the session may open for a reader of some boards, and none for an admin or
with sign-in off (every board), so "Needs attention" is always the reader's own ten oldest. The service also accepts
`level` and ignores it (the Portfolio names no one). Browser to interface: no parameters (400 for any: the browser
never names boards). The interface's server keeps, of `boards` and `attention`, only the boards the session may open
again all the same, and `meta.projects` to the same boards, before anything reaches the browser; a session with no
board of its own is 403 `board_not_allowed`.

| Field | Type | Meaning |
|---|---|---|
| `meta` | meta | `last_synced_at` is the latest of the boards' syncs, and null until the first board has synced (as on 4.16 and 4.17, which belong to no one board): the page still opens then |
| `boards` | board[] | The synced boards asked for (every synced board without `board`), in the service's order (as `GET /projects` lists them), each once |
| `attention` | item[] | At most 10: the oldest open breaches on issues across the boards listed, one item for each ticket and rule (never the same `project`, `issue_key` and `rule_id` twice), oldest first; breaches first seen at the same moment (one rules run stamps every board alike) take turns by board, each board's first, then each board's second, so one board never fills the list on a tie; then board, issue number, issue key and rule |
| `boards_not_synced` | count | Boards the service serves that have not synced yet (of the boards asked for, with `board`), so have no row. The interface's server holds it to the reader's boards too: at most their boards that have no row. The service's first JO-17 build named it `not_synced`: the interface reads that name too (the contract's wins when a body carries both) and always passes it on as `boards_not_synced` |

**Board** `{project: {key, name}, last_sync_at, open_tickets, in_progress, open_breaches, open_warnings,
new_findings_7d, resolved_findings_7d, open_findings_trend, tracking_since, active_sprint,
unestimated_in_active_sprint, sprint_at_risk, top_rule, stale}`: `last_sync_at` the start of the last successful sync
(null before the first: the board has no figures yet, and the service's zeros for it are not measurements);
`open_tickets` and `in_progress` the Overview's "where work sits now" (work, Epics left out: not done, and in
progress); the four finding figures the Overview's headline tiles now; `open_findings_trend` 8 counts of open
breaches and warnings, oldest first: at the end of each of the 7 weeks before this one (Monday 00:00 UTC, the weeks
`GET /trends` counts, 4.9), then the open findings now; `tracking_since` when the rules first saw the board (the
Overview's `tracking_since`, 4.2; null before any rules run): in its first tracked week every finding is new only
because tracking began; `active_sprint` whether the board has an active sprint now (false before its first sync);
`unestimated_in_active_sprint` W-EST-01's open findings, null with no active sprint or where the rule is missing,
disabled or not measured (never a 0 that was not measured); `sprint_at_risk` whether W-SPR-01 holds an open finding,
null with no active sprint or where it cannot run (`active_sprint` tells the two apart); `top_rule` `{id, title,
open}`, the rule with the most open findings (catalogue order breaks a tie; null with nothing open); `stale` the last
sync is more than 2 hours old by the service's clock, or there is none: the one rule the top bar, Findings, the person
card and the digest use (JO-14; it was a day here), which the page reads on the reader's clock, as the top bar does.
The interface refuses only what no reading of the figures allows (more in progress than open, a trend that is not 8
weeks); it never re-adds the service's figures.

**Item** `{project, issue_key, rule_id, title, severity, opened_at, last_seen_at, age_days, findings}`: one ticket and
rule. A rule can hold more than one open finding on one ticket (R-FLOW-02 opens one for each transition that skipped a
stage), and the same ticket and rule listed twice reads as a duplicate (13 Nov 2026), so they are one item, and the
list is the 10 oldest distinct tickets and rules. `title` the rule's, `severity` `breach`, `opened_at` when the rules
first saw the oldest of its open findings, `last_seen_at` the last rules run that saw any of them (never before
`opened_at`), `age_days` whole days from `opened_at` to the service's now while the board's last sync is fresh, and to
`last_seen_at` once it is stale: what is open is known only as of that sync, so the age stops there (one clock, JO-14,
Findings' "Open for"); `findings` how many open findings of the rule the ticket holds (1 or more, each counted once);
each on one of the boards listed. The interface refuses a body that names one ticket and rule twice.

**The page** (`/portfolio`, every reader; first in the rail, `g` then `h`; an admin's landing page after signing in
when the sign-in was going nowhere in particular, a user's still the Overview): one sentence across the boards with
figures (open breaches and warnings, new and resolved in the last 7 days leaving out a board in its first tracked
week, how many have not synced in the last 2 hours, and how many have not synced yet), then a row per board: name, and
under it its key and its last sync (relative, the time in its tooltip; "Stale" in amber with the warning mark when it
is over 2 hours old by the reader's clock, exactly when the top bar says Stale, or "Never synced"); open breaches and
warnings; this week's change (new less resolved, with both under
it; "Tracking since" and the day in a board's first tracked week, as the Overview's tiles say it); the 8-week trend as
a sparkline (none in a first tracked week); the sprint ("No active sprint" alone when there is none; else at risk, on
track or "Risk not measured", over its unestimated work or "Estimates not measured"); the top rule (its title, up to
two lines, over its id and open findings). A board that has never synced shows a dash, read as "No figures yet", in
every figure, never zeros. Open and in-progress work are in the export (blank for a board with no figures yet).
Sortable by any column but the trend (most open breaches first by default; the Sprint column at risk first, then by
unestimated work; a board with no value for a column, no figures yet, or a first tracked week on "This week",
always last), the sort in the address. A row opens its board's Overview, picking the board in the top bar first; a
board that has never synced has no Overview yet, so its row has no pointer, hover or chevron and says why in its
tooltip ("Not synced yet: no Overview to open"), and its card has no link, as the top bar offers it only once
synced. Export CSV of the boards as shown. Below 48rem the table is a card per board with the sort above it. Under
it, "Needs attention": the oldest open breaches, a row for each ticket and rule ("First seen" and "Seen for", read as
Findings reads "Open for": to now while the board's sync is fresh, else as at that sync, which the row says, "at last
sync"; a ticket holding more than one open finding of the rule says how many beside the rule, "2 findings", dated from
the oldest), each opening its ticket on its own board; empty, it says what is true of the boards above: none synced
yet, no open breach on any board, or open breaches only on sprints, which have no ticket to open. Under the boards,
when `boards_not_synced` is above 0, one line: "2 more boards in Jira aren't synced yet." ("2 boards ..." when none
has synced), and "Choose a board", which opens the board picker, where each can be picked and synced.

### 4.19 `GET /people/{person_id}/card`

What an admin sees on resting on or pressing a person's name (JO-13, the product owner's request of 12 Nov 2026: "the
same thing as Jira and Confluence, in a very attractive way"): as Atlassian's profile card shows the person, this card
shows their work on the board. People level only. Board-scoped like `/people` (`?project=`, section 2);
`Cache-Control: no-store`. Every figure on it is one the People page shows, worked out by the same functions from the
same records under the board's credit setting (4.29), so a card never disagrees with the People page.

**Request, interface to service.** `project` (added by the interface: the board picked in the top bar, or the board the
page named, below), `level` (`team` | `people`, the level this interface's server decided for the reader, exactly as
for 4.15; `team` when left out) and `days` (`30` | `90` | `180`, the scorecard's; default `90`). Any other name, a name
given twice or a bad `days` is 422. A person id that is malformed, or of no one on the board (neither assigned one of its
tickets now nor a member, 4.14), is 404, as the picture route answers, with no code; a `project` the service does not
serve is 404 with the code `unknown_board` (`{"detail", "code": "unknown_board"}`, as on every board-scoped route), so
the two are never mistaken for each other. At team level the service answers 403
`people_level_only`, whoever is asked about. The service records every card it serves in its access log (4.16) as
`person_card_view`, with the person and `{days}`, at most once per viewer, person and board in any ten minutes; a read it
cannot record serves nothing (500, `access_log_unavailable`).

**Request, browser to interface.** `/api/oversight/people/{id}/card` with `days` (30, 90 or 180; left out for 90) and
`board` (a project key, where the page names the board to read the card on: an access log entry's; held to the reader's
boards exactly as the top bar's pick is, 403 `board_not_allowed` otherwise, and sent on as `project`, never as itself),
each checked (`parsePersonCardQuery` in `src/lib/api/params.ts`). The id exactly as section 2 writes it, else 404.
Anything else, `project` and `level` included, is 400 `bad_request`. A reader Ask answers at team level (a user) is
refused with 403 `people_not_allowed` ("Only admins can see person cards."), after the board checks and before the
sample or the service is asked anything: users get no card.

| Field | Type | Meaning |
|---|---|---|
| `meta` | meta | |
| `person` | person | Whose card |
| `board` | `{key, name}` | The board read; its name as `GET /projects` gives it |
| `membership` | `"holds_tickets"` \| `"member_no_tickets"` | `holds_tickets`: at least one of the board's work tickets, in any status, counts for them (4.29: the directory's "With tickets"); `member_no_tickets`: someone on the board with none (a member, someone the setting names on none of its work, or someone assigned only Epics) |
| `work` | `{open_tickets, in_progress, done_in_period, days}` | Their scorecard's three counts over `days` (4.15), all over the tickets that count for them: open, in progress, and done in the period (`open_tickets` is `GET /people`'s too, Epics left out, JO-12, G5); each 0 for someone with none |
| `findings` | `{open_breaches, open_warnings}` | The open findings on every ticket that counts for them, finished ones too (as Ask's people view counts them, 4.6); each 0 for someone with no tickets. Findings filtered to them lists the tickets they are assigned now, so where the setting reads a people field the two can differ |
| `process` | `{closer, level, further, too_few, measurable}` \| null | Their scorecard's marks over `days` (4.15), counted over the measures that compare (the rates and the ratio) the board can show: `closer`, `level` and `further` the measures on which their figure stands so; `too_few` those on which they were not compared (too few tickets, theirs or the board's); `measurable` the four together. Null when they were compared on no measure: they have no tickets, or too few for every one |
| `in_progress_now` | `{key, summary, status, since}`[] | At most three of their tickets in progress now (the scorecard's `in_progress`), longest in progress first, then by issue number. `status` the status's name as Jira shows it; `summary` as Jira has it (empty when it has none); `since` when the ticket last went into progress: the start of the unbroken run of in-progress statuses it is in now (In Progress to In Review keeps it in progress; a ticket reopened from Done starts again; one never moved counts from its creation), read from its status history as sync stored it (derive's timeline, rebuilt by derive's own function, so a sync derive has not followed yet is never read as the status before it); null when that history ends outside progress though Jira says the ticket is in progress now (a change missing from it: when it went back into progress is not known), or when the ticket has no creation time (never for a ticket a sync stored): such a ticket is listed last, and the card shows no time for it |
| `in_progress_more` | count | How many more of their tickets are in progress than are listed: the two make `work.in_progress` |
| `other_boards` | `{key, name, open_tickets}`[] | Every other board the service serves on which they have open tickets (its work, not done, that counts for them by that board's credit setting, as its `GET /people` counts them), in the service's order; never the board read, nor a board where they have none open. This interface's server keeps only the boards the reader may open (an admin, or sign-in off: every board) before anything reaches the browser |
| `last_activity_at` | timestamp \| null | The latest status change or logged work (by when the work was done) on their tickets on the board; null when there is none, and for someone with no tickets |

The interface checks the body (`personCardSchema`): no more in progress than open; the tickets listed (each once,
longest in progress first, three at most, and as many as there are up to three) and `in_progress_more` making
`work.in_progress`; `process`'s four parts making `measurable`, and null exactly when nothing compared; the other boards
each once, never the board read, each with an open ticket; someone with no tickets with no figures at all; and,
against the request, the person, the period and (when it named one) the board asked for. A body that fails is 502
`upstream_invalid`, with the failing paths.

**The card** (`src/components/person-card/`, people level only). Wherever a person is named at people level: Ask's
mention chips in the question box, the pills in answers, the facts table and the everyone-in-order table; Findings'
Assignee column, the Person filter's chosen person and the drawer's assignee; the Overview's open findings by person;
the People page's table and its scorecard's heading; the ticket page's assignee; the access log's people. Not inside
the @ list itself or the People page's person picker, where the pointer picks a row, nor in a compact scorecard's
column heads (the answer's pills above it open the same cards).

- On a desktop (a pointer that hovers, a window 40rem wide or more), resting on the name (or the picture) for 350 ms
  opens the card beside it, as a hover card: below the name, or above it, where the whole card fits, else to its side,
  its top level with the name's; it stays while the pointer is on the name or the card, or on its way between them,
  curves and all (the smallest convex shape holding the whole name, the whole card and the side the pointer left by,
  96 px either side of where it left; on the straight ways from there to the card no other name's card opens), and
  closes 150 ms after it has left all three, or after it has stood still on the way for half a second. A press on the
  name (Enter or Space) pins it: a non-modal dialog, focus inside, a close button; Escape, the close button, a press on
  the name again or a press on the page closes it, and focus goes back to the name (a press on a field, a link or a
  button elsewhere keeps the focus it gave). In a pinned card, Tab leads through its controls, links included, in every
  browser; Shift+Tab from its start closes it and gives focus back to the name, and Tab past its last control closes it
  and moves on to what follows the name on the page. One card is open at a time: a pinned card holds while the pointer
  passes other names, and a press on another name moves it there. Presses and keys inside a card stay there: the row,
  the field or the tooltip its name sits in never hears them. In a table whose rows have their own press and one tab
  stop between them (Findings, the People table, Ask's facts), the name is a pointer's way in, out of the Tab order; the
  drawer's assignee, the scorecard's heading and the answer's pills are the keyboard's. On the access log's pills the
  press on the name is the filter's, and the picture at the pill's start is the card's own button (the keyboard's way
  in, and a tap's). Where the name sits inside a control that presses for something of its own (the Person filter, the
  ticket page's assignee, a link to their open findings), the card opens on hover alone and the press stays the
  control's. A name that opens a card has no tooltip of its own: the card says the whole name.
- A mention chip in Ask's question box (the product owner's own example, 12 Nov 2026), as Jira's editor treats a
  mention: a click (or a tap) on the chip opens the card anchored to it and pins it, and moves nothing in the question
  (not the caret, not a selection, not a character; Shift and a click still reach a selection to the chip). Escape,
  the close button or a click on the chip again closes it and gives focus back to the box with the caret just after
  the chip; a click in the text closes it with the caret where the click was. Resting on the chip for 350 ms opens it
  too. Enter still asks, Space still types a space, Backspace beside the chip still removes it whole, and nothing typed
  ever opens a card (a chip drawn under a resting pointer waits for the pointer to move).
- On a touch screen or a phone, a tap on the name opens the same card as a bottom sheet (the app's `Sheet`: the
  screen's width up to 40rem, its body scrolling between its header and its ways on); closing it gives focus back to the
  name.
- The card is read when it opens (the hover's intent, a press), never on a mere pass of the pointer, and kept fresh for a
  minute, so moving back and forth over a name costs nothing; never read again on focus or a reconnect.
- Top to bottom, 340 px wide: the 48 px picture, the size Jira gives it (the initials where there is none; 13 Nov
  2026, the product owner: at its source's size rather than stretched to the brief's 56 px), the name (never cut: it
  wraps) and
  one plain line ("13 open tickets on Demo project", "No open tickets on Demo project" for someone whose tickets
  are all done, "Member of Demo project · no tickets": the board by its name, as the top bar names it, its key in the
  tooltip); three figures (Open, In progress, Done in 90 days); "Open findings on their tickets" over the breaches and
  warnings with their severity marks (the findings on every ticket of theirs, done ones too, so they can outnumber the
  open tickets: said where everyone sees it); the process meter (the
  scorecard's sentence, "Closer to the process than the board on 5 of 8 measures.", a slim bar of closer, level,
  further and too few tickets in the neutral inks, never the status colours, and its key with each count; where nothing
  compared, one muted line in its place); what they are working on now, with when anything last happened on their
  tickets, in a framed list exactly as tall as its rows, in a section with the room of three (the key leading to the
  ticket, the status, how long it has been in progress as of the snapshot, the summary on one line; "and 4 more" at the
  section's foot, leading to Ask's list of everything they work on; nothing in progress, one muted line); the other
  boards they have open tickets on ("Also on OPS (3 open) · WEB (1 open)", each one the top bar can open switching to it
  and opening their scorecard there; as many as fit whole on the line, then "+2 more", named in full in its tooltip and
  to a screen reader; where the reader has more than one board and they have nothing open elsewhere, it says so); and
  the ways on: View scorecard (the People page, over the card's period), Open findings (Findings filtered to them; none
  for someone with no tickets), Ask about them (Ask with their chip in the question box, nothing asked:
  `/ask?about=<id>`; on the Ask page itself the chip joins the question being written, the answer on screen and the
  address kept, and someone already in the question gets no second chip, the caret going just after theirs), three
  equal cells never cut short (a long first name wraps).
- A card read on another board than the top bar's (an access log entry's, `board` above) is about that board
  throughout: its picture is read there (`?board=`, 4.13), and every link on it (the ways on, a ticket's key, "and 4
  more") picks that board before it opens, as the Portfolio's links do (a whole page load; a new tab or window opens on
  that board, this page staying as it is), so it never leads to a page that disagrees with it.
- Every part has a fixed height, and while the card loads the same parts stand in the same places (the name, the
  picture and the ways on at once, placeholders for the figures): nothing moves when the figures arrive. A person not on
  the board, a board the service does not serve, and a read the access log could not record (with Try again), are said
  in plain words in the same space; the line under the name is then empty, never a placeholder, and a 404's ways on are
  shut (each would only say the same).
- It fades in as it rises 4 px, in 120 ms; nothing moves with reduced motion. Never an email address, an account id, a
  time zone or Jira's picture address; names are text.

### 4.20 `GET /rules/settings`

A board's rule settings (JO-15, 17 Nov 2026): until now a rule's threshold lived only in `config/rules.yaml`, and
changing one meant editing YAML on the server. An admin now changes, per board, from this dashboard: a rule **on or
off**, its **severity** (`breach` | `warning`), and its **thresholds** within safe bounds, with a preview of what a
change would do (4.21), an audit trail of every change (who, when, what, why), the board's findings re-checked at
once after a save (4.22), and undo. rules.yaml stays the catalogue: every rule's definition and the defaults every
board starts from; a board's settings are overrides the service keeps in its snapshot database (so the daily backup
holds them, and deleting the snapshot to resync deletes them unless restored from a backup). Nothing here writes to
Jira. People level only; board-scoped (`?project=`, section 2); `Cache-Control: no-store`.

Since JO-20 (23 Nov 2026) an admin also **adds rules of the board's own**: each uses one of the service's checks
(the code that looks at tickets, from one registry, below) with its limits, the statuses and issue types it looks
at, and how serious it is, and is named by the admin; they edit and delete them, with the same preview, history and
undo. An AI can draft one from the admin's words (4.23), never saving it: the draft fills the form, and only a save
after the review adds the rule. A board holds at most 50 custom rules.

**Request, interface to service.** `project` (added by the interface: the board picked in the top bar, held to the
reader's boards as everywhere), `level` (`people`: the interface asks only for a reader it decides may; `team`, or
none, is 403 `{"detail", "code": "people_level_only"}`, and any other value 422), and the reader's
`X-Oversight-Viewer` and `X-Oversight-Viewer-Name`
(4.16), read exactly as the access log reads them (none, or a hash that is not one, is 422). Any other parameter, or
one given twice, is 422; a `project` the service does not serve is 404 `unknown_board`.

**Request, browser to interface.** `/api/oversight/rules/settings`, no parameters (400 for any). A reader Ask answers
at team level (a user) is refused with 403 `people_not_allowed` ("Only admins can see rule settings.") before the
sample or the service is asked anything; the page answers them with the not-found page.

| Field | Type | Meaning |
|---|---|---|
| `meta` | meta | As everywhere (`rules_version` the catalogue's); `last_synced_at` null for a board that has never synced, whose settings can still be set |
| `project` | project key | The board read |
| `revision` | count | The board's settings revision: its latest change's (1, 2, 3 ...), 0 while it has never been changed |
| `catalogue_version` | string | rules.yaml's `version` |
| `updated_at` | timestamp \| null | When the latest change was made; null exactly at revision 0 |
| `updated_by` | string \| null | Who made it, by the name the access log keeps for them (4.16; never an email address: one reads as `Signed-in user`); null exactly at revision 0 |
| `apply` | apply | Whether the board's findings reflect the settings yet (below) |
| `rules` | rule[] | Every catalogue rule, on or off, in catalogue order, as the board runs it, then (JO-20) the board's own rules in the order they were added, deleted ones left out (below) |
| `history` | change[] | The board's changes, newest first, at most 50; the first is the board's revision |
| `checks` | check[] | (JO-20) The checks a custom rule may use on the board, in the registry's order, each with the board's own options (below) |
| `issue_types` | string[] | (JO-20) The issue types the board's issues have, which a rule may be held to: Epic, where it is offered, last. Absent from a service that predates it: read as none |
| `custom_limit` | count | (JO-20) The most custom rules a board holds: 50 |
| `custom_count` | count | (JO-20) The board's custom rules, deleted ones left out |
| `ai_draft` | `{available, reason}` | (JO-20) Whether an admin can describe a rule for the AI to draft (4.23): `available` with the live model and with the service's scripted drafter (`LLM_MODE=stub`, and the sample); not once the day's AI budget is used up, `reason` saying so in plain words ("Today's AI budget is used up. You can still add a rule by hand."), else null |

**Apply** `{state, applied_revision, started_at, finished_at, message, result}`: `applied_revision` the highest
settings revision among the board's latest succeeded rules runs (0 when none applied one: from the service's runs, so
still right after a restart); `state`, decided in this order: `running` while the service re-checks the board after a
save (queued behind a sync, or under way); else `applied` once `applied_revision` has reached `revision`, a re-check
that failed and a later run made up for included; else `failed` when the service's last re-check of the board failed
(`message` says so, and that the next sync applies the settings anyway); else `pending` (it applies at the next sync
or re-check; `message` says what that means for the reader: "The board's findings still show its earlier settings
until the next sync applies these."); `started_at` and `finished_at` the re-check's (or the rules run's that
applied the revision; null where unknown); `result` `{opened, closed}`, what that run opened and closed on the board
(closed counting every way: `settings_changed`, `cleared`, `superseded`, aged out), null where unknown. The scheduled
cycle's own `rules` step reads the settings too, so a board whose re-check failed is put right by the next sync.

**Rule** `{rule_id, title, description, kind, check, scope, escalates_to, enabled, default_enabled, severity,
default_severity, params, customised, measurable, missing_evidence, open}`: `check` rules.yaml's (which decides what its
thresholds mean); `scope` `issue` or `sprint`; `enabled` and `severity` the board's, `default_enabled` and
`default_severity` rules.yaml's; `params` its editable thresholds only (the registry below; `[]` for a rule with none);
`customised` whether anything of it differs from rules.yaml on the board; `measurable` and `missing_evidence` as
`GET /rules` says them for the board (4.9); `open` its open findings on the board. JO-20 adds `check_label` (its
check in plain words, from the registry), `custom` (whether an admin added it), `applies_to` `{status_category,
issue_type}` (the status categories it looks at, `new` \| `indeterminate` \| `done`, none for a sprint's rule; and
the issue types, or null for every type but Epic: the catalogue's rules read as their checks always have), and
`created_at` and `created_by` (when and by whom a custom rule was added, by the name the access log keeps; null for
a catalogue rule). A custom rule's `params` are every param of its check, its choices among them (below); its
`default_enabled` and `default_severity` and each param's `default` are its own as it was added or last edited, so
it is never `customised` and has no Reset; its `description` is the admin's, or empty.

**Param** `{name, label, unit, value, default, min, max, step}`: `label` its words ("Effort ratio"), `unit` `ratio`
\| `hours` \| `percentile` \| `days` \| `share` (a share travels as a fraction, 0.3, and is shown and typed as a
whole percentage, 30%), `value` the board's, `default` rules.yaml's (or the check's own default where rules.yaml leaves
it out), `min` and `max` the bounds, both included, and `step` how far the field moves. The thresholds an admin may set
are these, by the rule's check, and no others: structural params (a stage, an evidence source) never are, nor is
anything else of a rule (its kind, title, scope, escalation) or the catalogue's defaults (look-back, history days,
excluded types), which stay in rules.yaml.

| Check | Param | Meaning | Min | Max | Step | Default |
|---|---|---|---|---|---|---|
| `estimate_after_start` | `grace_hours` | hours of grace after work started | 0 | 168 | 0.5 | 1 |
| `effort_ratio_at_least` | `threshold` | logged effort ÷ estimate (×) | 0.1 | 10 | 0.05 | rules.yaml's |
| `stuck_in_status` | `pct` | percentile of the board's closed time in the status | 50 | 99 | 1 | 90 |
| `no_evidence_after_percentile` | `pct` | percentile of the board's time in the stage | 50 | 99 | 1 | 75 |
| `sprint_at_risk` | `days_left` | days left in the sprint | 0 | 14 | 0.5 | 2 |
| `sprint_at_risk` | `not_started_share` | share of the sprint's issues not started | 0.05 | 0.95 | 0.05 | 0.3 |

A value is a finite number (never a boolean or a string) within its bounds with at most four decimal places
(`RULE_PARAM_REGISTRY` in `src/lib/api/schemas.ts` mirrors the service's registry). The cross-rule rule: a warning
that escalates to a breach rule of the same check, both with a `threshold` (today W-EFF-01 to R-EFF-01), keeps its
threshold strictly below the breach rule's while both are on the board.

JO-20 gives each param a `kind` and its `options`: `number` (the threshold above: `unit`, `min`, `max` and `step`
set, `options` null; a param read without a `kind` is a number, as JO-15's were), `statuses` (a non-empty list of the
board's status names), `stage` (one of the stages the board maps), `evidence` (one of process.yaml's evidence names)
or `field` (`assignee`, `estimate`, `epic` or `sprint`). A choice's `value` is a name or, for `statuses`, a list of
them; its `unit`, `min`, `max` and `step` are null and its `options` the board's: `{value, label, category}`, a
status with its category, anything else with `category` null. Only a custom rule has choices.

**Check** `{name, label, summary, scope, params, categories, default_categories, measurable, missing_evidence}`
(JO-20): what a custom rule may use, from the service's one registry, which reuses the thresholds' (same names and
bounds): `label` two to five plain words, `summary` one plain line (at most 90 characters); `params` each `{name,
label, kind, unit, min, max, step, default, options}` (a number's unit, bounds, step and default; a choice's options
from the board, as above, its default null or the board's); `categories` the status categories it may look at and
`default_categories` those it looks at unless told (none for a sprint's check); `measurable` and `missing_evidence` as
for a rule, on the board. The checks, their params and the categories they may look at (the default ones in
brackets):

| Check | Params | Categories |
|---|---|---|
| `time_in_status_over` | `statuses` (at least one), `hours` 1 to 8760 | new, indeterminate (indeterminate) |
| `open_longer_than` | `days` 1 to 3650 | new, indeterminate (both) |
| `no_update_for` | `days` 1 to 365 | new, indeterminate (indeterminate) |
| `missing_field` | `field` | any (indeterminate) |
| `missing_estimate` | none | indeterminate, done (both) |
| `estimate_after_start` | `grace_hours` | indeterminate, done (both) |
| `effort_ratio_at_least` | `threshold` | indeterminate, done (done) |
| `entered_stage_without_evidence` | `stage`, `evidence` | any (all) |
| `skipped_stage` | none | any (all) |
| `reopened` | none | any (all) |
| `in_progress_unassigned` | none | indeterminate (indeterminate) |
| `stuck_in_status` | `pct` | new, indeterminate (both) |
| `no_evidence_after_percentile` | `stage`, `evidence`, `pct` | indeterminate (indeterminate) |
| `unestimated_in_active_sprint` | none | new, indeterminate (both) |
| `sprint_at_risk` | `days_left`, `not_started_share` | the active sprint: no status or type |

The first four are JO-20's own: a ticket in one of the chosen statuses (any case) for longer than `hours` ("In 'Code
Review' for 3.4 days; the limit is 3 days"), one not done created more than `days` ago, one not done that Jira has
not changed in more than `days`, and one with no assignee, estimate (on the board's basis), epic (its own, or its
parent's for a subtask) or sprint. A status that leaves Jira later makes a rule check nothing for it, never an error.

**Change** `{change_id, at, revision, by: {hash, name}, reason, undo_of, changes}`: `change_id` 32 hexadecimal
characters; `revision` the board's revision it made; `by` the viewer, as the access log names them; `reason` the
admin's words or null (at most 500 characters, never an email address or an account id; an address in one reads
`(email address removed)` on the page); `undo_of` the change it undid, or null; `changes` each field it set,
`{rule_id, field, from, to}`, `field` `enabled`, `severity` or `params.<name>`, `from` and `to` the values the board
ran before and after it (effective, never null: "1.5 → 2"). JO-20 adds a custom rule's own: `field` `rule` for a
rule added (`from` null), deleted (`to` null) or brought back by an undo (`from` null, the entry's `undo_of` set),
the other side its definition in plain fields, `{title, description, check, params, applies_to, severity}`;
`title`, `description` (null for none) and `applies_to` for an edit; and `params.<name>` for a choice too (a name, or
a list of statuses, the same kind on both sides).

The interface checks the body (`ruleSettingsSchema`): when and by whom exactly when the revision is above 0; each rule
once; `customised` saying whether anything differs from its defaults (a catalogue rule's: a custom rule has none); a
param of one kind, a number with its bounds and step, a choice with its options; the history newest first, headed by
the board's revision, each field change of its field's kind and changing something, a `rule` change one side none;
`apply.state` applied only once
`applied_revision` has reached the revision and pending only before it; and, against the request, the board asked
for. A body that fails is 502 `upstream_invalid`, with the failing paths. A value or default outside its bounds is
passed on (rules.yaml may set one the bounds leave out): the page says so beside the field.

**The page** (Governance, `/governance/rules`; people level only, `g` then `r`; anyone else gets the not-found page,
and the Process page links to it for an admin, 4.9):

- The header: "Rule settings" and its purpose; a status line with the board by its name (its key beside it), "Revision
  3 · last changed 2:10 PM, 17 Nov 2026 by Morgan Ellis" (the 12-hour clock in the reader's zone, the date in full, no
  zone named) or "No changes yet: every rule runs as the catalogue sets it.", and from the first change a chip: Applied
  (with what the re-check did, "4 closed, 0 opened"), Re-checking… (a line sweeps along its foot; nothing spins),
  Will apply at the next sync, or Couldn't re-check (the warning mark, with the service's words under it). The status
  is a live region: a save, its re-check and a change made elsewhere are said as they happen.
- The rules in two groups, "Hard and fast rules" (kind `rule`) and "Early warnings" (kind `warning`), catalogue order,
  each a row: its id (with "Customised" when it differs from rules.yaml, and "Edited" while the draft changes it), its
  title, "What it checks" (its description, on demand), an On/Off switch, a Breach/Warning segmented control, its
  thresholds inline as the sentence its check reads as ("Flag when effort ≥ [1.5 ×] the estimate", "Grace of [1 h]
  after work starts", "Above [p 90] of the board's closed time in the status", "≤ [2 days] left and > [30 %] not
  started"), under it "Default 1.5×" (or what is wrong, in its place), "Reset to default" while it differs from the
  catalogue, its open findings (a link to them in the accent; a dash for a rule that cannot run), and for a rule the
  board cannot measure "Not measurable on this board: Jira holds no code review evidence. Its settings apply once it
  can run." (still editable). Where the list is 56rem wide (a MacBook's sheet) a row is one line under column heads;
  narrower, its parts stack. Each control is named by its rule (the switch "Effort far beyond the estimate On this
  board", the severity "…: reported as", a threshold by its rule and its label); a threshold is a spin button with its
  bounds, stepped by the arrow keys (Shift or Page Up and Down for ten steps, Home and End for the bounds), read
  leniently (a decimal comma counts).
- Edits are a draft. A sticky bar rises at the foot once anything differs, "3 unsaved changes · Discard · Review and
  save" (⌘↵, Ctrl+Enter elsewhere), its room kept whether it shows or not, so nothing moves. What cannot be saved is
  said beside its field (a value outside its bounds, more than four decimals, an emptied field once left, a warning
  that would no longer come before its breach) and holds the review back, the first such field taking the focus.
  While the bar shows, a control the keyboard reaches stops above it, never under it. Leaving with unsaved changes
  asks first: the browser's own question for a reload, a closed tab or a board picked in the top bar; the page's own
  ("Leave without saving?", "Keep editing" focused) for a link, the `g` shortcuts and the palette. A board picked in
  another tab meanwhile (the pick is a cookie every tab shares) is said on the page, and nothing is sent until it is
  loaded again.
- **Review and save** (a dialog, opening at its top with the dialog itself focused): each change, rule by rule,
  "Effort ratio 1.5× → 2×"; what they would do to the board's open findings, from the service's preview (4.21), rule
  by rule: closes, opens, stays open, with up to five tickets each way as links to their pages (in a new tab, so the
  draft stays), a list of five with more findings that way than it names ending "and more" (never how many: the counts
  are of findings, and a ticket may hold more than one), and the service's note for a rule it cannot run; a severity change says its open findings are
  re-filed under the new severity (closed and opened again) and lists their tickets once, as "Re-filed"; an optional
  reason (500 characters, counted, no email address) kept until the changes are saved or discarded; and "Save and
  re-check" (⌘↵ from any control in the review), busy while it saves. What a save comes to when it does not go
  through is said under the title, in view however far the body was scrolled: a save someone else's overtook (409),
  with Reload, which keeps nothing; the service's refusal of a setting (422), each setting it refused by rule, field
  and the service's words with "Edit R-EFF-01" (the review closes and that field takes the focus), and beside the
  field too (the review closes on the first when every problem has a field); of the reason, with a way to it, and
  under the reason; a save that failed. Closed, the review gives the focus back to what opened it.
- Saved: a toast, "Saved. Re-checking DEMO…", the focus on the status, the chip Re-checking… then Applied, the
  settings read every 2 s while the re-check runs and not otherwise (by the shell once the page is left), and when it
  ends every figure the rules decide read afresh (the catalogue, the Overview, Findings, people and their cards, the
  Portfolio, the weekly series, the ticket pages), whichever page the reader is on by then.
- **History**: every change newest first: "Revision 3 · 2:10 PM, 17 Nov 2026 · Morgan Ellis", the reason, and each
  field it set; the latest has **Undo**, which asks first ("Undo revision 3?", "Keep it" focused) and then saves the
  inverse of each field with `undo_of` set and the reason "Undo of revision 3"; an entry undone says "Undone in
  revision 4", and the undo "Undoes revision 3". Undo is held back while the page has unsaved changes.
- Loading keeps the final shape (the status, both groups' rows, the history), and an error is said once, in place,
  with Try again. Never an email address, an account id or a zone's name.

**Custom rules on the page** (JO-20):

- **Add rule** stands in the page's header beside Copy link (and in the empty "Custom rules" group), held back once
  the board holds its 50 custom rules, its tooltip saying why ("This board has 50 custom rules, the most it holds.
  Delete one first."). It opens the **New rule** sheet from the right (the screen's width on a phone): "For Demo
  project only. Nothing is saved until you review and save."
- **Describe it** (optional), while `ai_draft.available`: a text area (its placeholder a request on the board's own
  names, its bugs or tickets in its first status in progress: "Bugs in progress for more than 3 days" on DEMO, "Bugs
  in Code Review for more than 3 days" on a board with a Code Review status; 500 characters, counted) and **Draft
  with AI** (⌘↵ in the text area), busy while it works. What came of it is said under it in a live region: "Drafted
  by AI. Check it before you add it." with the AI's explanation (not when the AI wrote the same words as the rule's
  description, which says them already), the form below filled in, and each problem the service still found said at
  its field ("1 field needs a fix.", counted down as each is put right), one at no field of the form under it (a
  field the draft left out stays empty). Once the admin changes what the drafted rule flags (its check, settings,
  statuses or issue types; not its name, description or seriousness), the line reads "Drafted by AI, then changed.
  Check it before you add it." and the explanation goes, since it described the draft; a name or description still
  in the AI's words says "From the AI's draft: check it still fits your changes." under it until it is changed.
  "Can't make that rule." or "Didn't understand that." with the service's note (the closest check), the form left as
  it was; "AI drafts aren't available right now." with the service's note, which says the rule can still be added by
  hand; a draft that failed, with why; fewer than 3 characters, said and nothing sent. With `ai_draft` not available
  the section is a small line with the reason instead.
- **The form**: Name (3 to 80 characters of plain text, counted as kept, with a letter or a figure in it, its own on
  the board however it is written: any case, look-alike forms and unseen characters aside); What to check (the checks by
  label, the summary under it, one the board cannot measure marked with why); the check's settings by kind, a number
  in its unit with its bounds ("From 1 h to 8,760 h. That is 3 days."), the board's statuses as a searchable
  multi-select, a stage, evidence or field as a select; Applies to: To do, In progress and Done as checkboxes, only
  those the check allows, and the issue types as a multi-select, "All types" (which leaves out Epics) by default; a
  sprint's check says it looks at the active sprint; How serious: Breach or Warning; Description (optional, 300
  characters). Picking a check sets its settings to their defaults. What cannot be saved is said at its field, as the
  service says it, once the field is left or the form is sent, and the first such field takes the focus. **Add to
  changes** (⌘↵ anywhere in the form) puts the rule in the page's draft; nothing is sent. Closed (Cancel, Escape, the
  close button), the sheet gives the focus back to what opened it, and the next opening is a fresh form.
- **The Custom rules group**, after the catalogue's two: each custom rule a row as any rule's (its switch, its
  severity, its settings inline as its check's sentence, "Stays in “In Progress” for over [72] h", what it looks at under
  it, "Bug · In progress", its open findings) with a "Custom" badge, its check's label, and **Edit** (the sheet, its
  check locked: "To use another check, delete this rule and add a new one."; its switch and severity stay on its row)
  and **Delete** (the row struck through and read only, "Deleted when you save", with **Keep**). A rule added and not
  saved is a row of its own marked "New", with Edit and **Discard**. Each counts in the bar as one change, a custom
  rule's edit as each field it changes. A rule edited in the sheet and switched or set to another severity on its row
  in the same draft holds the review back, said beside it ("Save the edit first, then change its On/Off or
  severity."), since a save changes a rule one way (4.21).
- **Review and save** lists a new rule with what it checks, its settings, what it looks at, how it is reported and its
  description, and from the preview "Would raise 12 findings now." with tickets; a deletion "Deleted. Its open
  findings close; an undo brings it back." with "Would close 5 findings."; an edit field by field ("Name “Bugs in
  progress over 3 days” → “Bugs in progress over 4 days”"). A refusal of a new rule's field names it by its name
  ("New Bugs in progress over 3 days · Name: …") with "Edit the new rule", which opens its sheet with the problem at
  the field.
- **History**: "R-CUS-01 Added rule “Bugs in progress over 3 days”", "Deleted rule …", "Brought back rule …", each with
  its definition under it ("Time in a status · Stays in “In Progress” for over 3 days · Bug · In progress · Breach"), and an
  edit field by field. Undo of the latest change deletes a rule it added, brings back one it deleted ("Brings back rule
  …" in its question), and edits an edited one back.

### 4.21 `POST /rules/settings/preview`

What changes to a board's rule settings would do to its open findings, worked out by the service against the board's
data as of its last sync with the engine's own code (the same function evaluates a rule for a run and for a preview),
through a read-only connection: nothing is written. People level only; board-scoped; `Cache-Control: no-store`.
Request, interface to service: as 4.20 (`project`, `level`, the viewer), and a JSON body of at most 16 KB:

```jsonc
{ "changes": [ { "rule_id": "R-EFF-01", "params": { "threshold": 2 } }, { "rule_id": "W-AGE-01", "enabled": false } ] }
```

**A change** `{rule_id, enabled?, severity?, params?, reset?}` names one rule and any of `enabled`, `severity` and
`params` (some of its editable thresholds, by name), or `reset: true` alone (back to rules.yaml for that rule). The
service validates the changes exactly as a save (4.22), the revision apart: 422 `rule_settings_invalid` otherwise.

JO-20 adds four, each with an `op`, for the board's own rules; the setting change above works on a custom rule too
(its switch, its severity, its numbers), never with `reset` (a custom rule has no catalogue to go back to):

- `{"op": "create", "rule": {title, description?, check, params, applies_to, severity}}`: a new rule. The service gives
  it its id (`R-CUS-nn` for `breach`, `W-CUS-nn` for `warning`, kind `rule` or `warning` with it, which stays). `params`
  every param of the check, by name (a number, a name, or a list of statuses), and no other; `applies_to`
  `{status_category, issue_type}` (none for a sprint's check; `issue_type` null for every type but Epic).
- `{"op": "edit", "rule_id", title?, description?, params?, applies_to?}`: a custom rule's definition changed (at least
  one field), its check never (delete and add again). Its switch and severity are a setting change's, never an
  edit's: a request names each rule once, so a rule's edit and its switch or severity are saved one after the other
  (the page holds a save back while its draft has both, 4.20). Its numbers alone may travel in a setting change too.
- `{"op": "delete", "rule_id"}`: a custom rule deleted (kept by the service, so an undo can bring it back).
- `{"op": "restore", "rule_id"}`: a deleted custom rule of this board brought back, as an undo of its deletion.

A title and a description are kept as plain text: control characters read as spaces; what shows nothing is taken out
(format characters such as a zero-width space or joiner, a soft hyphen or a direction mark; default-ignorable ones
such as a Hangul filler; lone surrogates, private-use and unassigned code points); each compatibility form becomes its
plain one (NFKC: a fullwidth "Ｓ" is "S"); spaces collapse and the ends are trimmed. A title is then 3 to 80
characters, with at least one letter or figure in it, and its own on the board among every rule's, compared as kept
and casefolded, so "Ｓtuck in a status" and "Stuck in a status" with a zero-width space in it are both "Stuck in a
status"; a description at most 300 characters. Statuses and issue types are the board's (any case, kept in the board's
spelling, never made plain: Jira's names are compared as Jira wrote them); categories at least one, each one the check
allows; a board holds at most 50 custom rules. One request names each rule at most once; its new rules are counted in
the order it lists them.

| Field | Type | Meaning |
|---|---|---|
| `meta` | meta | As 4.20 |
| `project` | project key | The board read |
| `revision` | count | The board's settings revision the preview was worked out against |
| `impact` | impact[] | Each rule whose settings the changes change, in catalogue order |
| `totals` | `{would_open, would_close}` | The sums of the rules' |

**Impact** `{rule_id, measurable, open_now, would_open, would_close, would_stay, examples: {open, close}, note}`:
`open_now` its open findings now; `would_close` those that would close (as `settings_changed`, or `superseded` by a
severity change; a rule turned off closes them all), `would_stay` those that would stay open as the same findings
(`would_close + would_stay = open_now`), `would_open` the findings that would open (new ones, and closed ones that would
reopen); `examples` up to five issue keys each way (a sprint as `sprint:<id>`), issues by number, then sprints;
`note` `"Not measurable on this board, so this change has no effect until it can run."` for a rule left on that the
board cannot measure and that would close nothing, else null. A new rule (JO-20) is listed under the id it would be
given, after the board's rules, in the order the request lists the new rules (the page matches them back by that
order), `open_now` 0 and `would_open` every finding it would raise now; a deleted one, `would_close` its open
findings; an edit, as any change.

**Request, browser to interface.** `/api/oversight/rules/settings/preview`, no parameters (400 for any), from this
dashboard's own pages (its `Origin`, below) as JSON. The body is checked against the contract before anything is
forwarded (`ruleSettingsPreviewRequestSchema`: one change per rule, at least one and at most 64, each threshold one the
registry names, within its bounds, with at most four decimals, a reset alone, no field the contract does not name)
and rebuilt from what was checked: the service never receives the browser's own body. A body that fails is 422
`rule_settings_invalid` with each problem at its setting (`issues`: `{path: "R-EFF-01.params.threshold", message}`;
`"R-EFF-01"` for a change as a whole, `"reason"` for the request's own fields, `"(settings)"` for the request as a
whole, as the service's refusals are named, 4.22; JO-20: a new rule's field as `"new-0.title"`, the first new rule
the request lists being `new-0`). The interface checks a custom rule's change against the registry it shares with the
service (`CHECK_REGISTRY` in `src/lib/api/schemas.ts`: the check, every param of it and no other, a number within the
check's bounds with at most four decimals, a stage, evidence name or field from the registry's, categories the check
allows), the title and description as plain text (their lengths, a letter or figure in the title) and forwarded so,
and two new rules never with one name (compared as the service compares names); what only the board knows (its
statuses and issue types, a name already taken, the 50 limit) is the service's to say.
A reader Ask answers at team level is refused with 403
`people_not_allowed` ("Only admins can change rule settings."); a request from anywhere else, or that is not JSON,
with 403 `forbidden` (section 6), before the body is read or anyone is asked anything.

### 4.22 `POST /rules/settings`

Saves changes to a board's rule settings, then re-checks its findings. People level only; board-scoped;
`Cache-Control: no-store`. Request, interface to service: as 4.21, the body:

```jsonc
{ "revision": 3, "changes": [ ...as 4.21... ], "reason": "Agreed with James", "undo_of": "<change_id>" }
```

`revision` the board's revision the changes were made against; `reason` optional (at most 500 characters, kept as the
access log keeps a name, never holding an email address or an account id); `undo_of` optional, the change this one
undoes (a change of this board; it is recorded only).

- **409** `{"detail", "code": "rule_settings_conflict"}` when `revision` is not the board's: someone else changed its
  settings since. Nothing is written.
- **422** `{"detail", "code": "rule_settings_invalid", "errors": [{rule_id, field, message}]}` for any problem, all or
  nothing: an unknown rule; a threshold not editable for the rule; a value out of bounds or not a number; a reset with
  anything else; a rule named twice; no change; a change that changes nothing (every value already the board's); a
  reason too long or holding an address; an `undo_of` that is no change of the board's; the cross-rule rule (4.20),
  in the words the page and the sample use too, the other rule's threshold in its unit: on the warning "Must stay below
  R-EFF-01's 1.5× while both are on: the warning comes first.", on the breach "Must stay above W-EFF-01's 0.8× while
  both are on." (`CROSS_RULE_WORDS` in `src/lib/api/schemas.ts`). `field` is, beside a `rule_id`,
  `enabled`, `severity`, `params.<name>`, `params` (its thresholds as a whole), `reset`, or the name of a key a change
  does not take (`title`, at most 40 characters); with no rule, `rule_id` (a change that names none, or one that is
  not an id), `changes`, `revision`, `reason`, `undo_of`, or the name of a key the request does not take (at most 40
  characters); null where none. `detail` is every message in one. Nothing is written.
- **503** `{"detail", "code": "rule_settings_busy"}` when a rules run holds the board's write lock past the service's
  wait. Nothing is written; trying again in a moment will do.
- Otherwise, in one write transaction, the revision is checked again, the board's rows are written (a field set back to
  rules.yaml's value is kept as none, a rule with nothing left is dropped) and the change is recorded with the next
  revision, the viewer, the reason, each field's effective values before and after, and `undo_of`; then the board's
  re-check starts (the service's `rules --project KEY`, as "Sync now" runs its steps, never overlapping a sync in the
  same process: queued right after one that is running), and the answer is **200** with the board's settings as 4.20
  gives them (the new revision, `apply` running or pending). One app log line names the board, the revision, the rule
  ids and the fields changed (no name, no value). "Sync now"'s own state (`/refresh`) is unchanged.

JO-20's changes (4.21) are saved in the same transaction, all or nothing. The 422 also names: an unknown check, a
param missing or one the check does not have, a number out of its bounds, a status, stage, evidence name, field or
issue type the board does not have, no category or one the check does not allow, a title too short, too long or
another rule's on the board, a description too long, the board's 50th custom rule exceeded, an edit, a delete or a
restore of a rule that is not one of the board's custom rules (deleted, for a restore), an edit naming `enabled` or
`severity`, and a `reset` of a custom rule. A new rule has no id yet, so its problem is named by its place in the
request: `rule_id` null and `field` `changes.<index>.rule.<field>` (`changes.1.rule.params.days` for the days of the
second change, a create), or `field` the new rule's own (`title`, `params.statuses`) with `index` beside it (its
change's place in `changes`, counted from 0, as FastAPI's own `loc` counts it; `field` null for the new rule as a
whole, the 50 limit), or FastAPI's own `loc`; each problem once, and `detail` each message once. A request that adds
two or more rules must be answered so: a field with neither an index nor its place says nothing of which new rule it
is. A create gives the rule the next id of its kind across every board; a delete keeps its row
(deleted, never removed); a restore brings it back under the same id. The history records each as 4.20 says (`rule`,
`title`, `description`, `applies_to`, `params.<name>`), and an undo of the latest change sends the inverse: a delete
for a rule it added, a restore for one it deleted, an edit back for one it edited.

**What a change does to findings** (the service's rules engine; the sample's is held to the same): a finding is the
condition on its ticket, not the threshold. Its id is sha256 of the rule, the rule's version, the issue and the
evidence key (section 2), and a rule's version is the catalogue's unless the board's severity differs (`0.1.0+breach`):
so only a severity change gives a rule new finding ids; turning it off and on, or moving a threshold, never does, and
the evidence keys are built from rules.yaml's values. A ticket over both an old and a new threshold stays the same
finding (first seen when it was; its message and evidence refreshed with the new threshold); an open finding the new
settings no longer raise closes as `settings_changed` (never as `cleared`, which would read as a fix; where both the
data and the settings changed, it is never claimed as one); a rule turned off on the board closes its open findings
as `settings_changed`; a severity change supersedes the rule's open findings (`superseded`) and opens one under the new
version for each current hit; turning a rule back on, or a threshold back, reopens the same ids with their first
sighting. With no settings, every board runs exactly as it did before JO-15.

A custom rule (JO-20) runs on the board's data as of now: the re-check after its save opens its findings, first seen
then. Its identity version is `c<the revision that created it>`, with `+<severity>` while its severity differs from
the one it was added with, so again only a severity change gives it new ids. What it looks at (`applies_to`) counts
with its params as its settings: a finding it stops raising because the admin narrowed it, or raised its limit,
closes as `settings_changed`, never `cleared`; a deleted rule's open findings close as `settings_changed`, as a rule
turned off; an undo of the deletion brings back the same id and identity, so the same findings reopen with their first
sighting kept.

**Request, browser to interface.** `/api/oversight/rules/settings`, no parameters, as 4.21: from this dashboard's own
pages, as JSON, checked (`ruleSettingsSaveRequestSchema`: as 4.21, the revision a whole number, the reason at most 500
characters as the service counts them with no email address, `undo_of` 32 hexadecimal characters) and rebuilt (the
reason trimmed, and left out when blank). The interface waits 30 s for a preview or a save (a read waits 15). The
service's 409 is passed on as 409 `rule_settings_conflict` in this interface's words; its 422 as 422
`rule_settings_invalid`, each problem at its setting (`R-EFF-01.params.threshold`, `R-EFF-01.params` for its
thresholds as a whole, `R-EFF-01` for the rule as a whole or a key its change does not take, `new-0.title` for a new
rule's field (JO-20: `changes.<index>.rule.<field>`, a field with its `index`, or FastAPI's `loc`, mapped to the new
rule's place among the request's new rules, `new-1.params.days` for the second; an `index` alone, `new-1` for that
rule as a whole; a new rule's field named with no rule and no index, the request's one new rule's, or the settings as
a whole when it adds more than one), `reason`, or `(settings)` for the settings as a whole, a `rule_id` problem with no rule
and a key the request does not take among them), the service's own words passed on only when they are plain (one line, at
most 300 characters, no markup, no address, no email address; at most 24), never its body; its 503
`rule_settings_busy` as 503 `upstream_unavailable` ("The rules are running on this board right now. Try again in a
moment."); a 200 is checked as 4.20's, against the board asked for. Never retried by the page: a save that failed on
its way back may have been made, and the same revision would then be refused.

### 4.23 `POST /rules/settings/draft`

An AI draft of a new rule from an admin's words (JO-20, 23 Nov 2026): "Bugs in Code Review for more than 3 days"
becomes a rule built only from the board's checks (4.20) and its own names, or a plain reason why it cannot. The model
is the service's own (Claude through Amazon Bedrock, `LLM_MODEL_QA`), or with `LLM_MODE=stub` its scripted drafter,
which drafts from keywords, offline. **Nothing is saved**: the draft fills the New rule form, the admin checks it,
sees the preview, and only a save (4.22) adds the rule. People level only; board-scoped; `Cache-Control: no-store`.

**Request, interface to service.** As 4.21 (`project`, `level`, the viewer), and a JSON body of at most 16 KB:

```jsonc
{ "text": "Bugs in Code Review for more than 3 days" }
```

`text` is 3 to 500 characters once trimmed, control characters removed, with no email address or Atlassian account id
in it (422 `rule_settings_invalid` on `text` otherwise: the words go to the model); the service treats it as data,
never as instructions. The model is sent the admin's words, the board's checks and its names (its statuses with their
categories, issue types, the stages it maps, the evidence names, its estimate basis), never a ticket, a person or a
figure. The service writes no settings: only its model calls' audit rows (purpose `rule_draft`, which Governance's
usage counts, 4.17). The day's AI budget used up answers `unavailable` without a call; a refusal or a model error
answers `unavailable` too, never a 500; a reader over the service's limit on questions (`ASK_RATE_LIMIT`, where set)
is 429 `{"detail", "code": "ask_rate_limited"}` with `Retry-After`, as Ask's.

| Field | Type | Meaning |
|---|---|---|
| `meta` | meta | As 4.20 |
| `project` | project key | The board drafted for |
| `outcome` | `"drafted"` \| `"not_supported"` \| `"not_understood"` \| `"unavailable"` | What the draft came to |
| `draft` | draft \| null | The rule as the AI filled it in; exactly with `drafted` |
| `explanation` | string \| null | What the drafted rule would flag, in a sentence or two ("Flags bugs that stay in progress for more than 3 days."); null otherwise |
| `note` | string \| null | Why it could not be drafted, and the closest check (`None of the checks can do that. The closest is 'Time in a status'.`), or why there is no AI now; null for a draft |
| `problems` | `{field, message}[]` | What a save would still refuse in the draft after one repair, at its field (`title`, `check`, `params.hours`, `applies_to.status_category`, `applies_to.issue_type`, `description`); only with a draft |

**Draft** `{title, description, check, params, applies_to, severity}`, as a create's rule (4.21): the service checks
it exactly as a save would and, when it fails, asks the model once more with what was wrong; what is still wrong comes
back as `problems`, for the admin to put right in the form. A check the board does not offer leaves the form's check
unpicked. The title names the rule without its limit ("Bugs in progress too long"): the row shows the limit, and an
admin may change it there at any time. The explanation (and any figure in the description) says what the draft as
checked flags, its numbers the draft's own in their units, and the status categories it looks at; a limit the words
did not give is said to be the check's default. A status the board does not have is never swapped for one it has: the
answer is `not_supported`, naming time in a status as the closest check.

**Request, browser to interface.** `/api/oversight/rules/settings/draft`, no parameters (400 for any), as 4.21: from
this dashboard's own pages, as JSON (403 `forbidden` otherwise: "A rule can be drafted only from this dashboard's own
pages, so nothing was drafted."), and from a reader Ask answers at people level (403 `people_not_allowed`, "Only admins
can change rule settings.", for anyone else), both decided before the body is read. The body, at most 16 KB (413), is
`{"text"}` and nothing else, the text 3 to 500 characters of plain text once trimmed (`ruleDraftRequestSchema`; 400
`bad_request` otherwise: `Describe the rule in 3 to 500 characters, as a JSON body of the form {"text": "..."}.`) with
no email address or account id in it (400 `bad_request`, "Leave out email addresses and account IDs.", which the page
says before sending anything), and the service is sent the text this route checked, never the browser's body. Forwarded with `level=people` beside the
board, the route waits 60 s for it (a model call, its thinking and one repair). A service from before JO-20 answers its
404 as 502 `upstream_error` ("The oversight service does not draft rules yet: it may be an earlier version than this
dashboard."); its 422 `rule_settings_invalid` (words it refuses) as 400 `bad_request` in its own words where they can
be shown; its 429 `ask_rate_limited` as 429 with the contract's sentence and its `Retry-After`; a 200 is checked
(`ruleDraftSchema`: a draft exactly with `drafted`, problems only with one) against the board asked for. Never retried
by the page: each draft is a model call the day's budget counts.

### 4.24 `GET /refresh` and `POST /refresh`

Sync (JO-18): the top bar's Sync, and the first sync a page offers for a board that has never synced, sync the
board picked in the top bar and no other. Board-scoped like every read (`?project=`, section 2), and never refused
for a board that has never synced: that is how its first sync starts. Browser to interface: no parameters (400 for
any: the board is the top bar's pick, which the interface's server adds, held to the reader's boards), and a `POST`
with no body, from this dashboard's own pages (section 6).

`POST` syncs the board: discovery (4.11), then `sync --incremental --project KEY` (`--full` when it has never
synced), `derive --project KEY` and `rules --project KEY`. Jira is only read. The service runs one sync at a time:
a second board's sync is queued behind the one running (`queued`), never refused and never run beside it; a press on
a board whose sync is queued or running reports it (as it is); the cooldown (a press soon after the board's sync
ended reports that one) is per board. The rules re-check after a rule settings save (4.22) runs in the same queue.
`POST` answers 202 (or 200) with the board's state; `GET` reports it, and is polled every 2 s while it is `queued` or
`running`.

| Field | Type | Meaning |
|---|---|---|
| `project` | project key | The board the state is about. The interface refuses (502 `upstream_invalid`) a state about another board than the one it asked about |
| `state` | `"idle"` \| `"queued"` \| `"running"` \| `"succeeded"` \| `"failed"` | `idle`: no sync of this board in this service process yet; `queued`: waiting for another board's sync to end |
| `started_at` | timestamp \| null | When it started running; `null` while `idle` or `queued` |
| `finished_at` | timestamp \| null | When it ended; `null` until then |
| `message` | string \| null | Why it failed, in plain words; `null` otherwise |

**Sync in the top bar** names the board in its name and tooltip ("Sync AILED"). A press shows "Syncing" (or
"Queued", with a toast saying it starts when the sync before it ends) until the sync ends; then every figure on
screen is read again, the board list too, and a toast says "AILED synced", or "AILED didn't sync" with the
service's message. A failed sync says "Sync failed" beside the last sync time until a sync succeeds after it. A board
that has never synced says "Not synced yet", and a press starts its first sync.

**A board that has never synced** (JO-17) shows on every page that reads one board (all but the Portfolio, the
access log and usage), in the page's place under its heading: "AILED hasn't been synced yet.", "The first sync of a
large board can take a few minutes." and the one action, "Sync AILED"; while it is queued or running the button
says so and a bar sweeps under it; a failure says why and offers it again; once it has synced, the page fills in.

### 4.25 `GET /people/scorecard/tickets`

The proof behind a figure of the scorecard (4.15): the tickets a number counts, so that anyone can check it (James,
26 Nov 2026: "I need to see what is behind the number."). People level only. The figure and its list are one
computation on the service: the list is the set the figure is the size of. Board-scoped like the scorecard
(`?project=`, section 2); `Cache-Control: no-store`. A read is recorded in the access log as `scorecard_tickets_view`
(4.16), with the person if one was asked for, the measure and `days`.

**Request, interface to service.** `project` (added by the interface), `level` (`team` | `people`, `team` when left
out, set by this server as for the scorecard), `days` (`30` | `90` | `180`, default `90`), `measure` (one of the
scorecard's eleven keys, or `tickets`: every ticket the figure "N tickets" counts) and `person` (a person id; left out
is the whole board). Any other name, a name given twice or a bad value is 422. At team level the service answers 403
`people_level_only`; a `person` who is not on the board is 404; a measure the board cannot show (the scorecard's
`measurable: false`) is 409 `not_measurable`. With `PEOPLE_COMPARISON=off` one person and the whole board are both
allowed.

**Request, browser to interface.** `/api/oversight/people/scorecard/tickets?days=&measure=&person=`: those three only,
each checked and rebuilt (`measure` against the twelve keys, `person` as one person id); anything else is 400
`bad_request`, `project` and `level` included. The admin gate of the scorecard applies (403 `people_not_allowed`).

| Field | Type | Meaning |
|---|---|---|
| `meta` | meta | |
| `period` | `{days, from, to}` | As the scorecard's |
| `measure` | measure | The scorecard's measure object; for `tickets`, `{key: "tickets", label: "Tickets", kind: "count", direction: "neutral", rule_ids: [], measurable: true, reason: null}` |
| `person` | person \| null | Whose figure; null is the whole board |
| `value` | value | Byte for byte the value the scorecard shows in that cell (same days, same person); for `tickets`, `{value: n, numerator: null, denominator: null, enough: true, vs_board: null}` |
| `total` | integer | Tickets in `tickets` |
| `counted` | integer | Tickets in `tickets` with `counted` true |
| `tickets` | ticket[] | Counted first, then by `at`, newest first (null last), then by key number |
| `left_out` | ticket[] | Tickets an ignore leaves out of this measure (4.26), each with `ignore` set; `[]` when none |

These always hold, and the interface checks them (`peopleProofSchema`): counts and `tickets` have `total == counted
== value.value` with every ticket counted; rates have `counted == value.numerator` and `total == value.denominator`;
the ratio (`open_findings_per_10`) has `total == value.denominator`, the `findings` of its tickets adding up to
`value.numerator`, and `counted` the tickets with at least one open finding; no key is listed twice across `tickets`
and `left_out`; each ticket's `detail` has the shape its measure gives. A body that fails is 502 `upstream_invalid`,
with the failing paths.

**Ticket** `{key, summary, issue_type, status, status_category, counted, credit, at, detail, ignore, url}`: `summary`,
`issue_type` and `status` as Jira has them (null if unknown); `status_category` `new` | `indeterminate` | `done` |
null; `counted` whether it is in the figure's numerator (all of them for a count); `credit` is why it counts for this
row, for every measure alike (the board's credit setting, 4.29), `{person, basis, field}`, where `basis` is
`assignee_now` (its assignee now) or `field` (the Jira field named in `field`, "Programmer" on the sites that fill it),
and, for the whole board, the first person it counts for (`person` null and `basis` null: no one); `at` is `done_at` for the measures of finished
work, `started_at` for `estimated_before_start` and null otherwise; `ignore` is `{scope, rule_id, reason, by, at}`
when an ignore left it out; `url` is always null from the service, and the interface fills it with the Jira link of the
key (`OVERSIGHT_JIRA_BASE_URL`, as `issue.url` is filled; null where none is set, as in the sample).

`detail` by measure, raw numbers (the page words them): `open_tickets`, `in_progress`, `done_in_period` and `tickets`:
null. `estimated_before_start`: `{started_at, estimate_set_at, grace_hours}`. `time_logged`: `{time_spent_s,
subtask_time_spent_s}`. `within_estimate`: `{logged_s, estimate_s, ratio, limit}`. `stuck_now`: `{status, since, hours,
threshold}` (the threshold as the finding states it, "p90 of To Do: 524.8 h"). `reopened`: `{times}`. `skipped_stage`:
`{stages}`. `code_review`: `{breach}`. `open_findings_per_10`: `{findings, rule_ids}`.

**The page** (`/people`): every figure in the everyone table (the whole board's row too) and in the scorecard is a
button, named "Nasif Ishtiaque Islam, Open tickets stuck in a status, 78%, 7 of 9: show tickets"; "N tickets" under a
name opens the `tickets` list; a cell with nothing behind it (a dash, 0 of 0) is no button. The tickets open in a side
sheet (full screen on a phone) and the address keeps them (`proof=<measure>` and `proof_person=<id or board>`), so a
link opens the same list. The sheet names the person and the measure, the period, and the figure with its sentence;
a rate's tickets split under a control ("Stuck 7", "Not stuck 2", "All 9"); a list shows the key (to Jira, in a new
tab), the summary, the status, the measure's detail in plain words, whom it counts for with its basis (the field's
name, such as "Programmer", or "Assignee"; on every measure's list, a person's and the board's) and a link to the
ticket's page here; ignored tickets carry an
"Ignored" tag and a muted "Left out" group at the end. The foot offers "Open in Jira" for the keys shown (Jira's search),
or, past 100 keys, "Copy keys" and "Copy JQL".

### 4.26 `POST /findings/ignore/preview` and `POST /findings/ignore`

Ignoring findings (James, 26 Nov 2026: "I don't want to change the rules; I want the system to ignore that particular
ticket."). An admin sets findings aside without changing a rule: one rule on a ticket (scope `finding`), or every rule
on it (scope `ticket`). An ignore is kept by the board, the ticket and the rule (none for a whole ticket), never by
finding id, so it outlasts a severity change or a catalogue bump, and a finding that clears and fires again stays
ignored. It holds at once: the open findings it covers are resolved in the same transaction as `ignored` (4.3); every
later rules run keeps them so, and records a new finding on an ignored ticket and rule already resolved as `ignored`.
Ignored is neither open nor fixed: it leaves every open count (the Overview, the Portfolio, People, Findings and its
facets, the digest, the insights, the weekly series, Ask) and never counts as resolved, fixed or new. People level
only; board-scoped; `Cache-Control: no-store`. Nothing here writes to Jira.

**Request, interface to service.** `project` and `level=people` (`team`, or none, is 403 `{"detail", "code":
"people_level_only"}`), the reader's `X-Oversight-Viewer` and `X-Oversight-Viewer-Name` (who ignored it, by the name
the access log keeps: never an email address), and a JSON body of at most 1 MB:

```jsonc
{ "target": { "query": { "ticket": "finished" } }, "scope": "finding", "reason": "Closed before we estimated work" }
```

`target` is exactly one of `{"finding_ids": [...]}` (1 to 10,000 finding ids), `{"issue_keys": [...]}` (1 to 10,000
issue keys, scope `ticket` only), or `{"query": {...}}`: the filters of 4.3 that narrow (`rule`, `severity`, `epic`,
`person`, `q`, `first_seen`, `ticket`), resolved on the service to the matching **open** findings at that moment (it
takes no state, sort or paging). With scope `ticket` every open finding on the tickets the target comes to is ignored,
its other rules' too. A sprint's finding (W-SPR-01) is on no ticket and is never ignored. `reason` (the ignore only)
is optional plain text, at most 500 characters as Python counts them. A target that comes to nothing ignores nothing:
200 with zeros. A body the contract does not allow is 422 with each problem at its field; nothing is written.

The preview answers:

| Field | Type | Meaning |
|---|---|---|
| `meta` | meta | |
| `findings` | count | The open findings the ignore would resolve now |
| `tickets` | count | The tickets they are on |
| `by_rule` | `{rule_id, rule_title, findings}`[] | Those findings by rule, in the board's order of its rules, each rule once, adding up to `findings` |
| `already_ignored` | count | Findings the target names that are ignored already, left as they are |

The ignore answers:

| Field | Type | Meaning |
|---|---|---|
| `meta` | meta | |
| `ignored` | `{findings, tickets}` | What it resolved: the preview's figures for the same target, at that moment |
| `ignore_ids` | string[] | One ignore for each ticket and rule (or whole ticket) it recorded, each once; one already standing for a pair is given back, never doubled |

**Request, browser to interface.** `/api/oversight/findings/ignore/preview` and `/api/oversight/findings/ignore`, no
parameters (400 for any), from this dashboard's own pages as JSON (403 `forbidden` otherwise, section 6), and from a
reader Ask answers at the people level (403 `people_not_allowed`, "Only admins can ignore findings or restore them.",
for anyone else), both decided before the body is read. The body, at most 1 MB (413 `bad_request`), is checked
(`ignorePreviewRequestSchema` and `ignoreRequestSchema`, `src/lib/api/ignores.ts`: one target, its ids and keys each
once and in order, the filters in canonical form with nothing that does not narrow, issue keys at scope `ticket` alone,
the reason as plain words on one line with no email address, blank read as none) and rebuilt: the service is sent
what was checked, never the browser's body. 400 `bad_request` with each problem at its field otherwise. Forwarded with
`level=people` beside the board; it waits 30 s. The service's 422 is passed on as 400 `bad_request`, in its own words
where they can be shown; its 404 without `unknown_board` (a service from before) as 502 `upstream_error` ("The oversight
service does not ignore findings yet: it may be an earlier version than this dashboard."). A 200 is checked: a preview
whose rules do not add up to its findings, or an ignore that names an ignore twice, is 502 `upstream_invalid`.

**The page** (Findings, people level only; nobody else sees any of it):

- The table's first column selects: a box on each row an admin can act on (an open finding on a ticket, or an ignored
  one), a box in the head for the page. A focused row takes x or Space for its box and Shift+F10 for its actions; the
  boxes are no tab stops of their own in the table (they are in the phone's list). Escape lets go of the selection,
  and another page, filter or sort starts afresh.
- A selection raises a bar at the foot of the page, its room always kept: "3 selected · Ignore · Clear", with Restore
  for ignored rows, and "Select all 412 matching" once the whole page is picked on Open with more beyond it, which
  turns the selection into the filters themselves (a `query` target).
- Each row's actions (the kit's menu, at its end): Ignore, Ignore every rule on this ticket, or on an ignored row,
  Restore.
- Filters: State gains Ignored; Ticket (Any, Open, Finished) beside First seen; and "Ignore findings on finished
  tickets…" beside Export CSV, which opens the dialog for every open finding on a finished ticket the other filters
  match, and leaves the list as it is. It opens "Findings on finished tickets": every rule that runs on the board,
  breaches first, each with its severity and its open and ignored counts on finished tickets, ticked where its
  findings there are ignored by rule; a rule with none there is listed greyed ("None on finished tickets").
  Whole-ticket ignores are only counted in a note. Ticking a rule ignores its open findings there (a `query` target
  with `ticket=finished` and that rule, scope `finding`); unticking it restores that rule's own ignores there. One
  Save does both ("Ignore 56, restore 266"), with an optional reason for the new ignores.
- The dialog: "Ignore 412 findings?", the service's preview (the findings and their tickets, by rule, and how many are
  ignored already), the scope as two cards where it can be chosen ("Only this rule" / "Every rule on this ticket", or
  for several "Only these rules" / "Every rule on these tickets"), an optional reason with its counter, and "Ignore 412
  findings" (⌘↵), held back while the preview is worked out or finds nothing. Then a toast, "Ignored 412 findings",
  with Undo, which restores the ignores it made.
- An ignored row reads "Ignored" (a neutral chip, never a status colour) with "Ignored by Morgan Ellis on 26 Nov 2026:
  Closed long ago" in its tooltip and to a screen reader; the name only at the people level.
- The drawer: Ignore or Restore beside Copy link, and on an ignored finding a note of who ignored it, when, why and
  what the ignore covers. The ticket page: "Ignore all on this ticket" beside its findings (scope `ticket`, no choice),
  and the same chip on its ignored findings.
- Everything an ignore moves is read again after it (the Overview, Findings, People, the Portfolio, the weekly series,
  the ticket pages, the rules' open counts): no new widget anywhere, the counts just change.

### 4.27 `POST /findings/restore`

Removes ignores. Body `{"ignore_ids": [...]}` (1 to 10,000, each once): the board's standing ignores among them are
restored, each kept as history with who restored it and when, and an id that is not one is passed over. The board is
then re-checked through the Refresher's re-check (the one a rule settings save starts, 4.22), so exactly the findings
the rules still hold reopen, under the same ids with their first sighting kept, as an undo of a rule settings change
reopens them. People level only, as 4.26, its body at most 1 MB.

| Field | Type | Meaning |
|---|---|---|
| `meta` | meta | |
| `restored` | count | The ignores restored |
| `recheck` | object \| null | The re-check it started: `{state, started_at, finished_at, message}`, `state` as the Refresher says a job (`queued`, `running`, `succeeded`, `failed`); the interface also reads a rule settings apply state there (`running`, `applied`, `pending`, `failed`, 4.20). Null when nothing needed one |

**Request, browser to interface.** `/api/oversight/findings/restore`, as 4.26: from this dashboard's own pages, as JSON,
from an admin, its body checked (`restoreRequestSchema`) and rebuilt. While the re-check is queued or running the page
follows it as it follows a rule settings save's (the shell reads `GET /rules/settings` every 2 s), and reads every
figure again when it ends. One restore runs at once with a toast ("Restored"); several, from the bar, after a dialog
that says how many come back and that a whole ticket's ignore brings back its other findings too ("Keep ignored"
focused). The toast after an ignore restores its `ignore_ids` the same way.

### 4.28 `GET /findings/ignored`

The board's standing ignores, a page at a time. People level only; board-scoped.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `rule` | rule id, repeatable, at most 24 | all | Ignores of any of these rules (a whole ticket's has none) |
| `q` | string, at most 100 characters | none | A key, a number or words in the ticket's key or summary, as 4.3's search reads them |
| `sort` | `at` \| `issue_key` \| `rule_id` | `at` | `issue_key` by number; a whole ticket's ignore last by `rule_id` either way |
| `order` | `asc` \| `desc` | `desc` | Ties: newest first, then `ignore_id` |
| `page`, `page_size` | integer ≥ 1; 1 to 100 | 1; 25 | A page past the end is an empty page |

The answer is `{meta, items, total, page, page_size}`, each item an ignore: `{ignore_id, scope, issue_key,
issue_summary, issue_type, status, status_category, rule_id, rule_title, findings, reason, by, at}`, the ticket as the
snapshot has it now (null where it has left), `rule_id` and `rule_title` null exactly for a whole ticket's ignore,
`findings` the findings resolved as ignored under it now, and who made it, when and why. The interface refuses (400)
unknown parameter names, a single-valued one given twice and values out of range, forwards only the canonical form
with `level=people`, and refuses (403 `people_not_allowed`, "Only admins can see the ignored findings' ignores.") a
reader below the people level. It checks the answer: each ignore once, a rule exactly when it covers one, no more items
than a page; an email address in `by` reads "Signed-in user" and one in a reason "(email address removed)". The page
reads it to find the ignore behind an ignored finding when the finding does not name it.

### 4.29 `GET /people/credit` and `PUT /people/credit`

Whom a board's tickets count for, and the choice an admin makes of it (26 Nov 2026: on MJH DASHBOARD the
workflow clears the assignee at every hand-off, so crediting the assignee now missed almost all finished work; AILED
fills no Programmer field). People level only; board-scoped (`?project=`, section 2); `Cache-Control: no-store`.

**The credit rule** (the product owner's decision of 26 Nov 2026, final). The board's setting decides whom every work
ticket counts for, open or finished, wherever people figures are shown: every scorecard measure, those of now
(`open_tickets`, `in_progress`, `stuck_now`, `open_findings_per_10`) and those of finished work alike, a person's
tickets, who is listed under "Everyone with tickets", the person card, the proof lists, and Ask's people answers
(their findings too). Only the open findings Findings lists by person (its Person filter and Assignee column), and
`GET /people`'s open findings that the Overview's open findings by person shows, stay with whoever is assigned the
ticket now. A ticket counts for whom the board's setting names, and no one else:

- **A Jira people field**: everyone in that field now (`field`; one ticket can have several, and it counts once for
  each). Empty, the ticket counts for no one.
- **Assignee**: the current assignee (`assignee_now`). Unassigned, no one.
- **Automatic**: the Programmer field where it is filled (`field`), otherwise the current assignee (`assignee_now`);
  neither, no one.

A ticket that counts for no one counts for the whole board only. A person's tickets (`GET /people`'s, the directory's,
the scorecard's and the card's, 4.12 to 4.19) are the board's work that counts for them. So with Programmer chosen,
someone never named as Programmer has no tickets, no figures, and is not listed under "Everyone with tickets".

**The setting**, per board, with three choices. **Automatic** (`auto`, every board's default): the site's Programmer
field (`programmer` in config/fields.yaml) where it is filled, otherwise the assignee; the assignee alone where the
site has no Programmer field. **Assignee** (`assignee`). **A Jira people field** (`field`): one of the site's people
fields (a people or user picker type in fields.yaml: today Programmer, Code Reviewers, Testers and Test Reviewers)
filled on at least one of the board's work tickets. A board starts on its choice in config/process.yaml
(`credit: {source, field}` under the project; `auto` where it names none): MJHDASH reads Programmer, AIL credits the
assignee. An admin's change overrides it from then on, at once (no Jira call, no rules run), and is kept in the
snapshot.

**Request, interface to service.** `GET /people/credit?project=&level=&days=`: `level` as 4.15 (`team`, or none, is
403 `people_level_only`); `days` `30` | `90` | `180`, 90 when left out, the period the coverage is counted over. Any
other parameter, or one given twice, is 422. `PUT /people/credit?project=&level=` with the reader's
`X-Oversight-Viewer` and `X-Oversight-Viewer-Name` (4.16; the name is the setting's `changed_by`) and the
JSON body `{"source": "auto" | "assignee" | "field", "field": key | null, "revision": count}`.

| Field | Type | Meaning |
|---|---|---|
| `meta` | meta | |
| `period` | `{days, from, to}` | As 4.15's: the coverage is counted over the work finished in it (the People page's period) |
| `setting` | `{source, field, revision, changed_by, changed_at}` | The choice in force: `field` `{key, name}` exactly when `source` is `field`; `revision` 0 while the process.yaml choice stands, then 1, 2, 3 …; `changed_by` (the name the access log keeps, never an email address) and `changed_at` null exactly while it stands |
| `effective_field` | `{key, name}` \| null | The people field the setting reads now: the chosen field, or Automatic's Programmer where the site has it; null for Assignee |
| `finished` | count | The board's work (Epics left out) finished in the period: what each option is counted out of |
| `options` | option[] | Automatic, then Assignee, then each eligible people field by its name (folded for case and accents, then its key) |

**Option** `{source, field, source_filled, credited}`: `source_filled` the finished tickets the option's own source
fills (a field's: filled now; Automatic's: Programmer, 0 where the site has none; Assignee's: assigned now);
`credited` the finished tickets that count for at least one person under it.

A `PUT` is made against the revision the page read: one that is not the board's is 409 `{"detail", "code":
"stale_revision"}`, and nothing is written. An unknown source, a field with a source other than `field`, `field`
without one, or a field the site lacks or the board fills on none of its work tickets is 422. Choosing what already
stands writes nothing. Otherwise the choice is saved as the next revision with the reader and the time, and the answer
is 200 with the setting as `GET` gives it (over 90 days).

**Request, browser to interface.** `GET /api/oversight/people/credit?days=`: `days` alone, checked
(`parseCreditQuery` in `src/lib/api/params.ts`) and rebuilt; anything else is 400 `bad_request`, `project` and `level`
included. `PUT /api/oversight/people/credit`, no parameters (400 for any): from this dashboard's own pages, as JSON
(403 `forbidden` otherwise: "How finished work is counted can be changed only from this dashboard's own pages, so
nothing was changed."), at most 16 KB (413), and from a reader Ask answers at people level (403 `people_not_allowed`,
"Only admins can change how finished work is counted."; a read, "Only admins can see how finished work is
counted."), all decided before the body is read or anyone is asked anything. The body is checked
(`peopleCreditSaveRequestSchema`: the source, a field's key exactly when the source is `field`, the revision a whole
number, nothing else; 422 `credit_invalid` otherwise) and the service is sent the body rebuilt from it. The service's
409 is passed on as 409 `stale_revision` in this interface's words ("Someone changed how finished work is counted on
this board since you opened it. Look again, then choose."), its 422 as 422 `credit_invalid` in its own words where
they can be shown, and a 404 without `unknown_board` (a service from before the setting) as 502 `upstream_error`. A
200 is checked (`peopleCreditSchema`: the field exactly with its source, who and when together, Automatic and
Assignee first and each field once, no option over the finished work) against the board and, for a read, the period
asked for; a body that fails is 502 `upstream_invalid`. Saves are never retried by the page.

**The page** (People, `/people`): beside the period, a quiet control, "Counts for: Automatic" (or "Assignee", or
the field's name), opens "Whom tickets count for" ("Every ticket, open or finished, counts for the people this choice
names. Tickets without them count for no one."): the choices as selectable cards (a radio group: the arrows
move and choose, ⌘↵ saves), each with what it does in one line (Automatic: "Programmer in Jira where it is filled,
otherwise the assignee."; Assignee: "The assignee in Jira now. Tickets without one count for no one."; a field:
"Testers in Jira. Tickets without it count for no one."), Automatic marked "Recommended" where the board fills the
field it reads, the one in force "In use", and its coverage over the period on screen as one slim bar (the share that
counts for someone) and one line ("471 of 475 finished tickets count for someone"); Save (the one primary action)
applies it at once: every figure that follows it is read again, and a toast says so ("Tickets now count for the
assignee"). The note under the everyone table, each column's tooltip, the scorecard's caveat and Ask's (the same
words: "Tickets count for their Programmer in Jira; tickets without one count for no one."; "Tickets count for their
assignee; tickets without one count for no one."; "Tickets count for their Programmer in Jira, or their assignee where
there is no Programmer."), and whom each ticket counts for in a figure's tickets follow the setting (4.15, 4.25). A reader below people level never sees the
control: the page itself is theirs alone.

## 5. Errors

The service answers failures with any JSON body (FastAPI's `{"detail": ...}` is fine); the interface
never shows it to anyone. What matters is the status:

| Service status | Interface answers | Code |
|---|---|---|
| 404 on `/findings/{id}` or `/issues/{key}/timeline` | 404 | `not_found` |
| 404 on `/insights/latest` or `/baseline/latest` | 404 | `not_found` |
| 404 on `/people/{id}/avatar`: no picture | 404 | `not_found` (the browser shows the initials) |
| 404 anywhere, its body's code `unknown_board`: the board asked for is not served (the service's board check, before any route's own) | 404 | `unknown_board` (the top bar forgets a stale pick; a person card names the board it was read on) |
| 404 anywhere else (`/people` and `/people/directory` among them): the picked board is not served | 404 | `unknown_board` (the top bar forgets the pick) |
| 409 on a board-scoped endpoint, its body's code `board_not_synced`: the board is served but has never synced (JO-17) | 409 | `board_not_synced` ("This board hasn't been synced yet."; every page offers its first sync instead). On `/health` the interface answers 200 with no sync time instead (4.1) |
| (never asked) the picked board is not one of the person's | 403 | `board_not_allowed` (sign-in on; the top bar forgets the pick) |
| (never asked) a team-level reader's question mentions people | 403 | `people_not_allowed` (sign-in on, not an admin; 4.6) |
| (never asked) a team-level reader asks for `/people/directory` | 403 | `people_not_allowed` (sign-in on, not an admin; 4.14) |
| (never asked) a team-level reader asks for `/people/scorecard` | 403 | `people_not_allowed` (sign-in on, not an admin; 4.15) |
| 403 on `/people/scorecard` for two people or more, its body's code `comparison_off` | 403 | `comparison_off`, with the contract's sentence (4.15) |
| 404 on `/people/scorecard` with `person`, without the code `unknown_board`: someone asked for is not on the board | 404 | `not_found` (without `person`, a 404 is the board: `unknown_board`) |
| 404 on `/people/{id}/card` without the code `unknown_board`: the person is not on the board read | 404 | `not_found` ("This person is not on this board.") |
| (never asked) a team-level reader asks for `/people/{id}/card` | 403 | `people_not_allowed` (sign-in on, not an admin; 4.19) |
| (never asked) a team-level reader asks for `/access-log` or `/usage` | 403 | `people_not_allowed` (sign-in on, not an admin; 4.16, 4.17) |
| (never asked) a team-level reader asks for `/rules/settings`, or posts a preview, a save or a draft | 403 | `people_not_allowed` ("Only admins can see rule settings.", "Only admins can change rule settings."; 4.20 to 4.23) |
| (never asked) a POST (a question, "Sync now", a rule settings preview, save or draft) not from this dashboard's own pages (its `Origin`), or with a body that is not JSON | 403 | `forbidden` (section 6) |
| (never asked) a preview or a save whose body the contract does not allow | 422 | `rule_settings_invalid`, each problem at its setting (4.21) |
| (never asked) a draft whose body is not `{"text"}`, 3 to 500 characters once trimmed, with no email address or account id | 400 | `bad_request` (4.23) |
| 422 on `/rules/settings/draft`, its body's code `rule_settings_invalid`: the service refused the words | 400 | `bad_request`, in the service's own words when they are fit to show (4.23) |
| 409 on `/rules/settings`, its body's code `rule_settings_conflict`: the board's settings moved on from the revision sent | 409 | `rule_settings_conflict`, in this interface's words (4.22) |
| 422 on `/rules/settings` or its preview, its body's code `rule_settings_invalid` | 422 | `rule_settings_invalid`, each problem the service names at its setting, in plain words only (4.22) |
| 503 on `/rules/settings`, its body's code `rule_settings_busy`: a rules run held the board's lock, nothing was written | 503 | `upstream_unavailable` ("The rules are running on this board right now. Try again in a moment.") |
| (never asked) a team-level reader asks for `/people/credit`, or changes it | 403 | `people_not_allowed` ("Only admins can see how finished work is counted.", "Only admins can change how finished work is counted."; 4.29) |
| (never asked) a change of the credit setting whose body the contract does not allow | 422 | `credit_invalid` (4.29) |
| 409 on `PUT /people/credit`, its body's code `stale_revision`: the board's setting moved on from the revision sent | 409 | `stale_revision`, in this interface's words (4.29) |
| 422 on `PUT /people/credit`: the service refused the choice | 422 | `credit_invalid`, in the service's own words where they can be shown (4.29) |
| 404 on `/people/credit` without the code `unknown_board`: a service from before the setting | 502 | `upstream_error` ("The oversight service does not offer the credit setting yet: …") |
| (never asked) a team-level reader posts an ignore, its preview or a restore, or asks for `/findings/ignored` | 403 | `people_not_allowed` ("Only admins can ignore findings or restore them.", "Only admins can see the ignored findings' ignores."; 4.26 to 4.28) |
| (never asked) an ignore, its preview or a restore not from this dashboard's own pages, or not JSON | 403 | `forbidden` (section 6) |
| (never asked) an ignore, its preview or a restore whose body the contract does not allow; over 1 MB | 400; 413 | `bad_request`, each problem at its field (4.26, 4.27) |
| 422 on an ignore, its preview or a restore: the service refused the body | 400 | `bad_request`, in the service's own words where they can be shown (4.26) |
| 404 on an ignore route without the code `unknown_board`: a service from before ignoring | 502 | `upstream_error` ("The oversight service does not ignore findings yet: …") |
| 404 on `/rules/settings` or its preview without the code `unknown_board`: a service from before JO-15 | 502 | `upstream_error` ("The oversight service does not offer rule settings yet: …") |
| 404 on `/rules/settings/draft` without the code `unknown_board`: a service from before JO-20 | 502 | `upstream_error` ("The oversight service does not draft rules yet: …") |
| 429 on `/ask` or `/rules/settings/draft`, its body's code `ask_rate_limited` | 429 | `ask_rate_limited`, with the contract's sentence and the service's `Retry-After` (4.17, 4.23) |
| 500 anywhere, its body's code `access_log_unavailable`: the read could not be recorded, so nothing was served | 503 | `access_log_unavailable` (4.16) |
| 400, 422 or another 4xx | 502 | `upstream_error` |
| 401 or 403 | 502 | `upstream_refused` |
| 429 or 503 | 503 | `upstream_unavailable` |
| 504, or no answer within the timeout | 503 | `upstream_timeout` |
| Other 5xx | 502 | `upstream_error` |
| Unreachable | 503 | `upstream_unavailable` |
| 2xx with a body that is not JSON | 502 | `upstream_malformed` |
| 2xx with JSON that breaks this contract | 502 | `upstream_invalid`, with the failing field paths (never their values) |
| 2xx on `/people/{id}/avatar` that is not one of the four image types, by `Content-Type` and by its first bytes, or is over 1 MB | 502 | `upstream_invalid` |
| 2xx on `/ask` at team level whose `people` is not empty | 502 | `upstream_invalid` |
| 2xx on `/people/directory` naming a person twice, or with an entry that is not a person and a count | 502 | `upstream_invalid` |

Every non-2xx body the browser receives from the interface is
`{"error": "<code>", "message": "<plain words>", "issues": [{"path", "message"}]?}`, where `error` is one
of `bad_request`, `not_found`, `unknown_board`, `board_not_synced`, `board_not_allowed`, `people_not_allowed`, `comparison_off`,
`ask_rate_limited`, `access_log_unavailable`, `rule_settings_conflict`, `rule_settings_invalid`, `stale_revision`, `credit_invalid`, `forbidden`,
`unauthenticated`, `not_configured`, `upstream_unavailable`, `upstream_timeout`, `upstream_refused`,
`upstream_error`, `upstream_malformed`, `upstream_invalid` or `internal_error`. `unauthenticated` (401) is the
interface's own: sign-in is on and the request carries no valid session, so the browser is sent to `/login` and
back. `board_not_allowed` (403) is the interface's own too: sign-in is on and the board picked in the top bar is not
one the person's Jira account can open. So is `people_not_allowed` (403): a question that mentions people, or a read
of the directory, from a reader Ask answers at team level (4.6, 4.14), and any rule settings request from them
(4.20 to 4.23), and any ignore request (4.26 to 4.28). So is `forbidden` (403): a POST (a question, "Sync now", a change
to rule settings, an AI draft of a rule, an ignore or a restore) not sent from this dashboard's own pages, or with a
body not sent as JSON. The service never sees any of these requests. `rule_settings_conflict` (409) and `rule_settings_invalid`
(422) are the service's refusals of a change, said in this interface's words; a body this interface itself cannot
take is `rule_settings_invalid` too, before anything is forwarded.

With sign-in on, an admin reads every board, exactly as with sign-in off, and reads at people level. Who is an
admin is `ACCESS_MODE`'s (JO-16), decided on every request in one place (`src/server/auth/roles.ts`):
`everyone-admin`, the default, makes an admin of everyone who signs in (sign-in itself still admits only
`ALLOWED_EMAIL_DOMAINS`); `admin-list` makes admins of the addresses on `ADMIN_EMAILS` alone, decided from the
session's keyed email hash. With `admin-list`, anyone else is held to their own boards: every
board-scoped request reads one of the boards in the person's session: the one
picked in the top bar when it is theirs, else their first board (never the service's default, which they
may not be able to open). `GET /api/oversight/projects` lists only their boards, keeping the service's
`default` when it is one of them and otherwise naming their first; when none of their boards is served any
more it answers 403 `board_not_allowed`. `/refresh` (the sync, 4.24) is held to their boards like any
board-scoped request: they sync their own boards only.

## 6. The credential boundary: `/api/oversight/*`

The browser talks only to the interface's own route, `src/app/api/oversight/[...path]/route.ts`
(Node.js runtime). When sign-in is on (`AUTH_MODE`, on by default with live data; see docs/REFERENCE.md), it
first requires a signed-in session: the proxy turns away a request without one with 401
`unauthenticated`, and the route checks again. The session cookie is never forwarded to the service. Then
it:

1. **Resolves the request against an allowlist** (`src/server/endpoints.ts`): the GET paths of
   section 1, `GET /projects`, `GET /refresh`, `POST /refresh`, `POST /ask`, (JO-15) `POST
   /rules/settings/preview` and `POST /rules/settings`, (JO-20) `POST /rules/settings/draft`, `PUT /people/credit`
   (4.29), and `POST /findings/ignore/preview`, `POST /findings/ignore` and `POST /findings/restore` (4.26, 4.27).
   Anything else is 404 before any work is done. Endpoints without parameters
   refuse any query parameter (400); a person's picture takes only its version, `v`, which is checked
   and never forwarded; a person's card only its period, `days`, and the board the page names, `board`, which goes on
   as the board read (4.19). Findings and trends parameters are validated
   (`src/lib/api/params.ts`) and **rebuilt** in canonical form. The service only ever receives what the
   interface validated, never the raw request. Only Ask and the three rule settings POSTs have a body read (at most
   16 KB, a chunk at a time; larger is 413): Ask's as `{"question", "mentions"}`, a rule settings change's checked
   against its schema (4.21, 4.22) and rebuilt from what was checked, an AI draft's as `{"text"}`, its text sent on as
   the plain text it was checked as (4.23). The ignore POSTs' bodies are read the same way, up to 256 KB (a page's
   findings by id, tickets by key, or the filters), checked and rebuilt (4.26, 4.27). Every POST (a question, "Sync
   now", a rule settings preview, save or draft, an ignore or a restore) is refused with 403 `forbidden` before its body
   is read unless it comes from this
   dashboard's own pages: its `Origin` must be `APP_URL`'s with sign-in on (as signing out checks it), or with sign-in
   off name the host the browser addressed (the first `X-Forwarded-Host` a proxy in front sends, else `Host`; never
   the address the server is bound to, such as the container's `0.0.0.0`), by http or https, as a proxy that ends TLS
   forwards it; and one with a body (a question, a rule settings change, a draft) must send it as JSON (`Content-Type`). A
   missing Origin, or `null`, is refused too. A form on another site can send neither, and a script there cannot send
   JSON here without a CORS preflight, which this route never answers; with sign-in on, the session cookie (SameSite
   Lax) would not stop a sibling site on its own. The dashboard's own pages send these POSTs with a referrer policy of
   their own (`same-origin`), so Safari sends their real Origin under the site's `no-referrer`. Then the reader's
   level is decided (an admin, or anyone with sign-in off, is people level; anyone else is refused, 403
   `people_not_allowed`), before the sample or the service is asked anything.
2. **In sample mode** (`OVERSIGHT_DATA=sample`, the default) answers from the bundled sample's boards (section 7),
   for the board picked, as the service would: a board it does not serve 404 `unknown_board`, one that has never
   synced 409 `board_not_synced`.
3. **In live mode** (`OVERSIGHT_DATA=live`) forwards to `OVERSIGHT_API_URL` + `/api/v1/` + the rebuilt
   path, with `X-Service-Key: OVERSIGHT_SERVICE_KEY`, `Accept: application/json` and the reader
   (`X-Oversight-Viewer`, `X-Oversight-Viewer-Name`: 4.16, from the session), and nothing from the
   browser's request (no cookies, no authorisation header, no forwarded-for). A board-scoped request carries
   `?project=<board>`, added here: the board picked in the top bar, held to the person's boards when sign-in
   is on (section 5); the board list and what belongs to no one board (the Portfolio, the access log, usage) carry
   none. Redirects are refused, since a redirect would
   carry the key elsewhere. Reads time out after 15 s; a rule settings preview or save, an ignore, its preview and a
   restore after 30 s; an AI draft of a
   rule after 60 s (a model call, its thinking and one repair); `/ask` after 120 s, because the analyst may take
   several rounds of model calls and queries. Every 2xx body is parsed
   against the schema; only the parsed body (unknown fields dropped) is passed on, and issue `url`s are rebuilt from
   `OVERSIGHT_JIRA_BASE_URL`. A person's picture is passed on as bytes, and only as one of the four image
   types (4.13). `/ask` is sent `{"question", "level", "mentions"}`: the level this route decided for the
   reader and the mentions it checked, never anything the browser said about the level (4.6). A rule settings
   preview, save or draft is sent as a `POST` with `Content-Type: application/json`, the body this route checked and
   rebuilt (4.21 to 4.23), and `level=people` beside the board; so are an ignore, its preview and a restore (4.26,
   4.27). A team-level reader's findings, finding and issue reads have every ignore's `by` set to null here as well,
   whatever the service sent.
4. **Never caches** (`Cache-Control: no-store`), and never names the service, its address or its key in
   anything it returns. The one exception is a person's picture, which the reader's browser keeps for a
   day (`private, max-age=86400`), under an address that carries its version.

| Variable | Used in | Meaning |
|---|---|---|
| `OVERSIGHT_DATA` | both | `sample` (default) or `live` |
| `OVERSIGHT_API_URL` | live | The dashboard API, `http(s)://`, no credentials in it |
| `OVERSIGHT_SERVICE_KEY` | live | The API's `API_SERVICE_KEY`, verbatim. Required: a blank key is a configuration error. |
| `OVERSIGHT_JIRA_BASE_URL` | live, and whenever sign-in is on | `https://<site>.atlassian.net`, for "Open in Jira"; links are null without it. Required with sign-in on: an https origin with no path; every account must be able to reach this site, and sessions are sealed for it (see Signing in below). |
| `SAMPLE_NOW` | sample | Pins "now" (ISO 8601 with a zone). Unset: the minute the server started, moved forward every 30 minutes as a real sync would, so a long-running demo never reads as stale. |
| `SAMPLE_PEOPLE_COMPARISON` | sample | `on` (default) or `off`: the sample's stand-in for the service's `PEOPLE_COMPARISON` (4.15). Read on every request; anything else is 500 `not_configured`. |
| `SAMPLE_LATENCY` | sample | Simulated delay in ms. Empty: 250 for reads, 900 for Ask. One number applies to both; `250,900` sets them apart; `0` turns it off. A rule settings save's re-check takes four reads' time (JO-15): running, then applied. An AI draft of a rule (JO-20) takes Ask's time. |

None of these may carry a `NEXT_PUBLIC_` prefix. A misconfiguration is answered with 500
`not_configured`, naming the variable and never its value.

### Signing in: `/api/auth/*`

The interface's own routes, not the service's: the service never sees them, and they never see the
service. Sign-in is OAuth 2.0 (3LO) with Atlassian, scopes `read:me read:jira-work` and nothing else
(`src/server/auth/`; set up as docs/REFERENCE.md's "Setting up sign-in" says). Every redirect is a 303 to an
address on `APP_URL`, never one taken from the request's `Host` or `X-Forwarded-*` headers.

| Route | Answers |
|---|---|
| `GET /api/auth/login?next=/path` | 303 to Atlassian's consent screen, with a sealed state cookie (`jo-auth-state`, ten minutes, `Path=/api/auth`). `next` is kept only when it is a path on this dashboard (not `/login`, `/no-access`, `/api` or `/_next`); otherwise `/`. With sign-in off, 303 to `next`; when it is not set up, 303 to `/login`. |
| `GET /api/auth/callback` | Back from Atlassian. Works out the person's boards: the boards the oversight service serves (`GET /api/v1/projects`; the sample's DEMO, MOB and HELP in sample mode), then which of them Jira opens for the person (`GET https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/project/search?keys=...`, fifty keys at a time). Signed in: 303 to `next` with the session cookie `jo-session` (HttpOnly, SameSite=Lax, `Path=/`, twelve hours, Secure over https) holding those boards; a `jo-board` cookie naming a board that is not theirs is cleared. Turned away: 303 to `/no-access?reason=` and one `auth.rejected` line on the server's log (`reason`, the email's `domain`, and `account_hash`: an HMAC-SHA-256 of the Atlassian account id under a key derived from `AUTH_SECRET`, so repeated attempts by one account can be counted; never the account id, an email address, a token or a code). Failed on the way: 303 to `/login?error=`. The state cookie is spent either way. |
| `POST /api/auth/logout` | 303 to `/login?signed_out=1`, the session cookie cleared in that browser (the server keeps no list of sessions: a copy of the cookie elsewhere lasts until it expires, unless `AUTH_SECRET` or `OVERSIGHT_JIRA_BASE_URL` changes first). A POST whose `Origin` is present and is not `APP_URL`'s is refused with 403 `{"error": "forbidden"}`; any other method is 405. |

`/login?error=` says why a sign-in failed, and trying again is always the way on: `denied` (Cancel on
Atlassian's screen), `state` (the return did not match this browser: over ten minutes, another tab, or
replayed), `atlassian` (Atlassian answered with an error or something unreadable), `timeout` (no answer
within ten seconds), `unreachable`, `service` (the oversight service could not say which boards it
covers), `internal`. `/no-access?reason=` says which rule turned an account away: `email` (no email
address shared), `unverified`, `domain` (not on `ALLOWED_EMAIL_DOMAINS`), `site` (cannot reach
`OVERSIGHT_JIRA_BASE_URL`), `boards` (its Jira cannot open any of the boards). Both pages show a fixed
message per code and nothing from the address.

Without a session, every other address answers as the sign-in gate decides: a page with 303 to
`/login?next=<path and query>`, anything under `/api/` with 401 `unauthenticated` (500
`not_configured` when sign-in is on but not set up). No request header changes that, prefetches and
RSC requests included.

## 7. Sample mode

The DEMO project is generated in code (`src/server/sample/`) from a fixed seed, once per "now". Every
timestamp is an offset from now: a week later, the whole project is a week later. It tells one story, the
real project's shape at a smaller scale:

- 1,150 issues over the last year in 14 epics with domain-neutral names; Task, Bug, Subtask, Test and Epic;
  the real project's three-status workflow (To Do, In Progress, Done). Code review, sign-offs and testing
  therefore leave no evidence, and R-FLOW-01 and W-REV-01 are not measurable. Its work is the 1,136 issues
  that are not Epics: a person's tickets, the board's tickets on the scorecard and every ranking by person
  count them alone (JO-12, G5).
- About two thirds of work has story points, none has an original estimate, and about 85% of finished work
  has time logged, all by one time-tracking account.
- About 16% of finished work went straight from To Do to Done until a process change five weeks ago; since
  then the skipped-stage share has fallen.
- Two big current epics, Data import pipeline and Integrations API, are run under pressure: more of their
  work starts unestimated, and their effort against estimate has climbed for five weeks. They lead the hot
  spots, above long-closed epics whose historical findings stay open (as the real rules leave them).
- The active sprint ends in about two days with about a third of it not started (W-SPR-01).
- Eight fictional people hold the work: Ada Brooks, Ben Okafor, Carmen Ruiz, Dev Malhotra, Elif Aydin,
  Finn Gallagher, Grace Lindqvist and Hana Mori, the names the service's own demo gives its made-up
  accounts, with the same made-up account ids, so each person has the same id in both. Most work is
  assigned when someone picks it up (the changelog's `Unassigned` → `Assigned`); about 2% of tickets have
  nobody: the backlog no sprint has planned yet, work picked up and finished before anyone was assigned,
  and the work in progress with nobody assigned (R-HYG-01). Two of the eight, Carmen Ruiz and Grace
  Lindqvist, have a picture: an abstract pattern drawn in code (`src/server/sample/pictures.ts`), a PNG,
  never a photograph of anyone, served by `people/{id}/avatar`; the other six have `avatar: null` and
  show their initials, so both are always on screen.
- Three more fictional people are members of the board who hold none of its tickets: Noor Haddad,
  Tomás Ferreira and Yuki Tanabe (the service's demo accounts `acc-09` to `acc-11`, no pictures), stored as a
  member fetch would store them. `people/directory` lists all eleven (`sample/people.ts`, `directoryView`),
  the three with `tickets: 0`; `GET /people`, the Overview and the Findings filter list only the eight.
- The scorecard measures what the rules engine measures on DEMO (JO-12, G11): skipped stages are measured
  (R-FLOW-02 is, and has open findings), so the People page shows a Skipped a stage column; code review is not
  (R-FLOW-01 needs evidence DEMO does not record), so one person's answer ends `Not measurable on this board:
  Code review recorded.`
- The rule engine is replayed on the real schedule (a sync every 30 minutes, rules a minute later) from
  140 days back, so findings open, persist and resolve as live ones do, and warnings link to the breaches
  they foreshadowed.
- The person card (JO-13, `sample/person-card.ts`): every figure from the sample's own scorecard and `GET /people` for
  the same person and period (the tests hold the two to it for everyone on the board, over each period). The sample
  serves one board, so that the card's last line is seen, two of its people hold made-up open tickets on two made-up
  boards it does not serve: Ada Brooks on OPS (3) and WEB (1), Noor Haddad (a member who holds none of DEMO's) on OPS
  (2). The card names them and never offers them as a way in, since the top bar cannot open them. The sample's access
  log holds two card reads among its designed reads at the top.
- Governance (JO-12, `sample/portfolio.ts`, `access-log.ts`, `usage.ts`): the Portfolio lists the synced boards,
  DEMO and MOB, each from its Overview's own aggregates, with the oldest open breaches across them. The access log is a fixed history of
  the last 60 days, about 150 reads, made up as the rest of the sample is: fictional viewers (two admins, Morgan
  Ellis and Priya Raman; a user, Tobias Wren, whose reads are findings filtered by a person; a session from before
  names were kept; and the local reader with sign-in off), the sample's own people as the subjects, and one former
  member, on no board any more. The sample does not record the reads made against it (that is the service's
  work), so the log does not grow as a demo clicks. Usage is made up too: a working week of questions, quiet at
  the weekend, today counted to now, and no daily budget set. The sample never limits questions and never
  writes `note`.
- The credit rule and setting (4.29, `sample/credit.ts`, `credit-store.ts`, `credit-view.ts`): the service's rule step
  for step, every view of people reading it (`GET /people`, the directory, the scorecard, the person card and Ask's
  people tools). The sample's site has the four people fields (Programmer, Code Reviewers, Testers, Test Reviewers).
  DEMO fills none and keeps every assignee, so on DEMO the rule gives exactly the figures it always has, under
  Automatic (its starting choice) or Assignee; MOB, which starts on Assignee as AIL does, fills Programmer (mostly the
  assignee, sometimes a pair, sometimes the one who wrote it before handing it on) and Testers (on finished work,
  mostly two of the team), each drawn from a stream of its own so nothing else on MOB moves: there a field changes
  whom every ticket counts for, open or finished; `GET /people`'s open findings alone stay with the assignee. The setting is kept in memory per server process and per board, saved under the
  reader (the local reader with sign-in off) at the sample's "now"; a restart forgets it. The vitest
  suites set it back with `resetSampleCredit()`.
- Rule settings (JO-15, `sample/settings-store.ts`, `board-rules.ts`, `recheck.ts`, `rule-settings.ts`): kept in memory,
  per server process and per board (the sample's one, DEMO), as the service keeps them in its snapshot: the board's
  revision, each rule's overrides (only what differs from the catalogue) and every change, never purged until the
  server restarts, which forgets them, as a demo should. The sample's engine reads every threshold from the board's
  settings (the catalogue's thresholds are only its defaults), and a preview and a save follow the service's
  semantics (4.21, 4.22): finding ids from each rule's own version, evidence keys from the catalogue's values,
  `settings_changed` and `superseded` as the service resolves them, the cross-rule rule, 409 and 422. The replay
  itself runs "as if always" (one run reads the settings as if they had always been the board's); the dataset then
  keeps the past as it was and applies each revision from its re-check on (at the save's moment, never before the
  last rules run), so findings resolved before a change stay as they were, and the views are worked out once per
  revision. A save's re-check takes four reads' latency (`SAMPLE_LATENCY`; at once when 0), running and then applied
  with what it opened and closed. A save is recorded under the reader (the local reader with sign-in off) at the
  sample's "now". The vitest suites set the board back with `resetSampleRuleSettings()`; the end-to-end spec runs on
  a server of its own (port 3402) and puts every rule back to the catalogue after each test, through the route, as an
  admin would. Every response is checked against its schema as it is served.
- Custom rules (JO-20, `sample/custom-rules.ts`, `custom-checks.ts`, `drafter.ts`, with the store above): kept in the
  same store, created, edited, deleted (kept, marked deleted) and brought back as the service keeps them, with its ids
  (`R-CUS-01`, `W-CUS-01`, numbered per kind, never reused), the 50 limit, title rules and history. The checks come
  from the registry the interface shares with the service (`CHECK_REGISTRY`), the options from DEMO's own names (To Do,
  In Progress and Done; Task, Bug, Subtask, Test and Epic), and a change is checked with the same words the page uses
  (`src/lib/api/custom-rules.ts`). The sample's engine runs a custom rule on the world **as of now**, every check of
  4.20 with the four new ones: its findings are first seen at the re-check after its save, as the service's first
  re-check opens them, under its identity version (`c<revision>`); narrowing it or deleting it closes them as
  `settings_changed`, an undo of the deletion reopens the same ones. The draft (4.23) is a keyword script in
  TypeScript (`sample/drafter.ts`) mirroring the service's `ScriptedProvider` script rule for rule and in its order
  ("reopen", "skip", "effort" with "N×", "no assignee", "no epic", "no estimate" or "not in a sprint", "no update",
  "untouched" or "nobody has touched", "open for" or "older than" for an age, a status of the board's as whole words
  for a time in a status; an issue type named, "warning" or "early" for the seriousness), a length of time in figures
  or words ("two weeks", "a day"), a limit the words do not give drafted as the check's default and said so, the name
  without its limit, the explanation saying the categories it looks at; anything else not supported, a status DEMO
  does not have among it ("Bugs in Code Review for more than 3 days"), naming the closest check as the service's
  script does. The service's own eval of its script (`tests/eval/rule_drafts.yaml`, copied as
  `src/server/__tests__/fixtures/rule-drafts.json`) runs against it in the suite, so the two scripts cannot drift.
  Each draft is checked as a save would be. It takes Ask's latency.

- The sample's boards (JO-17, JO-18; `sample/boards.ts`, `sync.ts`, `served.ts`): DEMO, everything above, the
  default; MOB, "Mobile app", a second, small board (180 issues), synced, told by the same generator from a seed of
  its own, with the same eight people, its own keys, sprint ids and changelog ids; and HELP, "Help desk", a
  `service_desk` board that has never synced (90 issues once it has). `GET /projects` lists the three in the
  service's order; the Portfolio lists DEMO and MOB and counts HELP in `boards_not_synced`; a person card names the
  other synced board (MOB on DEMO's cards, DEMO on MOB's) before its two made-up boards. Every board-scoped route
  on HELP answers 409 `board_not_synced`, and its health has no sync time, until its first sync has run. Sync is
  simulated, in memory per server process: there is no Jira behind the sample, so a sync copies nothing, but it
  takes eight reads' latency (at least 1.5 s, so it is seen even with `SAMPLE_LATENCY=0`), a board's first sync
  twice that, one at a time, another board's queued behind it, a press while one runs or within 30 s after it ended
  reporting it. Once HELP's first sync has ended it serves its own small world, like MOB; a restart forgets every
  sync, and HELP is unsynced again. The vitest suites set it back with `resetSampleSync()`; the end-to-end spec
  that syncs runs on a server of its own.
- Ignores (4.26 to 4.28; `sample/ignores.ts`, `ignore-views.ts`): kept in memory, per server process and board, as the
  service keeps them, by ticket and rule (none for a whole ticket), restored ones kept as history, never purged until
  the server restarts, which forgets them. The board's findings are worked out as the rules leave them, then each
  finding a standing ignore covers that was open when the ignore was made (read as a re-check reads a save: never
  before the last rules run), or that opened after, is resolved as `ignored` at that moment; so ignoring and restoring
  move every view at once, and a restore leaves exactly the findings the rules still hold open, under their own ids
  and first sighting, as the service's re-check would (its `recheck` says `succeeded` at once). A rule settings preview
  or save never opens or closes an ignored finding. `activeIgnores(board)` answers `covers(key, ruleIds)` (the
  ticket's own ignore first) and `ticket(key)` for the views that leave an ignored ticket out of a measure. Ignores
  are recorded under the reader (the local reader with sign-in off) at the sample's "now". The vitest suites set the
  board back with `resetSampleIgnores()`; the end-to-end spec that ignores runs on a server of its own.

Every view is computed from the same findings and the same issues, and the tests hold them to it: an
Overview total is the total behind the Findings filter it clicks through to, the rule catalogue's open
count, the last point of its trend, the figure the briefing quotes and the fact an answer cites.

Ask in sample mode follows the service's pipeline with a script in the model's place. Questions are
matched by concept and by letter pairs, so other wordings and typos land. The same validator (a port of
`ask/validate.py`, held to its tests) decides what may be shown. The scripted questions reach all five
outcomes:

| Question | Outcome |
|---|---|
| Where do tickets get stuck most? | answered (`oversight_time_in_status`) |
| Which epics have the most open breaches? | answered (`oversight_hot_spots`) |
| How much work was estimated before it started? | answered (`oversight_coverage`, `oversight_rule_status`) |
| Which tickets went straight from To Do to Done this month? | answered (`oversight_list_findings`) |
| How is effort against estimate trending? | answered (`oversight_trend`, `oversight_effort_vs_estimate`) |
| Which rules can't be measured in Jira today? | answered (`oversight_rule_status`) |
| Which open tickets have burned the most of their estimate? | answered (`oversight_top_issues`) |
| Which tickets have been reopened after Done? | answered (`oversight_list_findings`, `oversight_rule_status`) |
| What happened to DEMO-1? (any key) | answered (`oversight_issue_timeline`); `no_data` for a key not in the project |
| Which tickets were reopened this week? | no_data |
| Which tickets reached testing without code review? | not_measurable (`code_review`) |
| What is the median cycle time this quarter? | not_verified: its drafts quote a quarterly figure the weekly facts cannot vouch for |
| Who is the slowest developer? (any question about people, at team level) | not_understood: `Ask answers at team level. …` |
| Anything else | not_understood, with suggestions |

At people level (sign-in off, as the sample runs, or an admin), the same questions are answered the same
way, naming no one, and questions about people are answered from the views of 4.6, read with
`oversight_query` and the query in the facts:

| Question | Outcome |
|---|---|
| Who has the most open breaches? (or warnings) | answered: the ranking from the `people` view (people only, ties by name), its leader's figures and the two who follow, then `Unassigned: 15 open breaches.` and `A person's findings are those on their tickets.`; `people` lists the three |
| Who holds the most open tickets? Who has the fewest? | answered: the same ranking by open tickets (Epics left out, the scorecard's figure), `Dev Malhotra and Grace Lindqvist have the most open tickets, 13 each, then …`, then `Unassigned: 9 open tickets.`: the work that counts for no one is one row after the people and one sentence after the ranking, never ranked (JO-12, G5) |
| What are @X's open findings? (or breaches, or warnings; one mention) | answered: X's row of the `people` view and their newest open findings, on the tickets that count for them |
| What is @X working on? (one mention) | answered (`oversight_person_tickets`, state in_progress): X's tickets in progress, those that count for them |
| A question mentioning two to ten people | answered: each one's open breaches and warnings |
| Is @X doing well? How is @X doing? Is @X lazy? (one mention, evaluating or personnel) | answered (`oversight_person_scorecard`): X's summary next to the board, then (personnel) `The figures are above; the decision is yours.`, then the caveat |
| How are @X and @Y doing? (two to ten mentions) | answered: their scorecards side by side; with `SAMPLE_PEOPLE_COMPARISON=off`, not_understood with the comparison-off sentence |
| Who is best on the board? Rank the others. (no one named) | answered (`oversight_people_compare`, overall, or the measure the question names): everyone in order, closer to the process first; with comparison off, the comparison-off sentence |
| Who is the slowest developer? Who needs the most help? Who is furthest from the process? Who is worst for reopened work? Who needs the least help? (no one named) | answered (`oversight_people_compare`): further from the process first (overall `fewest`, `Measures closer to the process than the board, last 90 days, fewest first: …`; reopened `most`, `highest first`), and the least of that closer first; never "worst" in the answer; with comparison off, the comparison-off sentence (the JO-14 review) |
| Who has the most reopened tickets? Who has the fewest tickets stuck in a status? Who has the lowest open findings per 10 open tickets? Who has more reopened tickets, @Ada Brooks or @Carmen Ruiz? | answered (`oversight_people_compare`, the measure named, `order` `most` or `fewest`): everyone (or those two) in the order asked, `Reopened after Done, last 90 days, highest first: …`, `Open tickets stuck in a status, lowest first: …`, too few tickets last; with comparison off, the comparison-off sentence (JO-14) |
| What is @X's backlog? (one mention) | answered (`oversight_person_tickets`, state open): X's open tickets |
| Who has the biggest backlog? Who is overloaded? Who is the busiest? Who has the most work? Who is over capacity? | answered (`oversight_people_compare`, `open_tickets`): everyone's open tickets, most first, the same figure as one person's backlog, then `Unassigned: 9 open tickets.` and `The whole board: …`; no period, no caveat |
| Who is doing the most? Who did the most this month? | answered: the open tickets, most first, then (`done_in_period`, the question's period) the tickets done, most first, in one paragraph; then the caveat |
| Who could take more work? Who has capacity? Who is doing the least? Who is underworked? Who has the lightest load? Who is available? | answered: the open tickets fewest first, then the members with no tickets (`oversight_board_people`, `none`) |
| Who is idle? Who has nothing in progress? Who contributes least? | answered: the count (in progress, done in the period) fewest first; for the first, then the members with no tickets |
| Who is on this board? List the members. Who has no tickets? | answered (`oversight_board_people`): `11 people are on this board: Ada Brooks, … and Hana Mori, and 3 members who have none of its tickets: Noor Haddad, Tomás Ferreira and Yuki Tanabe.`, each name once (JO-12, G8); or only those members |
| Is Ada Brooks doing well? (a full name typed, no @) | as if picked with @ (a name two people share asks for @) |
| how is ada doing? (a first name in lower case where a name stands, nothing else answering it) | as if picked with @, when one person on the board has that first name (two: asks for @, naming them) |
| What is @Noor Haddad working on? (any question whose mentions are all members with no tickets) | no_data: `Noor Haddad has no tickets on this board.` as the answer, `people` naming her, nothing planned; two or three of them, one sentence naming each |
| What are @Carmen Ruiz's and @Yuki Tanabe's open findings? (some mentions with tickets, some without) | answered about Carmen Ruiz, then the paragraph `Yuki Tanabe has no tickets on this board.`; `people` lists both |
| A mention of someone not on the board at all | not_understood: `Someone you mentioned has no tickets on this board.`, nothing planned |
| how is ana doing? Who is Zara? What is zara's backlog? (a name typed where a person's name stands that no one on the board goes by) | not_understood: `No one called Ana is on this board.`, nothing planned (JO-12, G3) |
| Another question about people (Show cycle time per person. Who works weekends?) | answered (`oversight_people_compare`, overall): `This answer uses the overall comparison: the number of measures on which each person is closer to the process than the whole board.`, then the comparison and the caveat; never turned away (JO-12, G3/G4). With comparison off, not_understood, pointing to the ranking and to @ |

The synonym table and its 67 paraphrases are the service's (`oversight/ask/router.py`, `tests/test_jo11_leftovers.py`);
the sample reads the same words and is held to the same table, plan for plan (`src/server/__tests__/ask-jo11-leftovers.test.ts`).
So are the direction words of most and fewest and their table of 54 questions (`tests/test_most_fewest.py`, and
`src/server/__tests__/ask-most-fewest.test.ts`): the measure, the order and the first sentence, question for question.

## 8. Where this contract asks the Python code to change

Found while building against `oversight/` as it stands; each is small.

1. **Hot spots and "no epic".** `oversight_hot_spots` joins findings to issues, so sprint findings
   (`issue_key = "sprint:<id>"`) drop out, while the findings filter `epic=none` includes them. One
   definition is needed for a hot spot to click through exactly: group findings with no epic, sprint
   findings included, under `(no epic)`.
2. **Effort medians.** `oversight_effort_vs_estimate`'s note says "done work … that has both an estimate
   and logged time", but its SQL (and `oversight_trend`'s) keeps estimated work with nothing logged, whose
   effort ratio is 0. Those zeros are missing data, not effort, and they drag the median down. This
   contract follows the note: require `time_spent_s > 0` as well as an effort ratio.
3. **Naming the epic in an effort answer.** Grouped by epic, `oversight_effort_vs_estimate` puts the epic
   key in a `text` column, and the validator only takes keys from `issue_key` columns, so an answer cannot
   name the epic it is about. Give the `group` column kind `issue_key` when grouping by epic, and add an
   `epic_title` text column (the sample does both).
4. **Candidate detail.** `Candidate.detail` is a free dict in weekly.py. This contract sends it as a list of
   `{key, label, value, unit}` so the page can render any candidate without knowing its kind. Build the
   candidates-as-facts the validator reads from the same entries.
5. **Column kind `count`.** The catalogue has it and this contract accepts it; keep using it for integers.

## 9. Changing the contract

Change `src/lib/api/schemas.ts` first, then this document, then the sample generator until
`npm test` passes, then the Python service. Adding a field is backwards compatible (the interface ignores
fields it does not know until the schema names them). Once the schema names a field it is required, so
the service must send it before such an interface goes out: `GET /people`, the `person` parameter,
`facets.people` and `assignee` (JO-06) are released on both sides together, and so are the person's
`avatar`, the people facet entry's `avatar` and `GET /people/{person_id}/avatar` (11 Nov 2026), and so are
Ask's `people` in the response and `level` and `mentions` in the request (11 Nov 2026: until the service
sends `people`, every live answer is 502 `upstream_invalid`), and so are `GET /people/directory` and the
mention rules for people with no tickets (JO-10, 11 Nov 2026: until the service serves the directory, the
live @ list says it could not load the board's people, with Try again), and so are `GET /people/scorecard`, its
`level` parameter and Ask's two scorecard tools (JO-11, 12 Nov 2026: until the service serves the scorecard, the
live People page says it could not load the figures, with Try again), and so are `GET /people/{person_id}/card` and the
access log's `person_card_view` (JO-13, 12 Nov 2026: until the service serves the card, a live card says the person is
not on this board, since the service answers 404 to a route it does not have; and an access log holding a card read
fails this interface's schema until both sides know the action), and so are the Portfolio's `attention[].findings`
and its one item for each ticket and rule (13 Nov 2026: until the service sends them, the live Portfolio says it could
not be loaded, with Try again, so restart the service with the interface), and so are `GET /rules`'s `enabled` and
`customised`, the finding's `settings_changed`, and `GET /rules/settings` with its preview and save (JO-15, 17 Nov 2026:
until the service sends `enabled` and `customised`, the live Process page says it could not load the rules, with Try
again; until it serves the settings, its 404 for them is 502 `upstream_error`, "The oversight service does not offer
rule settings yet: it may be an earlier version than this dashboard.", which the rule settings page says with Try
again), and so are `GET /projects`'s `synced` and `type`, the Portfolio's `boards_not_synced`, `/refresh`'s `project`
and its `queued` state, and the 409 `board_not_synced` (JO-17, JO-18, 18 Nov 2026: until the service sends them, the
live board list, the Portfolio and Sync fail this interface's schema, so release the service with the interface), and
so are a board's own rules (JO-20, 23 Nov 2026): `GET /rules/settings`'s `checks`, `custom_limit`, `custom_count` and
`ai_draft`, each rule's `check_label`, `custom` and `applies_to` and each param's `kind` and `options`, the four
change ops and their history fields, the widened rule id, and `POST /rules/settings/draft` (until the service sends
them, the live rule settings page says it could not load the settings, with Try again; `GET /rules`'s `custom` and
`check_label`, a param's `kind`, a rule's `created_at` and `created_by` and the board's `issue_types` are read as
absent from a service that predates them, and its 404 for a draft is 502 `upstream_error`, "The oversight service does
not draft rules yet: it may be an earlier version than this dashboard."), and so are the scorecard's `basis`
`"credit"` and `GET` and `PUT /people/credit` (4.29, 26 Nov 2026: until the service sends `basis: "credit"`, the live
People page says it could not load the figures, with Try again, and until it serves the setting, the control says it
is not loaded and its dialog that it could not load the choices, with Try again), and so are the finding's `ignore`, the
`ignored` state and its facet, the `ticket` filter and the four routes of ignoring (4.26 to 4.28, 26 Nov 2026: until the
service sends `ignore`, every live findings, finding and issue read fails this interface's schema, so release the
service with the interface; until it serves the routes, an ignore says the service does not ignore findings yet).
Renaming or removing one, or changing its type, needs both sides released together and `api_version` raised.
