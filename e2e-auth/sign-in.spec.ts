import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { ACCOUNTS, APP_URL, BROKEN_APP_URL, CLIENT_ID, MOCK_URL, SHORT_SECRET } from "./settings";

/*
 * Signing in with Atlassian (JO-01), the domain allow-list (JO-02) and the
 * boards a person's Jira opens (JO-03), end to end, against the mock
 * Atlassian in mock-atlassian.mjs, and the person view (JO-07) on the boards
 * a user and an admin may read, and the person card (JO-13), an admin's
 * alone. The dashboard runs the sample project with sign-in on
 * (playwright.auth.config.ts), and ACCESS_MODE admin-list: admins are
 * ADMIN_EMAILS, everyone else a user. Everyone-admin, the default, has its
 * own spec and server (everyone-admin.spec.ts).
 */

const DEEP_LINK = "/findings?severity=breach";
const LOGIN_FOR_DEEP_LINK = /\/login\?next=%2Ffindings%3Fseverity%3Dbreach$/;
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** Every state of the two sign-in pages that a reader can meet. */
const SIGN_IN_PAGES = [
  "/login",
  "/login?error=denied",
  "/login?error=state",
  "/login?error=timeout",
  "/login?error=service",
  "/login?signed_out=1",
  "/no-access?reason=domain",
  "/no-access?reason=unverified",
  "/no-access?reason=site",
  "/no-access?reason=email",
  "/no-access?reason=boards",
];

const signInButton = (page: Page) => page.getByRole("link", { name: /^Sign in with Atlassian/ });

/** From the dashboard's sign-in page, through the mock's consent screen, as one of its test accounts. */
async function chooseAccount(page: Page, account: string) {
  await signInButton(page).click();
  await expect(page.getByRole("heading", { level: 1, name: "Mock Atlassian" })).toBeVisible();
  await page.getByRole("link", { name: account, exact: true }).click();
}

/** Signed in as the allowed account, on `path`. */
async function signedIn(page: Page, path: string) {
  await page.goto(path);
  await expect(page).toHaveURL(/\/login/);
  await chooseAccount(page, ACCOUNTS.allowed);
  await expect(page).toHaveURL(`${APP_URL}${path}`);
  // The shell's data comes from the oversight API, which only a session opens.
  await expect(page.getByRole("banner").getByRole("button", { name: /Sample data/ })).toBeVisible();
}

/**
 * Signed in on /findings, with the list loaded and nothing left in flight. A test that ends the session
 * waits for this: a call still on its way would meet the 401 first and leave for /login from /findings.
 * (The list starts after hydration, behind a Suspense boundary; the filter counts show it has arrived.)
 */
async function signedInWithFindings(page: Page) {
  await signedIn(page, "/findings");
  await expect(page.getByRole("radio", { name: /^Breach, \d/ })).toBeVisible();
  await page.waitForLoadState("networkidle");
}

async function sessionCookie(context: BrowserContext) {
  return (await context.cookies()).find((cookie) => cookie.name === "jo-session");
}

/** Console errors and uncaught exceptions, including Content Security Policy violations. */
function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(`Uncaught: ${error.message}`));
  return problems;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      console.error(`CSP violation: ${event.violatedDirective} blocked ${event.blockedURI || "inline"}`);
    });
  });
});

test.describe("JO-01: sign in with Atlassian", () => {
  test("a signed-out visit to a deep link goes to /login, and signing in comes back to it", async ({ page }) => {
    const problems = watchConsole(page);
    await page.goto(DEEP_LINK);
    await expect(page).toHaveURL(LOGIN_FOR_DEEP_LINK);
    await expect(page).toHaveTitle("Sign in · Jira Oversight");
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    await expect(page.getByText("Jira Oversight only reads Jira; it never changes anything there.")).toBeVisible();

    await chooseAccount(page, ACCOUNTS.allowed);
    await expect(page).toHaveURL(`${APP_URL}${DEEP_LINK}`);
    await expect(page.getByRole("heading", { level: 1, name: "Findings" })).toBeVisible();
    await expect(page.getByRole("banner").getByRole("button", { name: /Sample data/ })).toBeVisible();

    const cookie = await sessionCookie(page.context());
    expect(cookie).toMatchObject({ httpOnly: true, secure: false, path: "/" });
    // The sign-in in flight is spent.
    expect((await page.context().cookies()).map((c) => c.name)).not.toContain("jo-auth-state");
    expect(problems).toEqual([]);
  });

  test("a refresh keeps the reader signed in", async ({ page }) => {
    await signedIn(page, DEEP_LINK);
    await page.reload();
    await expect(page).toHaveURL(`${APP_URL}${DEEP_LINK}`);
    await expect(page.getByRole("heading", { level: 1, name: "Findings" })).toBeVisible();
    await page.goto("/issues/DEMO-12");
    await expect(page.getByRole("heading", { level: 1, name: "DEMO-12" })).toBeVisible();
  });

  test("Sign out, from the keyboard, asks first; Enter keeps the session, only the confirmation's Sign out ends it", async ({ page }) => {
    await signedIn(page, DEEP_LINK);
    const signOut = page.getByRole("banner").getByRole("button", { name: "Sign out" });
    await signOut.focus();
    await expect(page.getByRole("tooltip", { name: "Sign out" })).toBeVisible();
    const topBar = await new AxeBuilder({ page }).include('[role="banner"], header').withTags(WCAG_TAGS).analyze();
    expect(topBar.violations.map((violation) => violation.id)).toEqual([]);
    await page.keyboard.press("Enter");

    // A stray press asks first: "Stay signed in" holds the focus, so Enter again keeps the session.
    const confirmation = page.getByRole("alertdialog", { name: "Sign out of Jira Oversight?" });
    await expect(confirmation).toBeVisible();
    await expect(confirmation.getByRole("button", { name: "Stay signed in" })).toBeFocused();
    const dialog = await new AxeBuilder({ page }).include('[role="alertdialog"]').withTags(WCAG_TAGS).analyze();
    expect(dialog.violations.map((violation) => violation.id)).toEqual([]);
    await page.keyboard.press("Enter");
    await expect(confirmation).toBeHidden();
    await expect(signOut).toBeFocused();
    expect(await sessionCookie(page.context())).toBeDefined();

    await page.keyboard.press("Enter");
    await confirmation.getByRole("button", { name: "Sign out" }).click();

    await expect(page).toHaveURL(`${APP_URL}/login?signed_out=1`);
    await expect(page.getByRole("main").getByRole("status")).toContainText("You have signed out of Jira Oversight");
    // Acknowledged like every action: a toast as well as the notice that stays.
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Signed out" })).toBeVisible();
    expect(await sessionCookie(page.context())).toBeUndefined();

    await page.goto(DEEP_LINK);
    await expect(page).toHaveURL(LOGIN_FOR_DEEP_LINK);
    expect((await page.request.get("/api/oversight/health")).status()).toBe(401);
  });

  test("on a phone, Sign out sits in the navigation sheet", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signedIn(page, "/");
    await expect(page.getByRole("banner").getByRole("button", { name: "Sign out" })).toBeHidden();

    await page.getByRole("button", { name: "Open navigation" }).click();
    const sheet = page.getByRole("dialog", { name: "Navigation" });
    await expect(sheet).toBeVisible();
    const violations = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(WCAG_TAGS).analyze();
    expect(violations.violations.map((violation) => violation.id)).toEqual([]);

    await sheet.getByRole("button", { name: "Sign out" }).click();
    const confirmation = page.getByRole("alertdialog", { name: "Sign out of Jira Oversight?" });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(`${APP_URL}/login?signed_out=1`);
    expect(await sessionCookie(page.context())).toBeUndefined();
  });

  test("Sign out is in the command palette too", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await signedIn(page, "/process");
    await page.getByRole("banner").getByRole("button", { name: "Search or jump to" }).click();
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await expect(palette).toBeVisible();
    await palette.getByRole("combobox").fill("sign out");
    await palette.getByRole("option", { name: "Sign out", exact: true }).click();
    const confirmation = page.getByRole("alertdialog", { name: "Sign out of Jira Oversight?" });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(`${APP_URL}/login?signed_out=1`);
    expect(await sessionCookie(page.context())).toBeUndefined();
  });

  test("when the session ends mid-use, a filter sends the reader to sign in and back to the filtered view", async ({ page }) => {
    await signedInWithFindings(page);
    await page.context().clearCookies({ name: "jo-session" });
    // A filter changes only the address and the API call: the call's 401 sends the browser to sign in.
    await page.getByRole("radio", { name: /^Breach/ }).click();
    await expect(page).toHaveURL(`${APP_URL}/login?next=%2Ffindings%3Fseverity%3Dbreach`);
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  });

  test("when the session ends mid-use, a click in the rail goes to sign in and back to that page", async ({ page }) => {
    await signedInWithFindings(page);
    await page.context().clearCookies({ name: "jo-session" });
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: /^Insights/ }).click();
    await expect(page).toHaveURL(`${APP_URL}/login?next=%2Finsights`);
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  });

  test("signed in, the sign-in pages send the reader straight on", async ({ page }) => {
    await signedIn(page, "/");
    await page.goto("/login?next=%2Fprocess");
    await expect(page).toHaveURL(`${APP_URL}/process`);
    await page.goto("/no-access?reason=domain");
    await expect(page).toHaveURL(`${APP_URL}/`);
  });

  test("Cancel at Atlassian comes back to /login with a calm message", async ({ page }) => {
    await page.goto(DEEP_LINK);
    await chooseAccount(page, ACCOUNTS.cancel);
    await expect(page).toHaveURL(`${APP_URL}/login?error=denied`);
    await expect(page.getByRole("main").getByRole("status")).toContainText("You chose Cancel at Atlassian");
    await expect(signInButton(page)).toBeVisible();
    expect(await sessionCookie(page.context())).toBeUndefined();
  });

  test("the authorisation request and both cookies are exactly as agreed", async ({ playwright }) => {
    // A client of its own, so no cookie from another test can be mistaken for one of these.
    const client = await playwright.request.newContext({ baseURL: APP_URL });
    const start = await client.get("/api/auth/login?next=%2Fask", { maxRedirects: 0 });
    expect(start.status()).toBe(303);
    const authorize = new URL(start.headers().location);
    expect(`${authorize.origin}${authorize.pathname}`).toBe(`${MOCK_URL}/authorize`);
    const state = authorize.searchParams.get("state") ?? "";
    expect(state.length).toBeGreaterThanOrEqual(32);
    expect(Object.fromEntries(authorize.searchParams)).toEqual({
      audience: "api.atlassian.com",
      client_id: CLIENT_ID,
      scope: "read:me read:jira-work",
      redirect_uri: `${APP_URL}/api/auth/callback`,
      state,
      response_type: "code",
      prompt: "consent",
    });
    const cookies = (response: { headersArray(): { name: string; value: string }[] }) =>
      response.headersArray().filter((header) => header.name.toLowerCase() === "set-cookie").map((header) => header.value);
    const [stateCookie] = cookies(start);
    expect(stateCookie).toMatch(/^jo-auth-state=v1\./);
    for (const flag of [/; HttpOnly/i, /; SameSite=Lax/i, /; Path=\/api\/auth(;|$)/, /; Max-Age=600(;|$)/]) {
      expect(stateCookie).toMatch(flag);
    }
    expect(stateCookie).not.toMatch(/; Secure/i);

    // The mock's "Allowed account" button.
    const consent = await client.get(
      `${MOCK_URL}/decide?account=allowed&redirect_uri=${encodeURIComponent(`${APP_URL}/api/auth/callback`)}&state=${encodeURIComponent(state)}`,
      { maxRedirects: 0 },
    );
    const callback = consent.headers().location;
    expect(callback).toMatch(new RegExp(`^${APP_URL}/api/auth/callback\\?code=[^&]+&state=`));

    const back = await client.get(callback, { maxRedirects: 0 });
    expect(back.status()).toBe(303);
    expect(back.headers().location).toBe(`${APP_URL}/ask`);
    const session = cookies(back).find((cookie) => cookie.startsWith("jo-session="));
    expect(session).toMatch(/^jo-session=v1\./);
    for (const flag of [/; HttpOnly/i, /; SameSite=Lax/i, /; Path=\/(;|$)/, /; Max-Age=43200(;|$)/]) {
      expect(session).toMatch(flag);
    }
    expect(session).not.toMatch(/; Secure/i);
    // Sealed: nothing in it can be read, neither the address, nor its domain, nor the account.
    expect(session).not.toMatch(/reader|allowed\.test|e2e-account|%40/);
    expect(cookies(back).find((cookie) => cookie.startsWith("jo-auth-state="))).toMatch(/; Max-Age=0(;|$)/);
    expect((await client.get("/api/oversight/health")).status()).toBe(200);

    // The same return a second time finds the sign-in spent.
    const replay = await client.get(callback, { maxRedirects: 0 });
    expect(replay.headers().location).toBe(`${APP_URL}/login?error=state`);
    await client.dispose();
  });
});

test.describe("JO-02: only approved accounts get in", () => {
  const REFUSED = [
    { account: ACCOUNTS.outsider, reason: "domain", title: "This account cannot open Jira Oversight" },
    { account: ACCOUNTS.unverified, reason: "unverified", title: "Verify your email address first" },
    { account: ACCOUNTS.noSite, reason: "site", title: "This account cannot see the Jira site" },
    { account: ACCOUNTS.noEmail, reason: "email", title: "Atlassian did not share an email address" },
    { account: ACCOUNTS.noBoards, reason: "boards", title: "This account cannot see any of the boards" },
  ];

  for (const { account, reason, title } of REFUSED) {
    test(`"${account}" lands on /no-access?reason=${reason}, signed out`, async ({ page }) => {
      await page.goto(DEEP_LINK);
      await chooseAccount(page, account);
      await expect(page).toHaveURL(`${APP_URL}/no-access?reason=${reason}`);
      await expect(page).toHaveTitle("No access · Jira Oversight");
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
      await expect(page.getByRole("link", { name: /^id\.atlassian\.com\s*, opens in a new tab$/ })).toHaveAttribute(
        "href",
        "https://id.atlassian.com/logout",
      );
      await expect(page.getByRole("link", { name: /^(Try another account|Sign in again)/ })).toHaveAttribute(
        "href",
        "/api/auth/login",
      );
      expect(await sessionCookie(page.context())).toBeUndefined();

      await page.goto("/");
      await expect(page).toHaveURL(`${APP_URL}/login`);
    });
  }

  test("the domain refusal says what the client asked for", async ({ page }) => {
    await page.goto("/no-access?reason=domain");
    await expect(page.getByText(/^Only accounts on approved email domains can open Jira Oversight/)).toBeVisible();
  });
});

test.describe("JO-03: a person reads only the boards their Jira opens", () => {
  // The sample serves DEMO, MOB and HELP; this account's Jira opens DEMO alone, so the list holds DEMO alone.
  test("the board list and the top bar open on the account's own board", async ({ page }) => {
    await signedIn(page, "/");
    const response = await page.request.get("/api/oversight/projects");
    expect(response.status()).toBe(200);
    const list = (await response.json()) as { default: string; projects: { key: string }[] };
    expect(list.default).toBe("DEMO");
    expect(list.projects.map((board) => board.key)).toEqual(["DEMO"]);
    await expect(page.getByRole("banner").locator("[data-board]")).toHaveAttribute("data-board", "DEMO");
  });

  test("a board the account cannot open is refused, and the dashboard opens on one of theirs", async ({ page, context }) => {
    await signedIn(page, "/");
    await context.addCookies([{ name: "jo-board", value: "OTHER", url: APP_URL }]);
    const refused = await page.request.get("/api/oversight/overview");
    expect(refused.status()).toBe(403);
    expect(await refused.json()).toMatchObject({ error: "board_not_allowed" });

    // The top bar forgets a pick that is not in the board list, and the page reloads on the reader's own board.
    await page.goto("/");
    await expect(page.getByRole("banner").locator("[data-board]")).toHaveAttribute("data-board", "DEMO");
    await expect.poll(async () => (await context.cookies()).some((cookie) => cookie.name === "jo-board")).toBe(false);
  });

  test("signing in forgets a board someone else picked in this browser", async ({ page, context }) => {
    await context.addCookies([{ name: "jo-board", value: "OTHER", url: APP_URL }]);
    await signedIn(page, "/");
    expect((await context.cookies()).some((cookie) => cookie.name === "jo-board")).toBe(false);
  });

  test("a user's top bar says nothing about a role", async ({ page }) => {
    await signedIn(page, "/");
    await expect(page.getByRole("banner").locator("[data-role=admin]")).toHaveCount(0);
  });
});

test.describe("admins (ADMIN_EMAILS) see every board", () => {
  test("an admin gets in even when their Jira opens no board, and reads every board", async ({ page, context }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
    await chooseAccount(page, ACCOUNTS.admin);
    // Going nowhere in particular, an admin lands on the Portfolio, every board at once (JO-12).
    await expect(page).toHaveURL(`${APP_URL}/portfolio`);
    await expect(page.getByRole("banner").getByText("Admin", { exact: true })).toBeVisible();

    const list = (await (await page.request.get("/api/oversight/projects")).json()) as { projects: { key: string }[] };
    expect(list.projects.map((board) => board.key)).toEqual(["DEMO", "MOB", "HELP"]);

    // Any board an admin picks is read, never refused: MOB, which this account's Jira does not open.
    await context.addCookies([{ name: "jo-board", value: "MOB", url: APP_URL }]);
    expect((await page.request.get("/api/oversight/overview")).status()).toBe(200);
  });
});

test.describe("JO-07: the person view, on the boards a person may read", () => {
  interface PeopleBody {
    meta: { projects: string[] };
    people: { person: { id: string; name: string } | null; open_breaches: number; open_warnings: number }[];
  }

  const personRows = (page: Page) => page.getByRole("list", { name: "Open findings by person" }).getByRole("link");
  /** "124 open findings · 88 breaches": the one live region on Findings that starts with a figure. */
  const resultLine = (page: Page) => page.getByRole("status").filter({ hasText: /^\s*[\d,]+ / });
  const count = (value: number) => new Intl.NumberFormat("en-GB").format(value);

  async function peopleOnBoard(page: Page): Promise<PeopleBody> {
    const response = await page.request.get("/api/oversight/people");
    expect(response.status()).toBe(200);
    return (await response.json()) as PeopleBody;
  }

  /** The board's lead person: the sample's first row is someone, not the unassigned tickets. */
  function leadOf(body: PeopleBody) {
    const [lead] = body.people;
    if (!lead?.person) throw new Error("the sample's lead row should be a person");
    return { ...lead, person: lead.person };
  }

  test("a user sees who carries the findings on their board, filters to one person and reads a ticket's assignee", async ({
    page,
  }) => {
    const problems = watchConsole(page);
    await signedIn(page, "/");
    const body = await peopleOnBoard(page);
    expect(body.meta.projects).toEqual(["DEMO"]);
    const lead = leadOf(body);

    await expect(personRows(page)).toHaveCount(body.people.length);
    await expect(personRows(page).first()).toContainText(lead.person.name);
    await expect(personRows(page).last()).toContainText("Unassigned");
    await personRows(page).first().click();
    await expect(page).toHaveURL(`${APP_URL}/findings?state=open&person=${lead.person.id}`);
    await expect(page.getByRole("button", { name: `Person ${lead.person.name}` })).toBeVisible();
    await expect(resultLine(page)).toContainText(`${count(lead.open_breaches + lead.open_warnings)} open findings`);

    await page.goto("/issues/DEMO-1");
    await expect(page.locator("[data-assignee]")).toContainText("Assignee");
    await expect(page.getByRole("link", { name: /: show their open findings$/ })).toHaveAttribute(
      "href",
      /^\/findings\?person=p[0-9a-f]{12}$/,
    );
    expect(problems).toEqual([]);
  });

  test("an admin sees the same person view, and the Person menu lists everyone on the board", async ({ page, context }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
    await chooseAccount(page, ACCOUNTS.admin);
    await expect(page).toHaveURL(`${APP_URL}/portfolio`);
    await page.goto("/");
    await expect(page.getByRole("banner").getByText("Admin", { exact: true })).toBeVisible();
    const body = await peopleOnBoard(page);
    const lead = leadOf(body);
    await expect(personRows(page)).toHaveCount(body.people.length);

    await page.goto("/findings?state=open&menu=person");
    const menu = page.getByRole("listbox", { name: "Person" });
    await expect(menu.getByRole("option")).toHaveCount(body.people.length);
    await expect(menu.getByRole("option").last()).toHaveText(/^Unassigned/);
    await menu.getByRole("option", { name: new RegExp(`^${lead.person.name}`) }).click();
    await expect(page).toHaveURL(new RegExp(`/findings\\?(.*&)?person=${lead.person.id}(&|$)`));

    // Any board an admin picks is read, the person view with it: MOB, which this account's Jira does not open.
    await context.addCookies([{ name: "jo-board", value: "MOB", url: APP_URL }]);
    for (const path of ["/api/oversight/people", `/api/oversight/findings?person=${lead.person.id}`]) {
      expect((await page.request.get(path)).status(), path).toBe(200);
    }
  });

  test("the person filter never reaches a board the user cannot open", async ({ page, context }) => {
    await signedIn(page, "/");
    const lead = leadOf(await peopleOnBoard(page));

    // On their own board, an id nobody there has (someone from another board, say) matches nothing.
    const stranger = await page.request.get("/api/oversight/findings?person=p000000000000");
    expect(stranger.status()).toBe(200);
    expect(await stranger.json()).toMatchObject({ total: 0, items: [] });
    // The board is the top bar's pick, never the query's.
    for (const path of ["/api/oversight/people?project=OTHER", `/api/oversight/findings?person=${lead.person.id}&project=OTHER`]) {
      const response = await page.request.get(path);
      expect(response.status(), path).toBe(400);
      expect(await response.json(), path).toMatchObject({ error: "bad_request" });
    }

    // Another board stays refused, whatever the person parameter says, and nothing of anyone comes back.
    await context.addCookies([{ name: "jo-board", value: "OTHER", url: APP_URL }]);
    for (const path of [
      "/api/oversight/people",
      `/api/oversight/findings?person=${lead.person.id}`,
      "/api/oversight/findings?person=unassigned",
      `/api/oversight/findings?state=all&person=${lead.person.id}&person=unassigned`,
      "/api/oversight/findings?person=p000000000000",
    ]) {
      const refused = await page.request.get(path);
      expect(refused.status(), path).toBe(403);
      const text = await refused.text();
      expect(JSON.parse(text), path).toMatchObject({ error: "board_not_allowed" });
      expect(text, path).not.toContain(lead.person.name);
      expect(text, path).not.toContain(lead.person.id);
    }

    // A link to one person's findings opens on the user's own board instead, and the pick is forgotten.
    await page.goto(`/findings?state=open&person=${lead.person.id}`);
    await expect(page.getByRole("banner").locator("[data-board]")).toHaveAttribute("data-board", "DEMO");
    await expect(page.getByRole("button", { name: `Person ${lead.person.name}` })).toBeVisible();
    await expect(resultLine(page)).toContainText(`${count(lead.open_breaches + lead.open_warnings)} open findings`);
    await expect.poll(async () => (await context.cookies()).some((cookie) => cookie.name === "jo-board")).toBe(false);
  });
});

test.describe("Ask about people: admins only (11 Nov 2026)", () => {
  const RANKING = "Who has the most open breaches?";
  const TEAM_LEVEL = "Ask answers at team level. To see one person's findings, use the Person filter on Findings.";
  const answerTo = (page: Page, question: string) => page.getByRole("article", { name: question });

  async function boardLead(page: Page): Promise<{ id: string; name: string }> {
    const body = (await (await page.request.get("/api/oversight/people")).json()) as { people: { person: { id: string; name: string } | null }[] };
    const lead = body.people.find((row) => row.person !== null)?.person;
    if (!lead) throw new Error("the sample's board should have people");
    return lead;
  }

  test("an admin types @ to pick someone from the board, and gets answers that name people", async ({ page }) => {
    const problems = watchConsole(page);
    await page.goto("/ask");
    await expect(page).toHaveURL(/\/login/);
    await chooseAccount(page, ACCOUNTS.admin);
    await expect(page).toHaveURL(`${APP_URL}/ask`);
    const lead = await boardLead(page);

    const field = page.getByRole("textbox", { name: "Your question" });
    await expect(field).toHaveAttribute("aria-haspopup", "listbox");
    // Typed only once the page is live: the sync time is drawn then (it reads the viewer's clock). A key pressed before
    // hydration lands in the server's markup and is taken back with it (the JO-11 check: the @ was lost in 2 runs of 6
    // in Chromium, on a page just reached from the sign-in redirect), as ask.spec waits for it.
    await expect(page.getByRole("banner").getByRole("button", { name: /Sample data/ })).toBeVisible();
    await expect(page.getByRole("banner").locator("[data-sync-now]").filter({ hasText: / ago/ })).toBeVisible();
    await field.click();
    await page.keyboard.type("@");
    const list = page.getByRole("listbox", { name: "People to mention" });
    await expect(list).toBeVisible();
    await expect(list.getByRole("option", { name: lead.name })).toBeVisible();
    await page.keyboard.press("Escape");

    await field.fill(RANKING);
    await page.keyboard.press("Enter");
    await expect(answerTo(page, RANKING)).toBeVisible();
    await expect(answerTo(page, RANKING).locator(`[data-person-mention="${lead.id}"]`).first()).toHaveText(lead.name);

    const asked = await page.request.post("/api/oversight/ask", { data: { question: "What is the work of this person?", mentions: [lead.id] }, headers: { origin: APP_URL } });
    expect(asked.status()).toBe(200);
    expect(((await asked.json()) as { people: { id: string }[] }).people.map((person) => person.id)).toEqual([lead.id]);
    expect(problems).toEqual([]);
  });

  test("a user gets no @ list, and a question about people is answered at team level", async ({ page }) => {
    await signedIn(page, "/ask");
    const field = page.getByRole("textbox", { name: "Your question" });
    await expect(field).not.toHaveAttribute("aria-haspopup");
    await field.click();
    await page.keyboard.type("@");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(page.locator("[data-mention-menu]")).toHaveCount(0);

    await field.fill(RANKING);
    await page.keyboard.press("Enter");
    await expect(answerTo(page, RANKING).getByText(TEAM_LEVEL)).toBeVisible();
    await expect(answerTo(page, RANKING).getByRole("link", { name: /Open the Person filter/ })).toHaveAttribute(
      "href",
      "/findings?state=open&menu=person",
    );
    await expect(page.locator("[data-person-mention]")).toHaveCount(0);

    // What the route answers carries no one, whatever is asked.
    const lead = await boardLead(page);
    for (const question of [RANKING, `What are ${lead.name}'s open findings?`]) {
      const body = (await (await page.request.post("/api/oversight/ask", { data: { question }, headers: { origin: APP_URL } })).json()) as { people: unknown[]; message: string };
      expect(body.people, question).toEqual([]);
      expect(body.message, question).toBe(TEAM_LEVEL);
    }
  });

  test("a user's crafted request with mentions, or a level of its own, is refused before anything is asked", async ({ page }) => {
    await signedIn(page, "/");
    const lead = await boardLead(page);
    const refused = await page.request.post("/api/oversight/ask", { data: { question: `What are @${lead.name}'s open findings?`, mentions: [lead.id] }, headers: { origin: APP_URL } });
    expect(refused.status()).toBe(403);
    const text = await refused.text();
    expect(JSON.parse(text)).toMatchObject({ error: "people_not_allowed" });
    expect(text).not.toContain(lead.name);
    for (const level of ["people", "team"]) {
      const chosen = await page.request.post("/api/oversight/ask", { data: { question: RANKING, level }, headers: { origin: APP_URL } });
      expect(chosen.status(), level).toBe(400);
      expect(await chosen.json(), level).toMatchObject({ error: "bad_request" });
    }
  });
});

test.describe("person scorecards: admins only (JO-11)", () => {
  test("a user has no People page: no item in the rail, the not-found page at /people, and the figures refused", async ({ page }) => {
    await signedIn(page, "/");
    const rail = page.getByRole("navigation", { name: "Primary" });
    await expect(rail.getByRole("link", { name: "Ask" })).toBeVisible();
    await expect(rail.getByRole("link", { name: "People" })).toHaveCount(0);
    // The not-found page, as for any address the reader has no page at. (Its status is 200, not 404: the page is
    // refused inside the shell's loading boundary, after the response has started.)
    await page.goto("/people");
    await expect(page.getByRole("heading", { level: 1, name: "Nothing at this address" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "People" })).toHaveCount(0);
    const refused = await page.request.get("/api/oversight/people/scorecard");
    expect(refused.status()).toBe(403);
    expect(await refused.json()).toMatchObject({ error: "people_not_allowed" });
  });

  test("an admin has the People page: everyone's figures next to the whole board's", async ({ page }) => {
    const problems = watchConsole(page);
    await page.goto("/people");
    await expect(page).toHaveURL(/\/login/);
    await chooseAccount(page, ACCOUNTS.admin);
    await expect(page).toHaveURL(`${APP_URL}/people`);
    await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "People" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("table", { name: /Everyone with tickets/ })).toBeVisible();
    expect(problems).toEqual([]);
  });
});

test.describe("person cards: admins only (JO-13)", () => {
  /** Someone the sample's board names: the lead row of GET /people, a person. */
  async function someone(page: Page): Promise<{ id: string; name: string }> {
    const body = (await (await page.request.get("/api/oversight/people")).json()) as { people: { person: { id: string; name: string } | null }[] };
    const person = body.people.find((row) => row.person)?.person;
    if (!person) throw new Error("the sample's board should name someone");
    return person;
  }

  test("a user's names are plain names: nothing opens a card, on hover or a press, and the card is refused", async ({ page }) => {
    const problems = watchConsole(page);
    await signedIn(page, "/findings");
    const name = page.locator("table tbody [data-person-name]").first();
    await expect(name).toBeVisible();
    await expect(page.locator("[data-person-card-trigger]")).toHaveCount(0);
    await name.hover();
    await page.waitForTimeout(700);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.goto("/issues/DEMO-1");
    const assignee = page.getByRole("link", { name: /: show their open findings$/ });
    await assignee.hover();
    await page.waitForTimeout(700);
    await expect(page.locator("[data-person-card]")).toHaveCount(0);

    const person = await someone(page);
    const refused = await page.request.get(`/api/oversight/people/${person.id}/card`);
    expect(refused.status()).toBe(403);
    expect(await refused.json()).toMatchObject({ error: "people_not_allowed", message: "Only admins can see person cards." });
    expect(problems).toEqual([]);
  });

  test("an admin's names open the card: on hover, then pinned on a press, and it reads every board", async ({ page, context }) => {
    const problems = watchConsole(page);
    await page.goto("/findings");
    await expect(page).toHaveURL(/\/login/);
    await chooseAccount(page, ACCOUNTS.admin);
    await expect(page).toHaveURL(`${APP_URL}/findings`);
    const name = page.locator("table tbody [data-person-card-trigger]").first();
    await expect(name).toBeVisible();
    const who = (await name.locator("[data-person-name]").textContent())!.trim();
    await name.hover();
    const card = page.getByRole("dialog", { name: who });
    await expect(card.locator("[data-person-card]")).toHaveAttribute("data-card-state", "ready");
    await expect(card.getByRole("link", { name: "View scorecard" })).toBeVisible();
    await name.click();
    await expect(card).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(card).toBeHidden();

    // Any board an admin picks is read, the card with it: MOB, which this account's Jira does not open.
    const person = await someone(page);
    await context.addCookies([{ name: "jo-board", value: "MOB", url: APP_URL }]);
    expect((await page.request.get(`/api/oversight/people/${person.id}/card`)).status()).toBe(200);
    expect(problems).toEqual([]);
  });
});

test.describe("Portfolio and Governance (JO-12)", () => {
  const GOVERNANCE = ["/governance", "/governance/access-log", "/governance/usage"];

  async function axeBlocking(page: Page) {
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    return results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => violation.id);
  }

  test("a user lands on the Overview, has the Portfolio of their own boards, and no Governance: not in the rail, the not-found page, the figures refused", async ({ page }) => {
    await signedIn(page, "/");
    const rail = page.getByRole("navigation", { name: "Primary" });
    await expect(rail.getByRole("link", { name: "Portfolio" })).toBeVisible();
    await expect(rail.getByText("Governance", { exact: true })).toHaveCount(0);
    await expect(rail.getByRole("link", { name: "Access log" })).toHaveCount(0);
    await expect(rail.getByRole("link", { name: "Usage" })).toHaveCount(0);
    for (const path of GOVERNANCE) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: "Nothing at this address" }), path).toBeVisible();
    }
    for (const path of ["access-log", "usage"]) {
      const refused = await page.request.get(`/api/oversight/${path}`);
      expect(refused.status(), path).toBe(403);
      expect(await refused.json(), path).toMatchObject({ error: "people_not_allowed" });
    }
    await page.goto("/portfolio");
    await expect(page.getByRole("heading", { level: 1, name: "Portfolio" })).toBeVisible();
    const portfolio = (await (await page.request.get("/api/oversight/portfolio")).json()) as { boards: { project: { key: string } }[] };
    expect(portfolio.boards.map((board) => board.project.key)).toEqual(["DEMO"]);
    expect(await axeBlocking(page)).toEqual([]);
  });

  test("an admin lands on the Portfolio and has Governance: the access log and usage, axe passing", async ({ page }) => {
    // Sign-in, three pages and three axe passes (the access log's 50 rows among them): about 21 s in WebKit alone.
    test.slow();
    const problems = watchConsole(page);
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
    await chooseAccount(page, ACCOUNTS.admin);
    await expect(page).toHaveURL(`${APP_URL}/portfolio`);
    await expect(page.getByRole("table", { name: "Boards" }).getByRole("row").filter({ hasText: "Demo project" })).toBeVisible();
    const rail = page.getByRole("navigation", { name: "Primary" });
    await expect(rail.getByRole("link", { name: "Portfolio" })).toHaveAttribute("aria-current", "page");
    expect(await axeBlocking(page)).toEqual([]);
    await rail.getByRole("link", { name: "Access log" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Access log" })).toBeVisible();
    await expect(page.getByRole("table", { name: "Access log" }).locator("tbody tr")).toHaveCount(50);
    expect(await axeBlocking(page)).toEqual([]);
    await rail.getByRole("link", { name: "Usage" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Usage" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Tokens a day" }).getByRole("listitem")).toHaveCount(7);
    expect(await axeBlocking(page)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("an admin who signs in on the way to a page lands on that page, not the Portfolio", async ({ page }) => {
    await page.goto(DEEP_LINK);
    await expect(page).toHaveURL(LOGIN_FOR_DEEP_LINK);
    await chooseAccount(page, ACCOUNTS.admin);
    await expect(page).toHaveURL(`${APP_URL}${DEEP_LINK}`);
  });
});

test.describe("Rule settings: admins only (JO-15, JO-20)", () => {
  /** A change as the page sends it: JSON, from the dashboard's own origin, which the route requires. */
  const CHANGE = { revision: 0, changes: [{ rule_id: "W-AGE-01", enabled: false }] };
  /** An AI draft of a rule (JO-20), as the New rule sheet asks for one. */
  const DRAFT = { text: "Bugs in progress for more than 3 days" };

  test("a user is not offered them: not in the rail, on the Process page or on g then r; the not-found page; reads and changes refused", async ({ page }) => {
    await signedIn(page, "/process");
    const rail = page.getByRole("navigation", { name: "Primary" });
    await expect(page.getByRole("heading", { level: 1, name: "Process" })).toBeVisible();
    await expect(rail.getByRole("link", { name: "Rule settings" })).toHaveCount(0);
    await expect(page.getByRole("table", { name: "Rules" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit rule settings" })).toHaveCount(0);
    await page.keyboard.press("g");
    await page.keyboard.press("r");
    await expect(page.getByRole("heading", { level: 1, name: "Process" })).toBeVisible();
    await expect(page).toHaveURL(`${APP_URL}/process`);

    await page.goto("/governance/rules");
    await expect(page.getByRole("heading", { level: 1, name: "Nothing at this address" })).toBeVisible();
    const read = await page.request.get("/api/oversight/rules/settings");
    expect(read.status()).toBe(403);
    expect(await read.json()).toMatchObject({ error: "people_not_allowed", message: "Only admins can see rule settings." });
    for (const [path, data] of [
      ["rules/settings", CHANGE],
      ["rules/settings/preview", CHANGE],
      ["rules/settings/draft", DRAFT],
    ] as const) {
      const changed = await page.request.post(`/api/oversight/${path}`, { data, headers: { origin: APP_URL } });
      expect(changed.status(), path).toBe(403);
      expect(await changed.json(), path).toMatchObject({ error: "people_not_allowed", message: "Only admins can change rule settings." });
    }
  });

  test("an admin has them, and a change from anywhere but the dashboard's own pages is refused", async ({ page }) => {
    const problems = watchConsole(page);
    await page.goto("/governance/rules");
    await expect(page).toHaveURL(/\/login/);
    await chooseAccount(page, ACCOUNTS.admin);
    await expect(page).toHaveURL(`${APP_URL}/governance/rules`);
    await expect(page.getByRole("heading", { level: 1, name: "Rule settings" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Rule settings" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: "Hard and fast rules" })).toBeVisible();
    // Read-only here: a change from another site, or with no origin, never reaches the settings.
    const elsewhere: Record<string, string>[] = [{ origin: "https://elsewhere.test" }, {}];
    for (const headers of elsewhere) {
      const forged = await page.request.post("/api/oversight/rules/settings", { data: CHANGE, headers });
      expect(forged.status(), JSON.stringify(headers)).toBe(403);
      expect(await forged.json()).toMatchObject({ error: "forbidden" });
      const drafted = await page.request.post("/api/oversight/rules/settings/draft", { data: DRAFT, headers });
      expect(drafted.status(), JSON.stringify(headers)).toBe(403);
      expect(await drafted.json()).toMatchObject({ error: "forbidden", message: "A rule can be drafted only from this dashboard's own pages, so nothing was drafted." });
    }
    // An admin's own draft, from the dashboard's own pages, saves nothing.
    await expect(page.locator("[data-add-rule]")).toBeEnabled();
    const own = await page.request.post("/api/oversight/rules/settings/draft", { data: DRAFT, headers: { origin: APP_URL } });
    expect(own.status()).toBe(200);
    expect(await own.json()).toMatchObject({ outcome: "drafted", draft: { check: "time_in_status_over" } });
    const settings = (await (await page.request.get("/api/oversight/rules/settings")).json()) as { revision: number };
    expect(settings.revision).toBe(0);
    expect(problems).toEqual([]);
  });
});

test.describe("the gate", () => {
  test("the oversight API answers 401 unauthenticated without a session, and 200 with one", async ({ page, request }) => {
    const anonymous = await request.get("/api/oversight/health");
    expect(anonymous.status()).toBe(401);
    expect(await anonymous.json()).toMatchObject({ error: "unauthenticated" });
    expect(anonymous.headers()["cache-control"]).toContain("no-store");
    expect((await request.post("/api/oversight/ask", { data: { question: "where do tickets get stuck" } })).status()).toBe(401);

    await signedIn(page, "/");
    const signed = await page.request.get("/api/oversight/health");
    expect(signed.status()).toBe(200);
    expect(await signed.json()).toMatchObject({ status: "ok", data_mode: "sample" });
  });

  test("no prefetch, RSC or other header, and no encoding, gets round it", async ({ request }) => {
    const headers = {
      RSC: "1",
      "Next-Router-Prefetch": "1",
      "Next-Router-Segment-Prefetch": "/_tree",
      "Next-Router-State-Tree": encodeURIComponent(JSON.stringify(["", { children: ["__PAGE__", {}] }, null, null, true])),
      "Next-Url": "/findings",
      Purpose: "prefetch",
      "Sec-Purpose": "prefetch",
      "X-Middleware-Subrequest": "proxy:proxy:proxy:proxy:proxy",
      "X-Nextjs-Data": "1",
      "X-Forwarded-Host": "elsewhere.test",
      "X-Forwarded-Proto": "https",
    };
    for (const path of ["/findings", "/findings?_rsc=1a2b3", "/%66indings", "/issues/DEMO-1", "/design"]) {
      const response = await request.get(path, { headers, maxRedirects: 0 });
      expect(response.status(), path).toBe(303);
      expect(response.headers().location, path).toMatch(new RegExp(`^${APP_URL}/login(\\?|$)`));
      // No page comes with it: the body is at most the address it points to.
      expect(await response.text(), path).not.toContain("<");
    }
    for (const path of ["/api/oversight/health", "/api/oversight/%68ealth", "/api/oversight/overview"]) {
      const response = await request.get(path, { headers, maxRedirects: 0 });
      expect(response.status(), path).toBe(401);
      expect(await response.json(), path).toMatchObject({ error: "unauthenticated" });
    }
  });

  test("a tampered session cookie counts as signed out", async ({ page }) => {
    await signedIn(page, DEEP_LINK);
    const cookie = await sessionCookie(page.context());
    if (!cookie) throw new Error("no session cookie after signing in");
    const at = Math.floor(cookie.value.length / 2);
    const tampered = `${cookie.value.slice(0, at)}${cookie.value[at] === "A" ? "B" : "A"}${cookie.value.slice(at + 1)}`;
    // Off the dashboard first: an open page would meet the 401 in its next refetch and go to /login itself,
    // racing the navigation below.
    await page.goto("about:blank");
    await page.context().addCookies([{ ...cookie, value: tampered }]);

    await page.goto(DEEP_LINK);
    await expect(page).toHaveURL(LOGIN_FOR_DEEP_LINK);
    expect((await page.request.get("/api/oversight/health")).status()).toBe(401);
  });

  test("a missing file under /_next/static/, which the proxy never sees, shows no shell without a session", async ({ request }) => {
    const response = await request.get("/_next/static/no-such-file.js", { maxRedirects: 0 });
    // The shell's own check (src/app/(app)/layout.tsx) turns it away, as the proxy would have.
    expect(response.status()).toBe(307);
    expect(response.headers().location).toBe("/login");
    const body = await response.text();
    for (const shell of ["Skip to content", "Sign out", "Search or jump to"]) expect(body).not.toContain(shell);
  });

  test("signing out is a POST from the dashboard's own pages only", async ({ request }) => {
    const foreign = await request.post("/api/auth/logout", { headers: { Origin: "http://elsewhere.test" }, maxRedirects: 0 });
    expect(foreign.status()).toBe(403);
    expect((await request.get("/api/auth/logout", { maxRedirects: 0 })).status()).toBe(405);
  });

  test("the sign-in button never leads off the dashboard", async ({ page }) => {
    for (const next of ["//elsewhere.test/x", "https://elsewhere.test/", "/\\elsewhere.test", "/%2F%2Felsewhere.test", "/login"]) {
      await page.goto(`/login?next=${encodeURIComponent(next)}`);
      await expect(signInButton(page), next).toHaveAttribute("href", "/api/auth/login");
    }
  });

  test("when sign-in is not set up, nobody gets in and /login says what to fix", async ({ page, request }) => {
    const problems = watchConsole(page);
    await page.goto(`${BROKEN_APP_URL}${DEEP_LINK}`);
    await expect(page).toHaveURL(new RegExp(`^${BROKEN_APP_URL}/login`));
    await expect(page.getByRole("heading", { level: 1, name: "Sign-in is not set up on this server" })).toBeVisible();
    await expect(page.getByText("AUTH_SECRET must be at least 32 characters of random.")).toBeVisible();
    expect(await page.content()).not.toContain(SHORT_SECRET);
    await expect(signInButton(page)).toHaveCount(0);

    const api = await request.get(`${BROKEN_APP_URL}/api/oversight/health`);
    expect(api.status()).toBe(500);
    expect(await api.json()).toMatchObject({ error: "not_configured" });
    expect(await api.text()).not.toContain(SHORT_SECRET);
    const start = await request.get(`${BROKEN_APP_URL}/api/auth/login`, { maxRedirects: 0 });
    expect(start.status()).toBe(303);
    expect(start.headers().location).not.toContain(MOCK_URL);
    expect(problems).toEqual([]);
  });
});

test.describe("the top bar, with sign-in on", () => {
  test("never scrolls sideways from 768 px up, and keeps Sign out on screen", async ({ page }) => {
    // Ten page loads at five widths: about 25 s in WebKit alone, past 30 s in a busy full run.
    test.slow();
    await signedIn(page, "/findings");
    for (const width of [768, 820, 1024, 1280, 1366]) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of ["/findings", "/issues/DEMO-12"]) {
        const label = `${width} px, ${path}`;
        await page.goto(path);
        const banner = page.getByRole("banner");
        // Loaded: the data source and the sync time, the two widest things in the bar.
        await expect(banner.getByRole("button", { name: /Sample data/ }), label).toBeVisible();
        await expect(banner.locator("[data-sync-now]"), label).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, label).toBeLessThanOrEqual(0);
        const signOut = await banner.getByRole("button", { name: "Sign out" }).boundingBox();
        expect(signOut, label).not.toBeNull();
        expect((signOut?.x ?? width) + (signOut?.width ?? 0), label).toBeLessThanOrEqual(width);
        // The board picker gives way, but stays wide enough to read.
        expect((await banner.locator("[data-board]").boundingBox())?.width ?? 0, label).toBeGreaterThanOrEqual(112);
      }
    }
  });
});

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`the sign-in pages, ${colorScheme} theme`, () => {
    test.use({ colorScheme });

    for (const path of [...SIGN_IN_PAGES, `${BROKEN_APP_URL}/login`]) {
      test(`${path} has no axe violations and logs nothing`, async ({ page }) => {
        const problems = watchConsole(page);
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
        const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
        expect(
          results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`),
        ).toEqual([]);
        expect(problems).toEqual([]);
      });
    }

    test("fit a 390 px phone without scrolling sideways", async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      for (const path of [...SIGN_IN_PAGES, `${BROKEN_APP_URL}/login`]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 }), path).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, path).toBeLessThanOrEqual(0);
      }
    });
  });
}
