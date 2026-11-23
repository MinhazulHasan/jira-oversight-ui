# The oversight service's own answers (JO-15, JO-20)

Rule settings bodies as the live oversight service (`jira-oversight-sys`) really sends
them, so `contract.test.ts` holds the dashboard's zod schemas and its live forwarding
(`src/server/live.ts`) to the service itself, not only to bodies written by hand or by the
sample. Captured on 23 Nov 2026 from the JO-20 service through FastAPI's `TestClient` on a
scratch demo snapshot (`seed_demo`: DEMO synced with 1,150 issues; AIL configured and never
synced), never the real database, with a made-up viewer ("Morgan Reyes") and the service's
scripted drafter (`LLM_MODE=stub`). No real person, account id or email address is in them.

| File | Request | Shows |
|---|---|---|
| `rule-settings-applied.json` | `GET rules/settings` | Revision 0, applied |
| `rule-settings-saved.json` | `POST rules/settings` | A save's answer: revision 1, its re-check running |
| `rule-settings-undone.json` | `POST rules/settings` with `undo_of` | An undo's answer: revision 2, running |
| `rule-settings-running.json` | `GET rules/settings` | A re-check under way |
| `rule-settings-failed.json` | `GET rules/settings` | A re-check that failed |
| `rule-settings-pending.json` | `GET rules/settings` | After the service restarted: waiting for the next sync |
| `rule-settings-applied-by-cycle.json` | `GET rules/settings` | Applied by the scheduled cycle's own rules run |
| `rule-settings-custom.json` | `GET rules/settings` | Custom rules (JO-20): three added, then one edited, one narrowed and one deleted in a save |
| `rules-custom.json` | `GET rules` | The Process page's catalogue holding those custom rules |
| `rule-settings-preview.json` | `POST rules/settings/preview` | Eight changes' impact |
| `rule-settings-preview-not-measurable.json` | `POST rules/settings/preview` | A rule the board cannot measure, with its note |
| `rule-settings-preview-custom.json` | `POST rules/settings/preview` | Three new rules, under the ids a save would give them |
| `rule-settings-preview-custom-changes.json` | `POST rules/settings/preview` | A custom rule edited, one narrowed, one deleted |
| `rule-settings-drafts.json` | `POST rules/settings/draft` | The scripted drafter's answers by outcome: `drafted`, `not_supported`, `not_understood`, and a draft with `problems` |
| `rule-settings-refusals.json` | `POST rules/settings`, its preview and its draft; `GET rules/settings` and `GET rules` for AIL | Every refusal, by case: `{status, body}` for 409, 503 and each 422 (custom rules' among them, and a draft's words), and a board never synced (409 `board_not_synced`) |

Capture them anew whenever the service's answers change: run each request against the
service's app on a fresh demo snapshot in a scratch folder, and write each 200 body (and
each refusal's status and body) here as it came, two-space JSON.

Since JO-17 a board that has never synced answers every route with 409 `board_not_synced`,
rule settings and the catalogue among them, so the JO-15 captures of a never-synced board's
settings and catalogue are gone; its 409 is among the refusals.
