import { defineConfig, devices } from "@playwright/test";

const PORT = 3400;
const BASE_URL = `http://localhost:${PORT}`;
/**
 * A second server from the same build with comparing people turned off
 * (SAMPLE_PEOPLE_COMPARISON=off, the sample's stand-in for the service's
 * PEOPLE_COMPARISON): the People page and Ask's scorecards are tested both ways.
 */
const OFF_PORT = 3401;
const OFF_URL = `http://localhost:${OFF_PORT}`;
/**
 * A third server from the same build for the rule settings spec (JO-15): its
 * saves change the sample's findings for every page that server serves, so no
 * other spec reads from it, and only its own projects run it, one browser
 * after the other. A little latency, so its re-check after a save is seen
 * running before it is applied.
 */
const RULES_PORT = 3402;
const RULES_URL = `http://localhost:${RULES_PORT}`;
const RULE_SETTINGS_SPEC = /rule-settings\.spec\.ts$/;
/**
 * Two more servers from the same build for the per-board sync spec (JO-17, JO-18): it runs the sample's first sync
 * of HELP, which turns HELP into a synced board for every page that server serves until it restarts. So no other
 * spec reads from them, and each browser has its own, each starting with HELP never synced.
 */
const SYNC_PORT = 3406;
const SYNC_URL = `http://localhost:${SYNC_PORT}`;
const SYNC_WEBKIT_PORT = 3407;
const SYNC_WEBKIT_URL = `http://localhost:${SYNC_WEBKIT_PORT}`;
const BOARD_SYNC_SPEC = /board-sync\.spec\.ts$/;
/** The specs with servers of their own: no other project runs them. */
const OWN_SERVER_SPECS = [RULE_SETTINGS_SPEC, BOARD_SYNC_SPEC];

/**
 * Sample mode, pinned in time, so every run sees the same figures. Sign-in is
 * off for the sample anyway; saying so here keeps an AUTH_MODE in .env.local
 * (which Next.js also loads) from turning it on under the tests.
 */
export const SAMPLE_ENV = {
  OVERSIGHT_DATA: "sample",
  SAMPLE_NOW: "2026-11-04T14:30:00Z",
  SAMPLE_LATENCY: "0",
  AUTH_MODE: "off",
};

/** The specs that read the comparison setting and test the mode they find (JO-11). */
const COMPARISON_SPECS = /(scorecard|ask|mentions|people)\.spec\.ts$/;

/**
 * WebKit (on this Windows machine, drawn in software) takes about three times
 * Chromium's time over the same steps: the longest flows run 20 to 27 s on a
 * quiet machine and passed the default 30 s under a full run's load (the JO-12
 * check). Its tests get twice the time; Chromium keeps the default, and every
 * expect keeps its own 5 s, so a slow page still fails.
 */
const WEBKIT_TIMEOUT = 60_000;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    locale: "en-GB",
    timezoneId: "Europe/London",
    colorScheme: "light",
    // Motion off: axe reads contrast mid-fade otherwise, and screenshots must not catch a frame in flight.
    reducedMotion: "reduce",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: OWN_SERVER_SPECS,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      // Most readers use Safari on a MacBook: WebKit with a Mac user agent, so
      // shortcut hints read ⌘ here and Ctrl in Chromium (a Windows agent).
      name: "webkit",
      testIgnore: OWN_SERVER_SPECS,
      timeout: WEBKIT_TIMEOUT,
      use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "chromium, comparison off",
      testMatch: COMPARISON_SPECS,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, baseURL: OFF_URL },
    },
    {
      name: "webkit, comparison off",
      testMatch: COMPARISON_SPECS,
      timeout: WEBKIT_TIMEOUT,
      use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 }, baseURL: OFF_URL },
    },
    {
      // Serial within the spec (it says so); WebKit waits for Chromium, so the two never write at once.
      name: "chromium, rule settings",
      testMatch: RULE_SETTINGS_SPEC,
      fullyParallel: false,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, baseURL: RULES_URL },
    },
    {
      name: "webkit, rule settings",
      testMatch: RULE_SETTINGS_SPEC,
      dependencies: ["chromium, rule settings"],
      fullyParallel: false,
      timeout: WEBKIT_TIMEOUT,
      use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 }, baseURL: RULES_URL },
    },
    {
      // Serial within the spec: its tests follow one server's syncs in order.
      name: "chromium, board sync",
      testMatch: BOARD_SYNC_SPEC,
      fullyParallel: false,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, baseURL: SYNC_URL },
    },
    {
      name: "webkit, board sync",
      testMatch: BOARD_SYNC_SPEC,
      fullyParallel: false,
      timeout: WEBKIT_TIMEOUT,
      use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 }, baseURL: SYNC_WEBKIT_URL },
    },
  ],
  webServer: [
    {
      // The production build, as a reader would get it. A server already on 3400 is reused locally.
      command: "npm run build && npm run start",
      url: `${BASE_URL}/api/oversight/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
      env: SAMPLE_ENV,
    },
    {
      // Started after the build above, from the same .next; never reused, so the setting is this one.
      command: `node node_modules/next/dist/bin/next start --port ${OFF_PORT}`,
      url: `${OFF_URL}/api/oversight/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { ...SAMPLE_ENV, SAMPLE_PEOPLE_COMPARISON: "off" },
    },
    {
      // The rule settings spec's own (JO-15): never reused, so it starts at the catalogue's settings.
      command: `node node_modules/next/dist/bin/next start --port ${RULES_PORT}`,
      url: `${RULES_URL}/api/oversight/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { ...SAMPLE_ENV, SAMPLE_LATENCY: "150" },
    },
    ...[SYNC_PORT, SYNC_WEBKIT_PORT].map((port) => ({
      // The board sync spec's own, one for each browser (JO-18): never reused, so HELP starts never synced.
      command: `node node_modules/next/dist/bin/next start --port ${port}`,
      url: `http://localhost:${port}/api/oversight/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: SAMPLE_ENV,
    })),
  ],
});
