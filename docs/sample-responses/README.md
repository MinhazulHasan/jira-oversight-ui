# Sample responses

Real responses from `/api/oversight/*`, captured from a production build
(`next start` on port 3400) in sample mode with `SAMPLE_NOW=2026-11-04T14:30:00Z`
and `SAMPLE_LATENCY=0`, the settings the screenshots and end-to-end tests use. They
are the fictional DEMO project (the Portfolio and a person card also name the sample's
second board, MOB, and count its third, HELP, which has never synced): sample data,
describing no real work and no real person. The eleven people it names are fictional: eight who hold its work, and three
members of the board who hold none of its tickets (Noor Haddad, Tomás Ferreira and Yuki
Tanabe). They appear only as the contract's person objects (an id, a display name and
their picture's version, `avatar`), never with an email address, a picture's address or
an account id. Two of the eight have a picture, an abstract pattern drawn in code
(`src/server/sample/pictures.ts`), which `GET people/{id}/avatar` serves; everyone else
has `avatar: null`.

Sign-in is off for them, so Ask answers at people level, as it does for an admin: a
team-level reader gets the same shapes with `people` always empty, and questions about a
person declined; the scorecards are people level's alone. Comparison is on unless a file
says otherwise (`SAMPLE_PEOPLE_COMPARISON=off`, the sample's stand-in for the service's
`PEOPLE_COMPARISON`).

Build pages against these shapes; the contract they follow is `docs/API_CONTRACT.md`
and `src/lib/api/schemas.ts`. Read data in pages through the hooks in
`src/lib/api/hooks.ts`, never by fetching these files.

| File | Request | Shows |
|---|---|---|
| `health.json` | `GET health` | The data source, read-only, last synced |
| `overview.json` | `GET overview` | Tiles with 12 weekly windows, five hot spots, findings by rule, coverage (two not measurable), four trend cards, where work sits, the briefing's first two sentences |
| `people.json` | `GET people` | Everyone assigned a ticket on the board, most open breaches first, and the Unassigned row (`person: null`) |
| `people-directory.json` | `GET people/directory` | Everyone on the board, by name: the eight with tickets and the three members with none (`tickets: 0`). What Ask's @ list offers |
| `findings.json` | `GET findings` | Open findings, newest first, page 1 of 25, each with its assignee, and facet counts (people among them) |
| `findings-filtered.json` | `GET findings?severity=breach&epic=DEMO-704&sort=issue_key&order=asc&page_size=5` | Filters, sort and paging; facets ignore their own filter |
| `finding.json` | `GET findings/{id}` | A breach that a warning foreshadowed (`warned_before`), with its issue's assignee and timeline |
| `finding-sprint.json` | `GET findings/{id}` | A sprint finding (W-SPR-01): no issue, so no assignee and an empty timeline |
| `issue-DEMO-1.json` | `GET issues/DEMO-1/timeline` | A late estimate, a reopen and an overrun, with its assignee, changelog and weekly worklog totals |
| `ask-answered.json` | `POST ask` "Which epics have the most open breaches?" | An answer with citations bound to fact cells |
| `ask-answered-trend.json` | `POST ask` "How is effort against estimate trending?" | Dates and a note cited; two fact sets |
| `ask-not-understood.json` | `POST ask` "What is the weather?" | Not a question the Jira data can answer: what can be asked, with suggestions |
| `ask-no-data.json` | `POST ask` "Which tickets were reopened this week?" | An empty result and what was looked at |
| `ask-not-measurable.json` | `POST ask` "Which tickets reached testing without code review?" | The missing evidence, and why that is a finding |
| `ask-not-verified.json` | `POST ask` "What is the median cycle time this quarter?" | The facts only, without the answer that could not be verified |
| `ask-people.json` | `POST ask` "Who has the most open breaches?" | People level: the ranking read from the people view, and `people`, the people the answer names, in order |
| `ask-person.json` | `POST ask` "What are @Carmen Ruiz's open findings?" with `mentions` (her person id) | One mentioned person's open findings: their counts, the newest, and the query that found them by person id |
| `ask-person-no-tickets.json` | `POST ask` "What is @Noor Haddad working on?" with `mentions` (her person id) | A member with no tickets: `no_data`, the sentence built in code as `answer` (`message` null), no facts, no plan, and `people` naming her |
| `people-scorecard.json` | `GET people/scorecard` | Everyone who holds a ticket (comparison on, the default): the eleven measures, the whole board's figures, and each person's, with `enough` and `vs_board`; code review not measurable on DEMO, with its reason |
| `people-scorecard-person.json` | `GET people/scorecard?days=30&person={Hana Mori's id}` | One person over 30 days: rates with too few tickets to compare (`enough: false`, `vs_board: null`) beside ones compared |
| `people-scorecard-off.json` | `GET people/scorecard` with `SAMPLE_PEOPLE_COMPARISON=off` | Comparison turned off: `comparison: "off"`, `people: []`, the board's figures still there |
| `error-comparison-off.json` | `GET people/scorecard?person=…&person=…` with `SAMPLE_PEOPLE_COMPARISON=off` | Two people side by side where comparison is off: 403 `comparison_off`, in the contract's words |
| `ask-scorecard.json` | `POST ask` "Is @Carmen Ruiz doing well?" with `mentions` | A question that evaluates someone, answered with their scorecard (`oversight_person_scorecard`): the summary built in code, then the caveat |
| `ask-scorecards.json` | `POST ask` "How are @Ada Brooks and @Carmen Ruiz doing?" with `mentions` | Two people's scorecards side by side: a summary each, then the caveat |
| `ask-comparison.json` | `POST ask` "Who is best on the board? Rank the others" | Everyone in order of how closely they follow the process (`oversight_people_compare`, overall: the measures on which each is closer to the process than the board, and each person's open findings per 10 open tickets with its counts and whether it rests on enough tickets; the overall order has no board row); nobody called "best" |
| `ask-comparison-off.json` | the same with `SAMPLE_PEOPLE_COMPARISON=off` | `not_understood` with the comparison-off sentence |
| `ask-personnel.json` | `POST ask` "Should we promote @Carmen Ruiz?" with `mentions` | A personnel question: the scorecard, then "The figures are above; the decision is yours.", then the caveat |
| `ask-backlog.json` | `POST ask` "What is @Carmen Ruiz's backlog?" with `mentions` | Her open tickets (`oversight_person_tickets`, state open), each row's assignee by id and name |
| `insights.json` | `GET insights/latest` | The weekly briefing: five sentences, their tones and the ranked candidates |
| `trend-median_effort_ratio.json` | `GET trends?metric=median_effort_ratio` | Twelve weeks, the last one to date |
| `rules.json` | `GET rules` | The catalogue as the board runs it (every rule, `enabled` and `customised`, and JO-20's `custom` and `check_label`: none of DEMO's rules is custom until an admin adds one), with open counts, and James's process against DEMO's workflow |
| `rule-settings.json` | `GET rules/settings` | JO-15: the board's rule settings before anyone has changed them: revision 0, applied, every catalogue rule with its switch, severity and editable thresholds (each with its value, the catalogue's default, its bounds and step), its open findings, and an empty history. JO-20: each rule's `custom`, `check_label` and `applies_to` (rules.yaml's); the `checks` a custom rule may use, each param with DEMO's own options (its statuses with their categories, its mapped stages, the evidence names) and the two evidence checks not measurable on DEMO; its `issue_types`; `custom_limit` 50, `custom_count` 0; and `ai_draft` available (the sample's scripted drafter) |
| `rule-settings-preview.json` | `POST rules/settings/preview` with R-EFF-01's threshold at 2 and W-AGE-01 turned off | What the changes would do to each rule's open findings: how many would close, open and stay, with up to five tickets each way; nothing is saved |
| `rule-settings-preview-new-rule.json` | `POST rules/settings/preview` with a new rule (JO-20): bugs in In Progress for over 72 hours, a breach | A new rule's impact, named by the id it would be given (R-CUS-01): every finding it would raise now, with tickets to look at; nothing is saved |
| `rule-settings-draft.json` | `POST rules/settings/draft` with "Bugs in progress for more than 3 days" | JO-20: the sample's scripted drafter's rule (the model's stand-in): Time in a status, In Progress, 72 hours, Bug, In progress, a breach, with its name and what it flags; nothing is saved |
| `error-rule-settings-invalid.json` | `POST rules/settings/preview` with W-EFF-01's threshold at 1.6 | 422 `rule_settings_invalid`: the warning would no longer come before its breach (R-EFF-01 at 1.5), said at `W-EFF-01.params.threshold` |
| `error-rule-settings-conflict.json` | `POST rules/settings` with `revision: 7` | 409 `rule_settings_conflict`: the board's settings are not at the revision the changes were made against |
| `baseline.json` | `GET baseline/latest` | The ground-truth report and its comparison with an audit |
| `portfolio.json` | `GET portfolio` | Every synced board at a glance (the sample's two, DEMO and MOB): the Overview's own figures for each, its 8-week open-findings trend, the sprint's unestimated work and risk, the top rule; the ten oldest open breaches across them ("Needs attention"), one for each ticket and rule with how many open findings of it the ticket holds (`findings`), ties taking turns by board; and how many boards have not synced yet (`boards_not_synced`: HELP) |
| `person-card.json` | `GET people/{Ada Brooks's id}/card` | The person card (JO-13), 90 days: her open, in-progress and done counts (her scorecard's), her open findings (her `GET people` row's), how her figures stand next to the board's (`process`), the three tickets she has been on longest and how many more, the other boards she holds open tickets on (`other_boards`: the sample's MOB, then two made-up boards it does not serve), and when anything last happened on her tickets |
| `person-card-member.json` | `GET people/{Noor Haddad's id}/card?days=30` | A member of the board who holds none of its tickets: `member_no_tickets`, every count 0, `process: null`, nothing in progress, no activity; she holds open tickets on another (made-up) board |
| `access-log.json` | `GET access-log?limit=6` | The newest six reads of person-level figures, newest first, with `next_cursor` for the page after: fictional viewers (two admins, a user, a session from before names were kept, and the local reader with sign-in off), the people read as person objects, and each entry's `detail` as the page reads it (`days`, `qa_id`, `entries`) |
| `access-log-filtered.json` | `GET access-log?action=scorecard_view&action=people_compare_view&person={Ada Brooks's id}&limit=3` | The filters: two actions, and one person among an entry's subjects |
| `usage.json` | `GET usage` | Ask's questions, model calls and tokens today (UTC, to now) and over the last 7 days; no daily budget set (`budget_tokens: null`) |
| `error-not-found.json` | `GET issues/DEMO-99999/timeline` | A 404 body |
| `error-bad-request.json` | `GET findings?colour=red` | A 400 body listing the refused parameter |

To capture them again after a change to the sample, start a production build with
the settings above and request the same paths. `src/server/__tests__/contract.test.ts`
holds every file here to what the route answers, byte for byte, so a stale one fails `npm test`.
