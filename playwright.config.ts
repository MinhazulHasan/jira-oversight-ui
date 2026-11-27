import { defineConfig, devices } from "@playwright/test";

const PORT = 3400;
const BASE_URL = `http://localhost:${PORT}`;
const OFF_PORT = 3401;
const OFF_URL = `http://localhost:${OFF_PORT}`;
const RULES_PORT = 3402;
const RULES_URL = `http://localhost:${RULES_PORT}`;
const RULE_SETTINGS_SPEC = /rule-settings\.spec\.ts$/;
const SYNC_PORT = 3406;
const SYNC_URL = `http://localhost:${SYNC_PORT}`;
const SYNC_WEBKIT_PORT = 3407;
const SYNC_WEBKIT_URL = `http://localhost:${SYNC_WEBKIT_PORT}`;
const BOARD_SYNC_SPEC = /board-sync\.spec\.ts$/;
const CREDIT_PORT = 3409;
const CREDIT_URL = `http://localhost:${CREDIT_PORT}`;
/** The specs that change a board's credit setting, which every page of people reads. */
const CREDIT_SPECS = /credit(-acceptance)?\.spec\.ts$/;
const IGNORE_PORT = 3410;
const IGNORE_URL = `http://localhost:${IGNORE_PORT}`;
/** The specs that ignore findings, which every page of findings and counts reads. */
const IGNORE_SPECS = /ignore(-acceptance)?\.spec\.ts$/;
/** The specs with servers of their own: no other project runs them. */
const OWN_SERVER_SPECS = [RULE_SETTINGS_SPEC, BOARD_SYNC_SPEC, CREDIT_SPECS, IGNORE_SPECS];

export const SAMPLE_ENV = {
  OVERSIGHT_DATA: "sample",
  SAMPLE_NOW: "2026-11-04T14:30:00Z",
  SAMPLE_LATENCY: "0",
  AUTH_MODE: "off",
};

/** The specs that read the comparison setting and test the mode they find. */
const COMPARISON_SPECS = /(scorecard|ask|mentions|people)\.spec\.ts$/;

const WEBKIT_TIMEOUT = 60_000;
// WebKit renders slower when the whole suite runs at once, so its assertions wait longer before failing.
const WEBKIT_EXPECT = { timeout: 10_000 };

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
      name: "webkit",
      testIgnore: OWN_SERVER_SPECS,
      timeout: WEBKIT_TIMEOUT,
      expect: WEBKIT_EXPECT,
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
      expect: WEBKIT_EXPECT,
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
      expect: WEBKIT_EXPECT,
      use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 }, baseURL: RULES_URL },
    },
    {
      // Serial within each spec; WebKit waits for Chromium, so the two never change the setting at once.
      name: "chromium, credit",
      testMatch: CREDIT_SPECS,
      fullyParallel: false,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, baseURL: CREDIT_URL },
    },
    {
      name: "webkit, credit",
      testMatch: CREDIT_SPECS,
      dependencies: ["chromium, credit"],
      fullyParallel: false,
      timeout: WEBKIT_TIMEOUT,
      expect: WEBKIT_EXPECT,
      use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 }, baseURL: CREDIT_URL },
    },
    {
      // Serial within each spec; WebKit waits for Chromium, so the two never ignore at once.
      name: "chromium, ignore",
      testMatch: IGNORE_SPECS,
      fullyParallel: false,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, baseURL: IGNORE_URL },
    },
    {
      name: "webkit, ignore",
      testMatch: IGNORE_SPECS,
      dependencies: ["chromium, ignore"],
      fullyParallel: false,
      timeout: WEBKIT_TIMEOUT,
      expect: WEBKIT_EXPECT,
      use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 }, baseURL: IGNORE_URL },
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
      expect: WEBKIT_EXPECT,
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
      // The rule settings spec's own: never reused, so it starts at the catalogue's settings.
      command: `node node_modules/next/dist/bin/next start --port ${RULES_PORT}`,
      url: `${RULES_URL}/api/oversight/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { ...SAMPLE_ENV, SAMPLE_LATENCY: "150" },
    },
    {
      // The credit specs' own: never reused, so every board starts on its file's choice.
      command: `node node_modules/next/dist/bin/next start --port ${CREDIT_PORT}`,
      url: `${CREDIT_URL}/api/oversight/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: SAMPLE_ENV,
    },
    {
      // The ignore specs' own: never reused, so no finding starts ignored.
      command: `node node_modules/next/dist/bin/next start --port ${IGNORE_PORT}`,
      url: `${IGNORE_URL}/api/oversight/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: SAMPLE_ENV,
    },
    ...[SYNC_PORT, SYNC_WEBKIT_PORT].map((port) => ({
      // The board sync spec's own, one for each browser: never reused, so HELP starts never synced.
      command: `node node_modules/next/dist/bin/next start --port ${port}`,
      url: `http://localhost:${port}/api/oversight/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: SAMPLE_ENV,
    })),
  ],
});
