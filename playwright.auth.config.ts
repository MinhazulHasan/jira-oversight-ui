import { defineConfig, devices } from "@playwright/test";

import {
  ADMIN_EMAIL,
  ALLOWED_DOMAIN,
  APP_URL,
  AUTH_SECRET,
  BROKEN_APP_URL,
  CLIENT_ID,
  CLIENT_SECRET,
  EVERYONE_APP_URL,
  MOCK_PORT,
  MOCK_URL,
  SHORT_SECRET,
  SITE_URL,
} from "./e2e-auth/settings";
import { SAMPLE_ENV } from "./playwright.config";

const SIGN_IN_ENV = {
  ...SAMPLE_ENV,
  AUTH_MODE: "atlassian",
  APP_URL,
  ATLASSIAN_CLIENT_ID: CLIENT_ID,
  ATLASSIAN_CLIENT_SECRET: CLIENT_SECRET,
  AUTH_SECRET,
  ALLOWED_EMAIL_DOMAINS: ALLOWED_DOMAIN,
  // Admins are ADMIN_EMAILS, everyone else a user: what the user-and-admin tests are about.
  ACCESS_MODE: "admin-list",
  ADMIN_EMAILS: ADMIN_EMAIL,
  OVERSIGHT_JIRA_BASE_URL: SITE_URL,
  ATLASSIAN_AUTH_URL: MOCK_URL,
  ATLASSIAN_API_URL: MOCK_URL,
};

const build = process.env.E2E_NO_BUILD === "1" ? "" : "npm run build && ";

export default defineConfig({
  testDir: "e2e-auth",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: APP_URL,
    locale: "en-GB",
    timezoneId: "Europe/London",
    colorScheme: "light",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: [
    {
      command: "node e2e-auth/mock-atlassian.mjs",
      url: `${MOCK_URL}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        MOCK_ATLASSIAN_PORT: String(MOCK_PORT),
        MOCK_CLIENT_ID: CLIENT_ID,
        MOCK_CLIENT_SECRET: CLIENT_SECRET,
        MOCK_SITE_URL: SITE_URL,
      },
    },
    {
      command: `${build}node node_modules/next/dist/bin/next start --port ${new URL(APP_URL).port}`,
      // A public page: it answers 200 without a session.
      url: `${APP_URL}/login`,
      reuseExistingServer: false,
      timeout: 300_000,
      env: SIGN_IN_ENV,
    },
    {
      // Started after the build above, from the same .next.
      command: `node node_modules/next/dist/bin/next start --port ${new URL(BROKEN_APP_URL).port}`,
      url: `${BROKEN_APP_URL}/login`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { ...SIGN_IN_ENV, APP_URL: BROKEN_APP_URL, AUTH_SECRET: SHORT_SECRET },
    },
    {
      // Everyone who signs in is an admin: ACCESS_MODE empty, its default. ADMIN_EMAILS stays set, unused.
      command: `node node_modules/next/dist/bin/next start --port ${new URL(EVERYONE_APP_URL).port}`,
      url: `${EVERYONE_APP_URL}/login`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { ...SIGN_IN_ENV, APP_URL: EVERYONE_APP_URL, ACCESS_MODE: "" },
    },
  ],
});
