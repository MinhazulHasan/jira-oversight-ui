<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Working in this repository

- Read `docs/DESIGN.md` before changing anything visible. When code and the brief disagree, fix the one that is wrong, and say so.
- Colours and type sizes come only from the tokens in `src/app/globals.css`. Tailwind's default palette and type scale are removed on purpose: use `bg-sheet`, `bg-desk`, `text-ink`, `text-ink-low`, `border-rule`, `text-breach-ink`, `text-sm`, `text-h`, and so on. Status text uses the `-ink` steps; marks and fills use the plain status colour.
- The teal `--cite` means traceable. Never use it for decoration, a chart series or a nav highlight.
- Every date, time and figure goes through `src/lib/format.ts`. Anything that depends on the viewer (zone, locale, "now") renders after hydration: use `useNow()` or `useHydrated()`.
- Put figures in Plex Mono (`.mono`) or mark them `data-figure`; tabular numerals are deliberately not applied to running text (see the note in `globals.css`).
- Acknowledge every action with `notify.ok / cite / warn / info` from `src/lib/notify.ts`.
- Pages open with `PageSheet` and `PageHeader` from `src/components/shell/page.tsx`. Give a page's search field `data-page-search` so `/` focuses it.
- The Content Security Policy allows no inline script without the nonce, no eval and no third-party origin. Zod runs jitless for that reason; do not turn its JIT back on.
- Server components by default; `"use client"` only where interaction needs it. TypeScript strict, no `any` without a comment saying why.
- People appear only as the API's person objects name them (`{id, name, avatar}`): by the Jira display name, with their Jira picture beside it, as Jira and Confluence show people. Use `PersonAvatar` (`src/components/ui/person-avatar.tsx`: the picture, else initials; decorative, never in place of the name) or `PersonName`, which pairs it with the name. The picture comes only from this dashboard's own route, `/api/oversight/people/{id}/avatar?v=<avatar>`, which the service fills at sync; never an email address, a raw account id or Jira's (or Gravatar's) picture URL. Worklogs stay totals. Ask names people only at people level, for an admin and with sign-in off: the oversight route decides the level on every question (`askLevel` in `src/server/auth/roles.ts`), never the browser, and refuses a team-level reader's mentions with 403 `people_not_allowed`. There @ in the question box picks people from the board (`src/components/ask/question-box.tsx`) and an answer marks the people it names (`PersonMention`). At people level nothing about people is declined (JO-11): a question that evaluates someone is answered with figures next to the whole board's (the scorecard, `src/components/people/`, and `GET /people/scorecard`), never with an insult or a character label, and the decision stays the admin's; the People page (`/people`) is theirs alone. In Ask's facts and plan a person shows by name and picture, never by id (`src/components/ask/people-in-facts.tsx`). Everyone else's Ask stays at team level. Sample data uses the project key `DEMO` and fictional names (two of them with an abstract picture drawn in code), and is labelled as sample data.
- Before finishing: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run e2e`, then `npm run shots` and look at the pictures.
