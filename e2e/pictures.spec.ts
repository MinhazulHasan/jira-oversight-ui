import { createHash } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

const NOW = new Date("2026-11-04T14:30:00Z");
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const PICTURES = "**/api/oversight/people/*/avatar*";
/** DEMO-1098, R-EST-01 (docs/sample-responses/finding.json): its issue is assigned to someone with a picture. */
const BREACH_ID = "0b7b3b0f61c477e61699982f24892735";
/** An issue nobody is assigned to in the sample. */
const UNASSIGNED_ISSUE = "DEMO-1133";

interface Person {
  id: string;
  name: string;
  avatar: string | null;
}

interface FindingsBody {
  items: { finding_id: string; scope: "issue" | "sprint"; issue_key: string | null; assignee: Person | null }[];
  facets: { people: { value: string; label: string; count: number; avatar: string | null }[] };
}

async function api<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(`/api/oversight/${path}`);
  expect(response.ok(), path).toBe(true);
  return (await response.json()) as T;
}

const findings = (request: APIRequestContext, search = "") => api<FindingsBody>(request, `findings${search}`);

/** A people facet entry as the person it names; null for the unassigned tickets. */
const personOf = (entry: FindingsBody["facets"]["people"][number]): Person | null =>
  entry.value === "unassigned" ? null : { id: entry.value, name: entry.label, avatar: entry.avatar };

/** The initials of the sample's two-word fictional names. */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .toUpperCase();

async function axeBlocking(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => ({ id: violation.id, help: violation.help, targets: violation.nodes.map((node) => node.target.join(" ")) }));
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

async function sidewaysScroll(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** What an avatar shows, as a reader and a screen reader get it. */
async function seen(avatar: Locator) {
  return avatar.evaluate((element) => {
    const image = element.querySelector("img");
    const box = element.getBoundingClientRect();
    return {
      state: element.getAttribute("data-avatar"),
      initials: element.getAttribute("data-initials"),
      drawn: getComputedStyle(element, "::before").content,
      src: image?.getAttribute("src") ?? null,
      alt: image?.getAttribute("alt") ?? null,
      loaded: image ? image.complete && image.naturalWidth > 0 : false,
      hidden: element.getAttribute("aria-hidden"),
      size: [Math.round(box.width), Math.round(box.height)],
      radius: getComputedStyle(element).borderTopLeftRadius,
      right: box.right,
    };
  });
}

/** Holds an avatar to what its person object says: the picture, the initials, or (nobody) the figure. */
async function expectAvatar(avatar: Locator, person: Person | null, size = 20) {
  await expect(avatar).toHaveCount(1);
  if (person?.avatar) {
    await expect.poll(async () => (await seen(avatar)).loaded, { message: `${person.name}'s picture loads` }).toBe(true);
  }
  const shown = await seen(avatar);
  // Decorative, round and of a set size, whichever it shows.
  expect(shown).toMatchObject({ hidden: "true", size: [size, size], radius: "50%" });
  if (person === null) {
    expect(shown).toMatchObject({ state: "none", src: null, initials: null });
  } else if (person.avatar) {
    expect(shown).toMatchObject({ state: "picture", src: `/api/oversight/people/${person.id}/avatar?v=${person.avatar}`, alt: "" });
  } else {
    expect(shown).toMatchObject({ state: "initials", src: null, initials: initials(person.name) });
    // Drawn by the stylesheet, so the initials never join the text a reader copies.
    expect(shown.drawn).toMatch(new RegExp(`^("${initials(person.name)}"|attr\\(data-initials\\))$`));
  }
  return shown;
}

/* The Findings page, as people.spec.ts reads it. */
const resultLine = (page: Page) => page.getByRole("status").filter({ hasText: /^\s*[\d,]+ / });
const table = (page: Page) => page.getByRole("table", { name: "Findings" });

async function listReady(page: Page) {
  await expect(resultLine(page)).toContainText(/\d/);
  await expect(page.getByRole("banner").getByRole("button", { name: /Sample data/ })).toBeVisible();
}

async function assigneeCells(page: Page) {
  const headers = await table(page).locator("thead th").allTextContents();
  const at = headers.findIndex((text) => text.trim() === "Assignee");
  expect(at, "the Findings table has an Assignee column").toBeGreaterThanOrEqual(0);
  return table(page).locator("tbody tr").locator(`> :nth-child(${at + 1})`);
}

/** Each row of the Overview's open findings by person, as a whole: a person's name and picture open their card. */
const peopleRows = (page: Page) => page.getByRole("list", { name: "Open findings by person" }).getByRole("listitem");
/** The drawer's facts: the value beside a label. */
const fact = (scope: Locator, label: string) => scope.locator("dt", { hasText: new RegExp(`^${label}$`) }).locator("xpath=following-sibling::dd[1]");

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      console.error(`CSP violation: ${event.violatedDirective} blocked ${event.blockedURI || "inline"}`);
    });
  });
});

test.describe("pictures beside names", () => {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`the Overview's people, chart and table: a picture or the initials, a figure for Unassigned; axe clean (${colorScheme})`, async ({
      page,
      request,
    }) => {
      await page.emulateMedia({ colorScheme });
      const problems = watchConsole(page);
      const rows = (await api<{ people: { person: Person | null }[] }>(request, "people")).people;
      // The sample's two pictures, and six people without one.
      expect(rows.filter((row) => row.person?.avatar).length).toBe(2);
      expect(rows.filter((row) => row.person && !row.person.avatar).length).toBe(6);

      await page.goto("/");
      await expect(peopleRows(page)).toHaveCount(rows.length);
      for (const [index, row] of rows.entries()) {
        const link = peopleRows(page).nth(index);
        await expectAvatar(link.locator(".jo-avatar"), row.person);
        // Beside the name, never in its place: the row is named, and reads, by the person.
        await expect(link).toContainText(row.person?.name ?? "Unassigned");
      }
      expect(await axeBlocking(page)).toEqual([]);

      await page.getByRole("region", { name: "People" }).getByRole("radio", { name: "Table" }).click();
      const figures = page.getByRole("region", { name: "People" }).getByRole("table", { name: "Open findings by person" });
      await expect(figures.locator("tbody tr")).toHaveCount(rows.length);
      for (const [index, row] of rows.entries()) {
        const cell = figures.locator("tbody tr").nth(index).locator("td").first();
        await expectAvatar(cell.locator(".jo-avatar"), row.person);
        await expect(cell).toHaveText(row.person?.name ?? "Unassigned");
      }
      expect(await axeBlocking(page)).toEqual([]);
      expect(problems).toEqual([]);
    });

    test(`Findings: each row's assignee and every entry of the Person menu; axe clean (${colorScheme})`, async ({ page, request }) => {
      test.slow();
      await page.emulateMedia({ colorScheme });
      const problems = watchConsole(page);
      const first = await findings(request);
      // Both kinds on the first page: someone with a picture and someone without.
      expect(first.items.some((item) => item.assignee?.avatar)).toBe(true);
      expect(first.items.some((item) => item.assignee && !item.assignee.avatar)).toBe(true);

      await page.goto("/findings");
      await listReady(page);
      const cells = await assigneeCells(page);
      await expect(cells).toHaveCount(first.items.length);
      for (const [index, item] of first.items.entries()) {
        const avatar = cells.nth(index).locator(".jo-avatar");
        // A sprint finding belongs to no one: a dash, and no picture of anyone.
        if (item.scope === "sprint") await expect(avatar).toHaveCount(0);
        else await expectAvatar(avatar, item.assignee);
      }
      expect(await axeBlocking(page)).toEqual([]);

      await page.getByRole("button", { name: "Person Any" }).click();
      const options = page.getByRole("listbox", { name: "Person" }).getByRole("option");
      await expect(options).toHaveCount(first.facets.people.length);
      for (const [index, entry] of first.facets.people.entries()) {
        await expectAvatar(options.nth(index).locator(".jo-avatar"), personOf(entry));
        // The option still reads as the name and its count, nothing more.
        await expect(options.nth(index)).toHaveText(new RegExp(`^${entry.label}\\s*${entry.count.toLocaleString("en-GB")}$`));
      }
      expect(await axeBlocking(page)).toEqual([]);
      expect(problems).toEqual([]);
    });
  }

  test("the evidence drawer: the picture, the initials or the figure beside who has the issue now; axe clean", async ({
    page,
    request,
  }) => {
    const breach = await api<{ finding: { assignee: Person | null } }>(request, `findings/${BREACH_ID}`);
    expect(breach.finding.assignee?.avatar, "the showcase breach's assignee has a picture").toBeTruthy();
    const first = await findings(request);
    const plain = first.items.find((item) => item.assignee !== null && item.assignee.avatar === null);
    const nobodys = (await findings(request, "?person=unassigned&page_size=1")).items[0];
    if (!plain || !nobodys) throw new Error("the sample should have a finding for someone without a picture, and an unassigned one");

    for (const [id, person] of [
      [BREACH_ID, breach.finding.assignee],
      [plain.finding_id, plain.assignee],
      [nobodys.finding_id, null],
    ] as const) {
      await page.goto(`/findings?finding=${id}`);
      const drawer = page.getByRole("dialog");
      await expect(drawer).toBeVisible();
      const value = fact(drawer, "Assignee");
      await expectAvatar(value.locator(".jo-avatar"), person);
      await expect(value).toHaveText(person?.name ?? "Unassigned");
      expect(await axeBlocking(page)).toEqual([]);
    }
  });

  for (const colorScheme of ["light", "dark"] as const) {
    test(`the ticket page: the assignee's picture or initials inside the link to their findings, a figure for Unassigned (${colorScheme})`, async ({
      page,
      request,
    }) => {
      await page.emulateMedia({ colorScheme });
      const problems = watchConsole(page);
      const pictured = (await findings(request)).facets.people.find((entry) => entry.avatar !== null);
      if (!pictured) throw new Error("the sample should have someone with a picture");
      const theirs = (await findings(request, `?person=${pictured.value}&page_size=1`)).items[0];
      const demo1 = await api<{ issue: { assignee: Person | null } }>(request, "issues/DEMO-1/timeline");
      expect(demo1.issue.assignee?.avatar, "DEMO-1's assignee has no picture in the sample").toBeNull();

      for (const [key, person] of [
        ["DEMO-1", demo1.issue.assignee],
        [theirs.issue_key, personOf(pictured)],
      ] as const) {
        await page.goto(`/issues/${key}`);
        if (!person) throw new Error(`${key} should have an assignee`);
        const link = page.getByRole("link", { name: `${person.name}: show their open findings` });
        await expectAvatar(link.locator(".jo-avatar"), person);
        await expect(page.locator("[data-assignee]")).toHaveText(new RegExp(`^Assignee\\s*${person.name}$`));
        expect(await axeBlocking(page)).toEqual([]);
      }

      await page.goto(`/issues/${UNASSIGNED_ISSUE}`);
      await expectAvatar(page.locator("[data-assignee] .jo-avatar"), null);
      await expect(page.locator("[data-assignee]")).toHaveText("Unassigned");
      expect(await axeBlocking(page)).toEqual([]);
      expect(problems).toEqual([]);
    });
  }

  test("two wide initials clear the round's edge at both sizes, where it is narrowest across their capitals", async ({ page }) => {
    await page.goto("/");
    await expect(peopleRows(page).first()).toBeVisible();
    const fits = await page.evaluate(() => {
      const results: { size: number; letters: string; width: number; chord: number }[] = [];
      for (const [size, box] of [
        [20, "size-5"],
        [24, "size-6"],
      ] as const) {
        for (const letters of ["MW", "WM", "WW", "MM", "AB"]) {
          const avatar = document.createElement("span");
          avatar.className = `jo-avatar ${box}`;
          avatar.dataset.size = String(size);
          avatar.dataset.initials = letters;
          document.body.append(avatar);
          const drawn = getComputedStyle(avatar, "::before");
          // The letters as the stylesheet sets them, on a line of their own, to be measured.
          const probe = document.createElement("span");
          probe.textContent = letters;
          Object.assign(probe.style, {
            position: "absolute",
            whiteSpace: "nowrap",
            fontFamily: drawn.fontFamily,
            fontSize: drawn.fontSize,
            fontWeight: drawn.fontWeight,
            letterSpacing: drawn.letterSpacing,
          });
          document.body.append(probe);
          const fontSize = parseFloat(drawn.fontSize);
          const width = probe.getBoundingClientRect().width - (parseFloat(drawn.letterSpacing) || 0);
          const radius = avatar.getBoundingClientRect().width / 2;
          // Inter's capitals are 0.727 em tall, centred in the round: its chord at their top and foot.
          const half = (0.727 * fontSize) / 2;
          results.push({ size, letters, width, chord: 2 * Math.sqrt(radius * radius - half * half) });
          probe.remove();
          avatar.remove();
        }
      }
      return results;
    });
    for (const { size, letters, width, chord } of fits) {
      expect(width, `${letters} in the ${size} px round`).toBeLessThanOrEqual(chord - 1);
    }
  });

  test("the ticket page's assignee: on hover only the name is underlined, never the avatar's initials", async ({ page, request }) => {
    const demo1 = await api<{ issue: { assignee: Person | null } }>(request, "issues/DEMO-1/timeline");
    const person = demo1.issue.assignee!;
    expect(person.avatar, "DEMO-1's assignee shows initials in the sample").toBeNull();
    await page.goto("/issues/DEMO-1");
    const link = page.getByRole("link", { name: `${person.name}: show their open findings` });
    await link.hover();
    const decoration = await link.evaluate((element) => ({
      // A decoration set on the link would run on through every descendant's text, the initials included.
      link: getComputedStyle(element).textDecorationLine,
      name: getComputedStyle(element.querySelector("[data-assignee-name]")!).textDecorationLine,
    }));
    expect(decoration).toEqual({ link: "none", name: "underline" });
  });

  test("a picture that fails to load gives way to the person's initials", async ({ page, request }) => {
    const rows = (await api<{ people: { person: Person | null }[] }>(request, "people")).people;
    const index = rows.findIndex((row) => row.person?.avatar);
    const person = rows[index].person!;
    await page.route(PICTURES, (route) => route.fulfill({ status: 404, json: { error: "not_found", message: "No picture." } }));
    await page.goto("/");
    const avatar = peopleRows(page).nth(index).locator(".jo-avatar");
    await expect(avatar).toHaveAttribute("data-avatar", "initials");
    await expectAvatar(avatar, { ...person, avatar: null });
  });

  test("the picture route serves the bytes the version names, privately cached and sandboxed; no picture is a 404", async ({
    request,
  }) => {
    const people = (await api<{ people: { person: Person | null }[] }>(request, "people")).people.flatMap((row) => (row.person ? [row.person] : []));
    const pictured = people.filter((person) => person.avatar !== null);
    expect(pictured).toHaveLength(2);
    for (const person of pictured) {
      const response = await request.get(`/api/oversight/people/${person.id}/avatar?v=${person.avatar}`);
      expect(response.status()).toBe(200);
      const headers = response.headers();
      expect(headers["content-type"]).toBe("image/png");
      expect(headers["cache-control"]).toBe("private, max-age=86400");
      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(headers["content-security-policy"]).toBe("default-src 'none'; sandbox");
      const body = await response.body();
      expect([...body.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      // The version is the first 12 hex characters of sha256 of the bytes.
      expect(createHash("sha256").update(body).digest("hex").slice(0, 12)).toBe(person.avatar);
    }
    const plain = people.find((person) => person.avatar === null)!;
    const missing = await request.get(`/api/oversight/people/${plain.id}/avatar`);
    expect(missing.status()).toBe(404);
    expect(missing.headers()["cache-control"]).toBe("no-store");
    expect((await missing.json()).error).toBe("not_found");
    expect((await request.get(`/api/oversight/people/${pictured[0].id}/avatar?v=nope`)).status()).toBe(400);
    expect((await request.get(`/api/oversight/people/acc-03/avatar`)).status()).toBe(404);
  });
});

test.describe("pictures on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("keep their size and place in each place, with no sideways scrolling and axe clean", async ({ page, request }) => {
    const rows = (await api<{ people: { person: Person | null }[] }>(request, "people")).people;
    await page.goto("/");
    await expect(peopleRows(page)).toHaveCount(rows.length);
    for (const [index, row] of rows.entries()) {
      const shown = await expectAvatar(peopleRows(page).nth(index).locator(".jo-avatar"), row.person);
      expect(shown.right).toBeLessThanOrEqual(390);
    }
    expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
    expect(await axeBlocking(page)).toEqual([]);

    const first = await findings(request, "?state=open");
    await page.goto("/findings?state=open&menu=person");
    const menu = page.getByRole("listbox", { name: "Person" });
    const options = menu.getByRole("option");
    await expect(options).toHaveCount(first.facets.people.length);
    for (const [index, entry] of first.facets.people.entries()) {
      const shown = await expectAvatar(options.nth(index).locator(".jo-avatar"), personOf(entry));
      expect(shown.right).toBeLessThanOrEqual(390);
    }
    expect(await axeBlocking(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await listReady(page);
    // On a phone the findings are a list (SQA), each with who has it.
    const items = page.getByRole("list", { name: "Findings" }).getByRole("listitem");
    const row = first.items.findIndex((item) => item.assignee !== null);
    await expectAvatar(items.nth(row).locator("[data-assignee] .jo-avatar"), first.items[row].assignee);
    expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);

    const pictured = first.facets.people.find((entry) => entry.avatar !== null)!;
    const theirs = (await findings(request, `?person=${pictured.value}&page_size=1`)).items[0];
    await page.goto(`/issues/${theirs.issue_key}`);
    const shown = await expectAvatar(page.locator("[data-assignee] .jo-avatar"), personOf(pictured));
    expect(shown.right).toBeLessThanOrEqual(390);
    expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
    expect(await axeBlocking(page)).toEqual([]);
  });
});
