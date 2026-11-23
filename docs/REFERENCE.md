# Jira Oversight · interface

The front end of the **Jira Oversight System** for ManCo Central: a read-only,
"supercharged dashboard for looking at the work". Rules in code decide what is
wrong, AI explains it, and every figure on screen traces back to the Jira
tickets behind it.

Next.js (App Router) and TypeScript. The browser only ever talks to this app;
the route handlers under `/api/oversight` are the credential boundary in front
of the oversight API (Python, FastAPI, port 3300). Until that API exists, the
app runs on a bundled, clearly labelled sample project, `DEMO`.

Design brief: [`docs/DESIGN.md`](DESIGN.md). Read it before changing anything visible.

---

## Quick start

| | |
|---|---|
| Node | 20.9 or newer (developed on 24) |
| npm | 10 or newer (developed on 11) |
| Port | 3400, for `dev` and `start` |

```bash
npm install
npx playwright install chromium     # once, for e2e tests and screenshots
copy .env.example .env.local        # cp on macOS / Linux; the defaults run sample mode
npm run dev                         # http://localhost:3400
```

Production:

```bash
npm run build
npm run start                       # http://localhost:3400
```

## Environment

Every variable is read on the server only. None carries a `NEXT_PUBLIC_`
prefix, and none may: that would inline it into the browser bundle.

| Variable | Default | Meaning |
|---|---|---|
| `OVERSIGHT_DATA` | `sample` | `sample` serves the bundled DEMO project; `live` reads the oversight API |
| `OVERSIGHT_API_URL` | `http://localhost:3300` | The oversight dashboard API (live mode) |
| `OVERSIGHT_SERVICE_KEY` | (empty) | The credential presented to the API. Never leaves the server |
| `OVERSIGHT_JIRA_BASE_URL` | (empty) | The Jira site, for "Open in Jira" links in live mode. Required with sign-in on: every account must reach it |
| `SAMPLE_NOW` | (empty) | Sample mode: pin "now" (ISO 8601) so weeks and ages are reproducible |
| `SAMPLE_LATENCY` | (empty) | Sample mode: artificial delay in ms, to see loading states |
| `SAMPLE_PEOPLE_COMPARISON` | `on` | Sample mode: `off` shows the People page and Ask as an organisation that turned comparing people off would (the service's `PEOPLE_COMPARISON`) |
| `AUTH_MODE` | on for live, off for sample | `atlassian` (sign in with Atlassian) or `off` |
| `APP_URL` | (empty) | The address the dashboard is served from, origin only. The OAuth callback is this plus `/api/auth/callback` |
| `ATLASSIAN_CLIENT_ID`, `ATLASSIAN_CLIENT_SECRET` | (empty) | The Atlassian app's credentials, from the developer console |
| `AUTH_SECRET` | (empty) | At least 32 characters of random; seals the session cookie. Changing it signs everyone out |
| `ALLOWED_EMAIL_DOMAINS` | (empty) | Comma-separated email domains allowed in; exact match, no wildcards |
| `ATLASSIAN_AUTH_URL`, `ATLASSIAN_API_URL` | Atlassian's | Tests only: a local stand-in for Atlassian |

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Development server on 3400 |
| `npm run build` | Production build (type-checks with `tsc`) |
| `npm run start` | Production server on 3400 |
| `npm run lint` | ESLint: Next, React hooks, TypeScript and the jsx-a11y recommended rules |
| `npm run typecheck` | Generates route types, then `tsc --noEmit` |
| `npm test` | Unit tests (Vitest, jsdom, Testing Library) |
| `npm run e2e` | Playwright against a production build on 3400 in sample mode: every route, both themes, console errors (including CSP violations) and axe. The People, Ask and @ specs run again on 3401 with `SAMPLE_PEOPLE_COMPARISON=off`, and the rule settings spec (JO-15) on a server of its own on 3402, Chromium then WebKit, one test at a time, since its saves change that server's findings; all served from the build in `.next` (a server already on 3400 is reused, so build first if that is `npm run dev`) |
| `npm run e2e:auth` | The sign-in suite (`e2e-auth/`): a production build with sign-in on, against a mock Atlassian, on 3403 to 3405. `E2E_NO_BUILD=1` reuses the build in `.next` |
| `npm run shots` | Screenshots of every route and shell state, light and dark, into `shots/` |
| `npm run icons` | Re-renders `apple-icon.png` and `favicon.ico` from `src/app/icon.svg` |

`npm run shots` builds nothing: run `npm run build` first. It reuses a server
already on 3400, or starts one in sample mode and stops it afterwards. The
browser clock is frozen at 2026-11-04 14:32 UTC and motion is reduced, so every
run produces the same pictures. A page is not done until someone has looked at
its screenshots. The People page and Ask's scorecards are taken with comparison
as the server has it; for the "off" pictures, start a second server with
`SAMPLE_PEOPLE_COMPARISON=off` and set `SHOTS_URL` and `SHOTS_DIR` to it.

## Deploying

The production build is a self-contained server (`output: "standalone"`, switched on by `STANDALONE_OUTPUT=1`): `server.js`
with only the packages it uses. It binds the `PORT` and `HOSTNAME` it is given and reads every setting above when it
starts, so a build holds no secret and serves any deployment. Two ways to run it, both described in the oversight
service's folder (`jira-oversight-sys`):

- IIS on Windows Server: `docs/DEPLOYMENT_IIS.md`. `deploy/iis/Publish-Dashboard.ps1` builds this folder and copies the
  server out; IIS starts `node server.js` through HttpPlatformHandler and passes it the port in `%HTTP_PLATFORM_PORT%`;
  the settings are a file node reads at start (`node --env-file=dashboard.env server.js`).
- Docker: `Dockerfile` here and `deploy/docker-compose.yml` there (`docs/DEPLOYMENT.md`).

To try the standalone server by hand, after `STANDALONE_OUTPUT=1 npm run build`, copy `.next/static` to
`.next/standalone/.next/static` and `public` to `.next/standalone/public`, then run
`PORT=3400 HOSTNAME=127.0.0.1 node .next/standalone/server.js`. Leave `.next` alone while a development server runs.

## Architecture

```
src/
  proxy.ts                  the sign-in gate, then the per-request nonce and Content Security Policy
  app/
    layout.tsx              <html>, fonts, metadata, providers (reads the nonce)
    globals.css             the token system: light first, dark, print, motion
    typefaces.ts            Inter (variable, self-hosted) and IBM Plex Mono
    icon.svg                the product mark (apple-icon.png, favicon.ico from it)
    (app)/                  every page, inside the shell
      layout.tsx            skip link, rail, top bar, palette, shortcuts
      page.tsx              Overview  /
      findings/  issues/[key]/  ask/  people/  insights/  process/  baseline/
      loading.tsx  error.tsx  not-found.tsx
    (missing)/              unknown addresses: the same shell, a real 404 status
    (sign-in)/              /login and /no-access, outside the shell; they never call the oversight API
    api/oversight/[...path] the credential boundary (route handlers)
    api/auth/               sign in with Atlassian: login, callback, logout
  components/
    providers.tsx           TanStack Query, nuqs, next-themes, Radix tooltips, toasts
    shell/                  rail, top bar, command palette, shortcuts, page frame, Sign out
    sign-in/                the sign-in pages' views and every word they say
    ui/                     the UI kit (buttons, badges, tables, drawers, ...)
    charts/                 charts (Recharts) on the validated palette
  lib/
    format.ts               every date, time and figure on screen
    nav.ts                  the pages: names, purposes, shortcuts
    notify.ts               acknowledgement toasts (ok, cite, warn, info)
    shortcuts.ts            the keyboard map
    csp.ts                  the Content Security Policy
    sign-in.ts              sign-in addresses, codes and the safe "next" path
    api/                    the data client (TanStack Query hooks)
  server/
    auth/                   sign-in: configuration, sealed cookies, Atlassian, the gate
  styles/
    components.css          UI kit styles
    charts.css              chart styles and palette
e2e/                        Playwright tests (sample mode, sign-in off)
e2e-auth/                   the sign-in suite and its mock Atlassian
scripts/                    screenshots and icon rendering
```

Pages are server components; `"use client"` appears only where something is
interactive. Data is fetched in the browser with TanStack Query from
`/api/oversight/*`, and every data region has four states: loading (a skeleton
in the final shape), empty (says what was looked at), error (inline, with
retry) and data. The URL is the state: filters, sort, page and the open drawer
live in the query string (nuqs), so any view can be shared with Copy link.

## The credential boundary

The browser never sees the oversight API's address or its key. It calls this
app's own `/api/oversight/*` routes; those route handlers add
`OVERSIGHT_SERVICE_KEY` on the server and forward to `OVERSIGHT_API_URL`. The
Content Security Policy limits the browser to the app's own origin
(`connect-src 'self'`), so no page can call anything else even by mistake.

## Sample and live data

`OVERSIGHT_DATA=sample` (the default) serves a fictional project, `DEMO`, built
into the app so every page can be reviewed without Jira access. It is labelled
as sample data everywhere a reader could mistake it for the real thing: the
data-source pill in the top bar, the foot of the rail, and the provenance line
on every printout. It never imitates real tickets or real people: the eight people
its tickets are assigned to are fictional names. Two of them have a picture, an
abstract pattern drawn in code; the rest show their initials, as anyone does whose
Jira picture the service does not hold.

`OVERSIGHT_DATA=live` reads the oversight API, which copies Jira every 30
minutes. "Last synced" is always visible and turns amber, marked "Stale", when
the data is more than two hours old.

Every Jira board the service's account can browse is in the board picker
(JO-17): searchable, in two groups, "Synced" and "Not synced yet". A board that
has never synced can be picked; every page on it says so and offers "Sync
<Board>", with its progress, and fills in once the sync has run. Sync in the top
bar syncs the board on screen and no other (JO-18), and says which in its name
and tooltip; the service runs one sync at a time, so another board's waits,
"Queued". The sample has three boards to show all of this: DEMO, MOB (synced)
and HELP (never synced; its first sync takes a few seconds, and a restart
forgets it).

## Signing in

With live data the dashboard is closed to anyone who has not signed in with
their Atlassian account (OAuth 2.0 three-legged, read-only scopes `read:me`
and `read:jira-work`). An account gets in when Atlassian shares an email
address that it does not mark unverified, whose domain is on
`ALLOWED_EMAIL_DOMAINS`, and the account can reach the Jira site in
`OVERSIGHT_JIRA_BASE_URL`. Anyone else sees a plain "no access" page, and
every refusal is one JSON line on the server's log (`auth.rejected`: the
reason, the email's domain, and a keyed hash of the Atlassian account id,
never the id itself).

With `ACCESS_MODE=admin-list`, each person who is not an admin reads only the
boards their Jira account can open. At sign-in
the dashboard asks the oversight service which boards it covers, then asks
Jira, as that person (its project search, `read:jira-work`), which of those
they may browse, and keeps the answer in their session. The board picker
lists only those boards; a request for any other board is refused with 403
`board_not_allowed`, and with no board picked their first board is read. An
account that can open none of the boards sees "no access" (`boards`). The
boards are worked out at every sign-in, so a change of permissions in Jira
applies from the next one. With sign-in off, every board is open.

Two levels of access, set in `.env.local` with `ACCESS_MODE` (JO-16), decided
in one place (`src/server/auth/roles.ts`):

- `everyone-admin`, the default when it is empty: everyone who signs in is an
  admin. The top bar shows no "Admin" badge, since it would tell nobody
  anything. Sign-in itself is unchanged: only `ALLOWED_EMAIL_DOMAINS` gets in.
- `admin-list`: as before, admins are the addresses on `ADMIN_EMAILS`, and
  everyone else is a user.

- **Admin**: everyone (`everyone-admin`), or an address on `ADMIN_EMAILS`
  (`admin-list`: the PMs and POs who oversee the work). Sees every board the
  dashboard covers, whatever their own Jira allows, and with `admin-list` the
  top bar says "Admin". Ask answers them about people too:
  typing @ in the question picks people from the board, as in Jira and
  Confluence (the person picked stands in the question as a chip, their
  picture and name), and answers name people (facts only, never a
  judgement). The @
  list is everyone Jira lets you assign the board's tickets to (the service
  fetches them at every sync, `GET /people/directory`), in two groups: "With
  tickets", then "No tickets". Asked about someone with none, Ask says so in
  one sentence, "Noor Haddad has no tickets on this board.", built in code.
  Nothing about people is declined for them (JO-11): a question that
  evaluates someone is answered with figures next to the whole board's,
  everyone in the order the question asks (JO-14: "who has the most
  reopened tickets?" lists the highest first, "the fewest" the lowest first,
  with no such word closer to the process first, and "who needs the most
  help?" or "who is worst for reopened work?" further from it first), and
  the People page (`/people`, theirs alone) shows each person's scorecard
  and, unless the service's `PEOPLE_COMPARISON` is off, everyone side by side.
  Signing in lands them on the Portfolio (`/portfolio`, every board at a
  glance, JO-12), and Governance is theirs alone: the Access log
  (`/governance/access-log`: who viewed whose figures, and when, as the
  service records them: every scorecard, comparison, person's findings,
  question about people and person card; the Overview's open findings by
  person and the @ list's ticket counts are not recorded) and Usage
  (`/governance/usage`: Ask's questions and tokens against the daily AI
  budget). The access log records; it never limits what an admin sees.
  Wherever a person is named (Ask's mentions and answers, Findings, the
  Overview, the People page, the drawer, the access log), resting on the
  name opens their **person card** (JO-13), as Atlassian's profile card does,
  but about their work on the board: their open, in-progress and recently
  done tickets, their open findings, how their figures stand next to the
  board's, what they are working on, the other boards they hold open
  tickets on, and the ways on (their scorecard, their findings, Ask about
  them). A press pins it, a click on a chip in the question box too (as
  Jira's editor does for a mention, leaving the question as it was); on a
  phone it is a bottom sheet. Each card read is in the access log, once in
  ten minutes for one reader, person and board.
- **User** (`admin-list` only): everyone else who signs in. Sees only the boards their Jira
  account can open, as above (the Portfolio too), and Ask answers at team
  level: a question that mentions people is refused with 403
  `people_not_allowed`, and so is a read of the @ list's directory, of a
  scorecard, of a person card, of the access log or of usage; `/people` and
  `/governance/*` are the not-found page, and names are plain names, with no
  card. They land on the Overview, as before.

Every request the dashboard's server forwards names the reader to the service
(`X-Oversight-Viewer`, a keyed hash of the Atlassian account under
`AUTH_SECRET`, and `X-Oversight-Viewer-Name`, the display name the session
keeps from sign-in; `local` with sign-in off), so the access log can say who
read what. Never an email address or an account id (docs/API_CONTRACT.md 4.16).

With sign-in off (the sample), Ask answers about people for everyone, as it
does for an admin.

The session keeps a keyed hash of the email address (never the address), so
the level is decided on every request from `ACCESS_MODE` and `ADMIN_EMAILS` as
the server has them: a change takes effect when the dashboard restarts
(`npm run dev` picks up `.env.local` changes by itself), with no need for
anyone to sign in again. Each admin address must be on
`ALLOWED_EMAIL_DOMAINS`, and Atlassian must say it is verified.

- `src/proxy.ts` runs the gate on every request but the build's static files
  and the icons: a page without a session goes to `/login?next=...`, the API
  answers 401 `unauthenticated`, and the browser's API client sends the reader
  to sign in and back. The oversight route checks the session again, and so
  does the shell's layout, for the one request the proxy never sees (an
  address under `/_next/static/` that is no file, which Next.js answers with
  the 404 in the shell). Every check reads the cookie with Next.js's own
  parser, so they always agree about a request.
- The session is a cookie, `jo-session`, sealed with AES-256-GCM under a key
  derived from `AUTH_SECRET`: HttpOnly, SameSite=Lax, Secure over https, and it
  ends twelve hours after signing in. It holds an account id, the email's domain,
  the site's cloud id, the keys of the person's boards and their Atlassian
  display name (for the access log; one that holds an address is not kept);
  never an email address or a token. A session from before boards were kept reads as
  signed out, so everyone signs in once more after an upgrade. The
  Atlassian token is used during the callback and dropped. It is sealed for
  the site in `OVERSIGHT_JIRA_BASE_URL`, so pointing the dashboard at another
  site signs everyone out, as a new `AUTH_SECRET` does; taking a domain off
  `ALLOWED_EMAIL_DOMAINS` signs its people out at once.
- The server keeps no list of sessions: a session is its cookie. Sign out
  clears the cookie in that browser, which ends the session there. A copy of
  the cookie taken elsewhere would keep working until it expires, at most
  twelve hours after signing in. To end every session at once, change
  `AUTH_SECRET` and restart the dashboard. That also gives every viewer a new
  keyed hash in the access log from then on (their earlier entries keep the
  old one, so the Viewer filter shows only their reads since the change):
  export the access log first.
- When sign-in is on and a variable is missing or wrong, nobody gets in:
  `/login` names the variable (never its value) and the API answers 500
  `not_configured`.
- `AUTH_MODE` defaults to off for the sample project, which has nothing to
  protect, so `npm run e2e` and `npm run shots` run without signing in.
- `/login` and `/no-access` sit outside the shell and never call the oversight
  API. A code in their address (`?error=`, `?reason=`, `?signed_out=1`) only
  picks one of a few fixed messages; nothing from the address is shown back.
  The sign-in button is a plain link to `/api/auth/login`, never a form or a
  prefetching link.
- Sign out sits in the top bar (in the navigation sheet on a phone) and in
  the command palette, only while sign-in is on, and names no one. It is a
  POST, and `/api/auth/logout` refuses one from any other origin. The site's
  `Referrer-Policy: no-referrer` makes a browser send a form's own POST with
  `Origin: null`, so Sign out is a plain button, never a form: it sends a
  same-origin `fetch` with its own referrer policy, which carries the real
  origin, and pressed before the page has hydrated it does nothing rather
  than post a form the route would refuse.
- Every POST to `/api/oversight/*` (a question, "Sync now", a rule settings
  preview, save or AI draft) must come from the dashboard's own pages, sign-in on or
  off: its `Origin` is `APP_URL`'s with sign-in on, and with sign-in off the
  host the browser addressed (a proxy's `X-Forwarded-Host`, else `Host`), and
  a body goes as JSON; anything else is 403 `forbidden` before the body is
  read. The pages send them the same way Sign out does, with a referrer
  policy of their own (docs/API_CONTRACT.md, section 6).
- `npm run e2e:auth` tests all of it against a mock Atlassian
  (`e2e-auth/mock-atlassian.mjs`): never the real one.

### Setting up sign-in

1. Create an OAuth 2.0 integration (3LO) at
   [developer.atlassian.com/console/myapps](https://developer.atlassian.com/console/myapps).
2. Under **Permissions**, add the **User Identity API** with `read:me`, and
   the **Jira API** with `read:jira-work` (its **Configure** lists the scopes).
   Nothing else: no scope that writes, and no `offline_access`.
3. Under **Authorization**, configure OAuth 2.0 (3LO) with the callback URL
   `APP_URL` followed by `/api/auth/callback`, for example
   `http://localhost:3400/api/auth/callback`. It must match exactly, and
   people must open the dashboard at exactly `APP_URL`.
4. From **Settings**, copy the client ID and secret into `.env.local` as
   `ATLASSIAN_CLIENT_ID` and `ATLASSIAN_CLIENT_SECRET`, and fill in `APP_URL`,
   `AUTH_SECRET`, `ALLOWED_EMAIL_DOMAINS` and `OVERSIGHT_JIRA_BASE_URL`
   (`.env.example` explains each). `AUTH_MODE` can stay empty with live data.
5. **Distribution.** Atlassian's guide,
   [OAuth 2.0 (3LO) apps](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/),
   says a new app "is private by default", so only its creator can install
   and use it. Until **Enable
   sharing** is turned on under **Distribution**, nobody else can sign in,
   whatever `ALLOWED_EMAIL_DOMAINS` says. Atlassian warns people using an app
   it has not reviewed that it "has not yet been reviewed by Atlassian".
   Sharing does not put the app on the Atlassian Marketplace.

To try it yourself, your own email domain must be on `ALLOWED_EMAIL_DOMAINS`
and your account must reach the Jira site; otherwise you land on
`/no-access`. Atlassian's guide does not mention `localhost` or plain http
callbacks; community reports say http is accepted for `localhost`, so for a
local run register `http://localhost:...` rather than `127.0.0.1`.

## Security

- **Content Security Policy** per request (`src/proxy.ts`, `src/lib/csp.ts`):
  scripts run only with the request's nonce (`'strict-dynamic'`, no eval in
  production); no third-party origin anywhere; `frame-ancestors 'none'`.
  Router prefetches go through the proxy too, for the sign-in gate: Next.js
  strips their `Next-Router-Prefetch` header before the proxy sees them, so
  they get a nonce and a policy like any page request. That changes nothing,
  since a prefetch's answer is not HTML.
  Inline styles are allowed deliberately: React, Radix and Recharts render
  style attributes and Sonner injects its stylesheet; with images, fonts and
  connections locked to `'self'`, an injected style has nowhere to send data.
- **Headers** on every response (`next.config.ts`): `Referrer-Policy:
  no-referrer`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Permissions-Policy`, `Cross-Origin-Opener-Policy`,
  `Cross-Origin-Resource-Policy`, HSTS; no `X-Powered-By`.
- **No runtime third parties**: fonts are self-hosted, there is no analytics
  and no CDN.
- **Zod's JIT is off** (`providers.tsx`) because it relies on `eval`.

## Design principles

The full brief is [`docs/DESIGN.md`](DESIGN.md). In short:

- A sibling of Ask the System: warm paper in light (the primary theme),
  institutional slate in dark, hairline rules, a sheet on a desk.
- One accent, the teal `--cite`, and it means *traceable*. Never decoration,
  never a chart series, never a nav highlight.
- Status colour (breach, warning, resolved) always ships with an icon and a
  label. The hatch means *not measurable*: the process step exists but Jira
  holds no evidence for it.
- Figures in IBM Plex Mono; dates that cannot be misread on either side of the
  Atlantic ("4 Nov 2026"); times on the 12-hour clock ("2:32 PM") in the
  viewer's own zone, never named; a time in another zone (the access log's
  organisation zone, Ask usage's UTC day) names it.
- Keyboard first: Cmd/Ctrl+K, `g` then a letter, `/`, `?`.
- WCAG 2.2 AA, print as a first-class medium, motion that never bounces and
  stops for `prefers-reduced-motion`.
