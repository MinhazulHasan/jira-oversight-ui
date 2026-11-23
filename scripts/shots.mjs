/**
 * Screenshots of every page in light and dark, plus the shell's own states,
 * for review. A page is not done until someone has looked at these.
 *
 *   npm run build      once; this script builds nothing itself
 *   npm run shots      -> shots/*.png
 *
 * Uses a server already listening on :3400 if there is one; otherwise it
 * starts `next start` with the sample-data settings and stops it afterwards.
 * The browser clock is frozen at 2026-11-04T14:32:00Z, motion is reduced and
 * the viewport is 1440x900 at 2x, so every run produces the same pictures.
 *
 * Page builds add their own states by appending to ROUTES or EXTRAS.
 *
 * Options: SHOTS_URL (default http://localhost:3400), SHOTS_DIR (default shots),
 * SHOTS_ONLY=<name substring> to capture a subset, SHOTS_BROWSER=webkit to take
 * them in WebKit (Safari's engine) instead of Chromium, as *-webkit.png.
 * The People page and Ask's scorecards show the sample's comparison as the
 * server has it (SAMPLE_PEOPLE_COMPARISON): for the "off" pictures, start a
 * second server with it off and point SHOTS_URL and a SHOTS_DIR at it.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { chromium, webkit } from "@playwright/test";

const BASE = process.env.SHOTS_URL ?? "http://localhost:3400";
const OUT = process.env.SHOTS_DIR ?? "shots";
const ONLY = process.env.SHOTS_ONLY;
const WEBKIT = process.env.SHOTS_BROWSER === "webkit";
const FROZEN_NOW = new Date("2026-11-04T14:32:00Z");
const VIEWPORT = { width: 1440, height: 900 };
// AUTH_MODE: sign-in is off for the sample anyway; saying so keeps an AUTH_MODE in .env.local from turning it on.
const SAMPLE_ENV = { OVERSIGHT_DATA: "sample", SAMPLE_NOW: "2026-11-04T14:30:00Z", SAMPLE_LATENCY: "0", AUTH_MODE: "off" };

/** Every route, in light and dark. */
const ROUTES = [
  { name: "overview", path: "/" },
  { name: "findings", path: "/findings" },
  { name: "issue", path: "/issues/DEMO-1" },
  { name: "ask", path: "/ask" },
  { name: "insights", path: "/insights" },
  { name: "process", path: "/process" },
  { name: "baseline", path: "/baseline" },
  { name: "not-found", path: "/no-such-page" },
];

const HEALTH = {
  status: "ok",
  data_mode: "sample",
  read_only: true,
  api_version: "0.1.0",
  projects: ["DEMO"],
  report_timezone: "Europe/London",
};

/**
 * Shell states worth a look, each in the themes listed. `before` runs ahead of
 * navigation (to stub a response), `act` after the page has settled.
 */
const EXTRAS = [
  {
    name: "stale",
    themes: ["light", "dark"],
    path: "/",
    async before(page) {
      // Three and a half hours before the frozen clock: past the two-hour line.
      await page.route("**/api/oversight/health", (route) =>
        route.fulfill({ json: { ...HEALTH, last_synced_at: "2026-11-04T11:02:00.000Z" } }),
      );
    },
  },
  {
    name: "source-down",
    themes: ["light"],
    path: "/",
    async before(page) {
      await page.route("**/api/oversight/health", (route) =>
        route.fulfill({ status: 503, json: { error: "unavailable" } }),
      );
    },
    async act(page) {
      // Two retries with backoff come first; the error state follows.
      await page.getByText("Data source unreachable").first().waitFor({ timeout: 20_000 });
    },
  },
  {
    name: "print",
    themes: ["light"],
    path: "/findings",
    async act(page) {
      await page.emulateMedia({ media: "print" });
    },
  },
  {
    name: "palette",
    themes: ["light", "dark"],
    path: "/",
    async act(page) {
      await page.keyboard.press("ControlOrMeta+K");
      await page.getByRole("dialog", { name: "Command palette" }).waitFor();
      await page.keyboard.type("demo-142");
    },
  },
  {
    name: "palette-question",
    themes: ["light"],
    path: "/findings",
    async act(page) {
      await page.keyboard.press("ControlOrMeta+K");
      await page.getByRole("dialog", { name: "Command palette" }).waitFor();
      await page.keyboard.type("which epics have the most breaches");
    },
  },
  {
    name: "shortcuts",
    themes: ["light", "dark"],
    path: "/",
    async act(page) {
      await page.keyboard.press("?");
      await page.getByRole("dialog", { name: "Keyboard shortcuts" }).waitFor();
    },
  },
  {
    name: "data-source",
    themes: ["light"],
    path: "/",
    async act(page) {
      await page.getByRole("banner").getByRole("button", { name: /Sample data/ }).click();
      await page.getByRole("dialog").waitFor();
    },
  },
  {
    name: "theme-menu",
    themes: ["light"],
    path: "/",
    async act(page) {
      await page.getByRole("button", { name: "Theme" }).click();
      await page.getByRole("menu").waitFor();
    },
  },
  {
    name: "toast",
    themes: ["light", "dark"],
    path: "/findings",
    async act(page) {
      await page.getByRole("button", { name: "Copy link" }).click();
      await page.getByText("Link copied").waitFor();
    },
  },
  {
    name: "rail-collapsed",
    themes: ["light", "dark"],
    path: "/findings",
    railCollapsed: true,
  },
  {
    name: "phone",
    themes: ["light"],
    path: "/",
    viewport: { width: 390, height: 844 },
  },
  {
    name: "phone-nav",
    themes: ["light"],
    path: "/",
    viewport: { width: 390, height: 844 },
    async act(page) {
      await page.getByRole("button", { name: "Open navigation" }).click();
      await page.getByRole("dialog", { name: "Navigation" }).waitFor();
    },
  },
  /* The person view (JO-07): every name here is one of the sample's fictional people. */
  {
    name: "overview-person",
    themes: ["light", "dark"],
    path: "/",
    act: showPeople,
  },
  {
    name: "findings-person",
    themes: ["light", "dark"],
    // Carmen Ruiz, who carries the most open breaches in the sample.
    path: "/findings?state=open&person=p599114b761a6",
  },
  {
    name: "person-menu",
    themes: ["light", "dark"],
    // Where the Overview's "All people" lands: the Person menu open on everyone's counts.
    path: "/findings?state=open&menu=person",
    async act(page) {
      await page.getByRole("listbox", { name: "Person" }).getByRole("option").nth(8).waitFor();
    },
  },
  {
    name: "person-drawer",
    themes: ["light", "dark"],
    path: "/findings?finding=0b7b3b0f61c477e61699982f24892735",
    async act(page) {
      await page.getByRole("dialog").getByText("Assignee", { exact: true }).waitFor();
    },
  },
  {
    name: "tablet-person",
    themes: ["light"],
    path: "/",
    viewport: { width: 768, height: 1024 },
    act: showPeople,
  },
  {
    name: "phone-person",
    themes: ["light", "dark"],
    path: "/",
    viewport: { width: 390, height: 844 },
    act: showPeople,
  },
  {
    name: "tablet-person-findings",
    themes: ["light"],
    path: "/findings?state=open&person=unassigned",
    viewport: { width: 768, height: 1024 },
  },
  {
    name: "phone-person-menu",
    themes: ["light", "dark"],
    path: "/findings",
    viewport: { width: 390, height: 844 },
    async act(page) {
      await page.getByRole("button", { name: "Person Any" }).click();
      await page.getByRole("listbox", { name: "Person" }).getByRole("option").nth(8).waitFor();
    },
  },
  {
    name: "phone-person-issue",
    themes: ["light"],
    path: "/issues/DEMO-1",
    viewport: { width: 390, height: 844 },
  },
  /* Pictures beside names (11 Nov 2026): a ticket whose assignee, Grace Lindqvist, has a picture in the sample. */
  {
    name: "issue-picture",
    themes: ["light", "dark"],
    path: "/issues/DEMO-1098",
    async act(page) {
      await page.locator("[data-assignee] [data-avatar='picture'] img").waitFor();
    },
  },
  /* Asking about people with @ (11 Nov 2026): sign-in is off for the sample, so Ask answers at people level. */
  {
    name: "ask-mention",
    themes: ["light", "dark"],
    path: "/ask",
    act: (page) => openMentions(page, "What are @"),
  },
  {
    name: "ask-mention-filtered",
    themes: ["light", "dark"],
    path: "/ask",
    act: (page) => openMentions(page, "What are @gr"),
  },
  {
    // The @ list's two groups (JO-10): the keyboard runs on to the last member with no tickets, scrolled to,
    // so both headings and the fade at the top edge are in the picture.
    name: "ask-mention-groups",
    themes: ["light", "dark"],
    path: "/ask",
    async act(page) {
      await openMentions(page, "Is @");
      await page.keyboard.press("ArrowUp");
      await page.getByRole("group", { name: "No tickets" }).getByRole("option", { selected: true }).waitFor();
    },
  },
  {
    name: "phone-ask-mention-groups",
    themes: ["light", "dark"],
    path: "/ask",
    viewport: { width: 390, height: 844 },
    async act(page) {
      await openMentions(page, "@");
      await page.keyboard.press("ArrowUp");
      await page.getByRole("group", { name: "No tickets" }).getByRole("option", { selected: true }).waitFor();
    },
  },
  {
    // A member with no tickets, picked from the second group: one sentence, built in code, with her marked.
    name: "ask-no-tickets-answer",
    themes: ["light", "dark"],
    path: `/ask?q=${encodeURIComponent("What is @Noor Haddad working on?")}&m=pc3d7609d78d1`,
    act: (page) => page.locator("[data-answer-prose] [data-person-mention]").first().waitFor(),
  },
  {
    // The person chosen stands in the question as a chip, the caret just after it.
    name: "ask-mention-chosen",
    themes: ["light", "dark"],
    path: "/ask",
    async act(page) {
      await openMentions(page, "What are @car");
      await page.keyboard.press("Enter");
      await page.locator("[data-question-editor] [data-chip]").first().waitFor();
      await page.keyboard.type("'s open findings, and @noor");
      await page.getByRole("listbox", { name: "People to mention" }).getByRole("option").first().waitFor();
      await page.keyboard.press("Enter");
      await page.keyboard.press("Backspace");
    },
  },
  {
    // At phone width: chips wrap whole with the words, a chip at a line's end, the caret beside it.
    name: "phone-ask-chips",
    themes: ["light", "dark"],
    path: "/ask",
    viewport: { width: 390, height: 844 },
    async act(page) {
      await openMentions(page, "Compare @car");
      await page.keyboard.press("Enter");
      await page.keyboard.type("with @tom");
      await page.getByRole("listbox", { name: "People to mention" }).getByRole("option").first().waitFor();
      await page.keyboard.press("Enter");
      await page.keyboard.type("and @gra");
      await page.getByRole("listbox", { name: "People to mention" }).getByRole("option").first().waitFor();
      await page.keyboard.press("Enter");
      await page.keyboard.press("Backspace");
    },
  },
  {
    name: "ask-person-answer",
    themes: ["light", "dark"],
    // Carmen Ruiz, by her person id, as the @ list writes the question.
    path: `/ask?q=${encodeURIComponent("What are @Carmen Ruiz's open findings?")}&m=p599114b761a6`,
    act: (page) => page.locator("[data-answer-prose] [data-person-mention]").first().waitFor(),
  },
  {
    name: "ask-people-answer",
    themes: ["light", "dark"],
    path: `/ask?q=${encodeURIComponent("Who has the most open breaches?")}`,
    act: (page) => page.locator("[data-answer-prose] [data-person-mention]").first().waitFor(),
  },
  /*
   * Person scorecards (JO-11), with the sample's comparison as the server has it: on, the People page's
   * everyone table and Ask's compact scorecards; off (a second run against a server started with
   * SAMPLE_PEOPLE_COMPARISON=off, SHOTS_ONLY=people or scorecard), the person picker and the refusal.
   */
  {
    name: "people",
    themes: ["light", "dark"],
    path: "/people",
    act: (page) => page.getByRole("heading", { level: 1, name: "People" }).waitFor(),
  },
  {
    // Carmen Ruiz's scorecard, below the everyone table (comparison on) or the person picker (off).
    name: "people-scorecard",
    themes: ["light", "dark"],
    path: "/people?person=p599114b761a6",
    act: showScorecard,
  },
  {
    name: "phone-people",
    themes: ["light", "dark"],
    path: "/people",
    viewport: { width: 390, height: 844 },
    act: (page) => page.getByRole("heading", { level: 1, name: "People" }).waitFor(),
  },
  {
    name: "phone-people-scorecard",
    themes: ["light", "dark"],
    path: "/people?person=p599114b761a6",
    viewport: { width: 390, height: 844 },
    act: showScorecard,
  },
  {
    // A question that evaluates someone, answered with their scorecard next to the board's, never declined.
    name: "ask-scorecard-answer",
    themes: ["light", "dark"],
    path: `/ask?q=${encodeURIComponent("Is @Carmen Ruiz doing well?")}&m=p599114b761a6`,
    act: (page) => page.locator("[data-ask-scorecards]").waitFor(),
  },
  {
    name: "phone-ask-scorecard-answer",
    themes: ["light", "dark"],
    path: `/ask?q=${encodeURIComponent("Is @Carmen Ruiz doing well?")}&m=p599114b761a6`,
    viewport: { width: 390, height: 844 },
    act: (page) => page.locator("[data-ask-scorecards]").waitFor(),
  },
  {
    // Everyone compared (comparison on), or the sentence that comparing people is turned off.
    name: "ask-scorecard-comparison",
    themes: ["light", "dark"],
    path: `/ask?q=${encodeURIComponent("Who is best on the board? Rank the others")}`,
    act: (page) =>
      page.locator("[data-ask-scorecards]").or(page.getByText("Comparing people side by side is turned off")).first().waitFor(),
  },
  {
    name: "phone-ask-mention",
    themes: ["light", "dark"],
    path: "/ask",
    viewport: { width: 390, height: 844 },
    act: (page) => openMentions(page, "@"),
  },
  {
    name: "phone-ask-person-answer",
    themes: ["light"],
    path: `/ask?q=${encodeURIComponent("Who has the most open breaches?")}`,
    viewport: { width: 390, height: 844 },
    act: (page) => page.locator("[data-answer-prose] [data-person-mention]").first().waitFor(),
  },
  {
    // A person link from another board: nothing to list, and the reason said on screen, not off to the right.
    name: "phone-person-empty",
    themes: ["light", "dark"],
    path: "/findings?state=open&person=p000000000000",
    viewport: { width: 390, height: 844 },
    async act(page) {
      await page.getByText("No findings match these filters").waitFor();
    },
  },
];

/** Type into the Ask box until the @ list is open on the people it finds. */
async function openMentions(page, text) {
  await page.getByRole("textbox", { name: "Your question" }).click();
  await page.keyboard.type(text);
  await page.getByRole("listbox", { name: "People to mention" }).getByRole("option").first().waitFor();
}

/** Bring the People page's scorecard into view, below the sticky top bar, once its rows are drawn. */
async function showScorecard(page) {
  const card = page.locator("[data-scorecard]");
  await card.locator("tbody tr").first().waitFor();
  await card.evaluate((element) => {
    element.style.scrollMarginTop = "72px";
    element.scrollIntoView({ block: "start" });
  });
}

/** Bring the Overview's People panel into view, below the sticky top bar. */
async function showPeople(page) {
  await page.getByRole("list", { name: "Open findings by person" }).waitFor();
  await page.evaluate(() => {
    const section = document.getElementById("people");
    if (!section) return;
    section.style.scrollMarginTop = "72px";
    section.scrollIntoView({ block: "start" });
  });
}

/* ------------------------------------------------------------------ server */

async function reachable() {
  try {
    const response = await fetch(`${BASE}/api/oversight/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await reachable()) return null;
  if (!BASE.includes("localhost:3400")) throw new Error(`Nothing answering at ${BASE}`);

  const require = createRequire(import.meta.url);
  const nextBin = require.resolve("next/dist/bin/next");
  console.log("Starting next start on :3400 (sample data)");
  const child = spawn(process.execPath, [nextBin, "start", "--port", "3400"], {
    env: { ...process.env, ...SAMPLE_ENV },
    stdio: "ignore",
  });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await reachable()) return child;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  stopServer(child);
  throw new Error("next start did not come up on :3400. Run `npm run build` first.");
}

function stopServer(child) {
  if (!child?.pid) return;
  // On Windows a plain kill leaves next's own children running.
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
  else child.kill("SIGTERM");
}

/* ----------------------------------------------------------------- capture */

async function settle(page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  // The shell is ready once the data source has answered.
  await page
    .getByRole("banner")
    .getByRole("button", { name: /Sample|Live|unreachable/ })
    .first()
    .waitFor({ timeout: 10_000 })
    .catch(() => {});
}

async function capture(browser, { name, path: route, theme, viewport, railCollapsed, before, act }) {
  const context = await browser.newContext({
    viewport: viewport ?? VIEWPORT,
    deviceScaleFactor: 2,
    colorScheme: theme,
    reducedMotion: "reduce",
    locale: "en-GB",
    timezoneId: "Europe/London",
    // WebKit grants no clipboard permissions: the toast's Copy link is the one picture that differs there.
    permissions: WEBKIT ? [] : ["clipboard-read", "clipboard-write"],
  });
  await context.clock.setFixedTime(FROZEN_NOW);
  if (railCollapsed) {
    await context.addCookies([{ name: "jo-rail", value: "collapsed", url: BASE }]);
  }
  const page = await context.newPage();
  try {
    if (before) await before(page);
    await page.goto(`${BASE}${route}`);
    await settle(page);
    if (act) await act(page);
    await page.waitForTimeout(150);
    const file = path.join(OUT, `${name}-${theme}${WEBKIT ? "-webkit" : ""}.png`);
    await page.screenshot({ path: file });
    console.log(file);
  } finally {
    await context.close();
  }
}

const jobs = [];
let index = 1;
const numbered = (name) => `${String(index++).padStart(2, "0")}-${name}`;
for (const route of ROUTES) {
  const name = numbered(route.name);
  for (const theme of ["light", "dark"]) jobs.push({ ...route, name, theme });
}
for (const extra of EXTRAS) {
  const name = numbered(extra.name);
  for (const theme of extra.themes) jobs.push({ ...extra, name, theme });
}

mkdirSync(OUT, { recursive: true });
const server = await ensureServer();
const browser = await (WEBKIT ? webkit : chromium).launch();
try {
  for (const job of jobs) {
    if (ONLY && !job.name.includes(ONLY)) continue;
    await capture(browser, job);
  }
} finally {
  await browser.close();
  stopServer(server);
}
