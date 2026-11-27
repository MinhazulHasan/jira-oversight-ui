// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET, PUT } from "@/app/api/oversight/[...path]/route";
import { apiErrorBodySchema, peopleCreditSchema, peopleScorecardSchema, SCORECARD_DAYS, type PeopleCredit } from "@/lib/api/schemas";

import { sampleBoard } from "../sample/boards";
import { isWork, STATUS } from "../sample/catalogue";
import { resetSampleClock } from "../sample/clock";
import { creditsOf, peopleFields } from "../sample/credit";
import { recordCreditChange, resetSampleCredit } from "../sample/credit-store";
import { creditView } from "../sample/credit-view";
import { buildDataset, CATALOGUE_SETTINGS, type Dataset } from "../sample/dataset";
import { directoryView, peopleView } from "../sample/people";
import { personCardView } from "../sample/person-card";
import { scorecards } from "../sample/scorecard";
import { personIdFor, personOf } from "../sample/team";
import { DAY } from "../sample/time";

const NOW = Date.parse("2026-11-04T14:30:00Z");
const DEMO = buildDataset(NOW);
const MOB = buildDataset(NOW, CATALOGUE_SETTINGS, sampleBoard("MOB")!);
const ELIF = personIdFor("acc-05");
const HANA = personIdFor("acc-08");

const CHOICES = {
  DEMO: [
    { source: "auto", field: null },
    { source: "assignee", field: null },
  ],
  MOB: [
    { source: "assignee", field: null },
    { source: "auto", field: null },
    { source: "field", field: "programmer" },
    { source: "field", field: "testers" },
  ],
} as const;

function choose(dataset: Dataset, choice: { source: "auto" | "assignee" | "field"; field: string | null }) {
  resetSampleCredit();
  recordCreditChange(dataset.board.key, choice, "Morgan Ellis", NOW);
}

afterEach(() => {
  resetSampleCredit();
  vi.unstubAllEnvs();
  resetSampleClock();
});

describe("on DEMO the credit rule gives today's figures: no Programmer is filled and every assignee is kept", () => {
  for (const choice of CHOICES.DEMO) {
    it(`${choice.source}: every person's tickets and figures are those of the tickets assigned to them now`, () => {
      choose(DEMO, choice);
      const credits = creditsOf(DEMO);
      for (const issue of DEMO.world.issues.filter(isWork)) {
        const holder = personOf(issue)?.id ?? null;
        expect(credits.get(issue.key)).toEqual(holder ? [{ personId: holder, basis: "assignee_now", field: null }] : []);
      }
      for (const days of SCORECARD_DAYS) {
        const set = scorecards(DEMO, days);
        for (const row of set.withTickets) {
          const theirs = DEMO.world.issues.filter((issue) => isWork(issue) && personOf(issue)?.id === row.person.id);
          const from = DEMO.world.syncAt - days * DAY;
          expect(row.tickets).toBe(theirs.length);
          expect(row.values.done_in_period.value).toBe(theirs.filter((issue) => issue.doneAt !== null && issue.doneAt >= from && issue.doneAt <= DEMO.world.syncAt).length);
          expect(row.values.open_tickets.value).toBe(theirs.filter((issue) => STATUS[issue.status].category !== "done").length);
        }
      }
    });
  }

  it("offers Automatic and Assignee alone, Automatic reading a Programmer filled on none of the finished work", () => {
    const view = creditView(DEMO, 90);
    expect(view.setting).toEqual({ source: "auto", field: null, revision: 0, changed_by: null, changed_at: null });
    expect(view.effective_field).toEqual({ key: "programmer", name: "Programmer" });
    expect(view.options.map((option) => option.source)).toEqual(["auto", "assignee"]);
    expect(view.options[0].source_filled).toBe(0);
    expect(view.options[0].credited).toBe(view.options[1].credited);
    expect(view).not.toHaveProperty("history");
  });
});

describe("the sample's people counts agree across the scorecard, GET /people, the directory and the person card", () => {
  for (const [dataset, choices] of [
    [DEMO, CHOICES.DEMO],
    [MOB, CHOICES.MOB],
  ] as const) {
    for (const choice of choices) {
      it(`${dataset.board.key}, ${choice.source}${choice.field ? ` (${choice.field})` : ""}`, () => {
        choose(dataset, choice);
        const people = new Map(peopleView(dataset).people.flatMap((row) => (row.person ? [[row.person.id, row] as const] : [])));
        const directory = new Map(directoryView(dataset).people.map((entry) => [entry.person.id, entry.tickets]));
        for (const days of SCORECARD_DAYS) {
          const set = scorecards(dataset, days);
          // GET /people also lists anyone holding an open finding on a ticket assigned to them, with no tickets of their own.
          const counted = [...people.values()].filter((row) => row.tickets > 0).map((row) => row.person!.id);
          expect(set.withTickets.map((row) => row.person.id).sort()).toEqual(counted.sort());
          for (const row of set.byId.values()) {
            const id = row.person.id;
            expect(directory.get(id), row.person.name).toBe(row.tickets);
            expect(people.get(id)?.tickets ?? 0, row.person.name).toBe(row.tickets);
            expect(people.get(id)?.open_tickets ?? 0, row.person.name).toBe(row.values.open_tickets.value ?? 0);
            const card = personCardView(dataset, id, days);
            if (!card.found) throw new Error(card.message);
            expect(card.body.membership).toBe(row.tickets > 0 ? "holds_tickets" : "member_no_tickets");
            expect(card.body.work).toEqual({
              open_tickets: row.values.open_tickets.value ?? 0,
              in_progress: row.values.in_progress.value ?? 0,
              done_in_period: row.values.done_in_period.value ?? 0,
              days,
            });
          }
        }
      });
    }
  }
});

describe("MOB fills Programmer and Testers: its coverage, counted by hand, and its figures under each choice", () => {
  const from = MOB.world.syncAt - 90 * DAY;
  const finished = MOB.world.issues.filter((issue) => isWork(issue) && issue.doneAt !== null && issue.doneAt >= from && issue.doneAt <= MOB.world.syncAt);
  const fields = peopleFields(MOB.world);
  const filled = (key: string) => finished.filter((issue) => (fields.get(issue.key)?.[key] ?? []).length > 0).length;

  it("starts at Assignee, its file's choice, and offers both fields by name after Automatic and Assignee", () => {
    const view = creditView(MOB, 90);
    expect(view.setting.source).toBe("assignee");
    expect(view.effective_field).toBeNull();
    expect(view.finished).toBe(finished.length);
    const assigned = finished.filter((issue) => issue.assigneeAccountId !== null).length;
    const programmerOrAssignee = finished.filter((issue) => (fields.get(issue.key)?.programmer ?? []).length > 0 || issue.assigneeAccountId !== null).length;
    expect(view.options).toEqual([
      { source: "auto", field: null, source_filled: filled("programmer"), credited: programmerOrAssignee },
      { source: "assignee", field: null, source_filled: assigned, credited: assigned },
      { source: "field", field: { key: "programmer", name: "Programmer" }, source_filled: filled("programmer"), credited: filled("programmer") },
      { source: "field", field: { key: "testers", name: "Testers" }, source_filled: filled("testers"), credited: filled("testers") },
    ]);
    expect(filled("programmer")).toBeGreaterThan(0);
    expect(filled("testers")).toBeGreaterThan(0);
  });

  it("moves every figure to the testers at once under Testers, and back under Assignee", () => {
    const done = (id: string) => scorecards(MOB, 90).byId.get(id)!.values.done_in_period.value;
    const open = () => [...scorecards(MOB, 90).byId.values()].reduce((sum, row) => sum + (row.values.open_tickets.value ?? 0), 0);
    const before = { elif: done(ELIF), hana: done(HANA), open: open() };
    expect(before.open).toBeGreaterThan(0);
    choose(MOB, { source: "field", field: "testers" });
    const tested = (id: string) => finished.filter((issue) => fields.get(issue.key)?.testers?.includes(id)).length;
    expect(done(HANA)).toBe(tested(HANA));
    expect(done(HANA)).toBeGreaterThan(before.hana!);
    // Testers are named on finished work only, so no open ticket counts for anyone.
    expect(open()).toBe(0);
    choose(MOB, { source: "assignee", field: null });
    expect([done(ELIF), done(HANA), open()]).toEqual([before.elif, before.hana, before.open]);
  });
});

/* -------------------------------------------------------------- the route -- */

const SAMPLE = { OVERSIGHT_DATA: "sample", SAMPLE_NOW: "2026-11-04T14:30:00Z", SAMPLE_LATENCY: "0", AUTH_MODE: "off" };
const params = (url: URL) => ({ params: Promise.resolve({ path: url.pathname.replace(/^\/api\/oversight\//, "").split("/") }) });

function read(path: string, board?: string) {
  const url = new URL(`http://localhost:3400/api/oversight/${path}`);
  return GET(new NextRequest(url, { headers: board ? { cookie: `jo-board=${board}` } : {} }), params(url));
}

function put(body: unknown, { board, origin = "http://localhost:3400", type = "application/json", raw }: { board?: string; origin?: string | null; type?: string; raw?: string } = {}) {
  const url = new URL("http://localhost:3400/api/oversight/people/credit");
  const headers: Record<string, string> = { "content-type": type };
  if (origin !== null) headers.origin = origin;
  if (board) headers.cookie = `jo-board=${board}`;
  return PUT(new NextRequest(url, { method: "PUT", body: raw ?? JSON.stringify(body), headers }), params(url));
}

async function credit(response: Response): Promise<PeopleCredit> {
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  return peopleCreditSchema.parse(await response.json());
}

async function expectProblem(response: Response, status: number, error: string) {
  expect(response.status).toBe(status);
  const body = apiErrorBodySchema.parse(await response.json());
  expect(body.error).toBe(error);
  return body;
}

describe("GET and PUT /api/oversight/people/credit on the sample", () => {
  beforeEach(() => {
    for (const [name, value] of Object.entries(SAMPLE)) vi.stubEnv(name, value);
  });

  it("reads the board picked in the top bar, over the period asked for; anything but the period is refused", async () => {
    const mob = await credit(await read("people/credit?days=30", "MOB"));
    expect([mob.meta.projects, mob.period.days, mob.setting.source]).toEqual([["MOB"], 30, "assignee"]);
    expect((await credit(await read("people/credit"))).period.days).toBe(90);
    await expectProblem(await read("people/credit?days=7"), 400, "bad_request");
    await expectProblem(await read("people/credit?project=MOB"), 400, "bad_request");
    await expectProblem(await read("people/credit?days=30&days=90"), 400, "bad_request");
  });

  it("saves a choice as the next revision, with who and when, changes the figures at once, and goes back with another PUT", async () => {
    const start = await credit(await read("people/credit", "MOB"));
    const elif = async () =>
      peopleScorecardSchema.parse(await (await read(`people/scorecard?person=${ELIF}`, "MOB")).json()).people[0].values.done_in_period.value;
    const before = await elif();
    const saved = await credit(await put({ source: "field", field: "testers", revision: start.setting.revision }, { board: "MOB" }));
    expect(saved.setting).toMatchObject({ source: "field", field: { key: "testers", name: "Testers" }, revision: 1, changed_by: "Local (sign-in off)" });
    expect(saved.setting.changed_at).not.toBeNull();
    expect(saved.effective_field).toEqual({ key: "testers", name: "Testers" });
    expect(saved).not.toHaveProperty("history");
    expect(await elif()).not.toBe(before);

    const back = await credit(await put({ source: "assignee", field: null, revision: saved.setting.revision }, { board: "MOB" }));
    expect(back.setting).toMatchObject({ source: "assignee", field: null, revision: 2 });
    expect(await elif()).toBe(before);
    // DEMO's setting is its own.
    expect((await credit(await read("people/credit"))).setting.revision).toBe(0);
  });

  it("choosing what already stands changes nothing", async () => {
    const same = await credit(await put({ source: "auto", field: null, revision: 0 }));
    expect(same.setting.revision).toBe(0);
  });

  it("refuses a stale revision (409), a field the board does not fill or the site lacks, and a field without its source (422)", async () => {
    const stale = await expectProblem(await put({ source: "assignee", field: null, revision: 3 }), 409, "stale_revision");
    expect(stale.message).toMatch(/^Someone changed how finished work is counted/);
    const notFilled = await expectProblem(await put({ source: "field", field: "testers", revision: 0 }), 422, "credit_invalid");
    expect(notFilled.issues?.map((issue) => issue.path)).toEqual(["field"]);
    await expectProblem(await put({ source: "field", field: "reporters", revision: 0 }), 422, "credit_invalid");
    await expectProblem(await put({ source: "assignee", field: "testers", revision: 0 }), 422, "credit_invalid");
    await expectProblem(await put({ source: "field", field: null, revision: 0 }), 422, "credit_invalid");
    await expectProblem(await put({ source: "everyone", field: null, revision: 0 }), 422, "credit_invalid");
    await expectProblem(await put({ source: "auto", field: null, revision: 0, reason: "x" }), 422, "credit_invalid");
    expect((await credit(await read("people/credit"))).setting.revision).toBe(0);
  });

  it("refuses a change from anywhere but this dashboard's own pages, or not as JSON, before anything is changed", async () => {
    for (const origin of [null, "https://evil.example", "null"]) {
      const refused = await expectProblem(await put({ source: "assignee", field: null, revision: 0 }, { origin }), 403, "forbidden");
      expect(refused.message).toBe("How finished work is counted can be changed only from this dashboard's own pages, so nothing was changed.");
    }
    await expectProblem(await put({ source: "assignee", field: null, revision: 0 }, { type: "text/plain" }), 403, "forbidden");
    await expectProblem(await put(null, { raw: "{source:" }), 400, "bad_request");
    await expectProblem(await put(null, { raw: JSON.stringify({ source: "auto", pad: "x".repeat(17 * 1024) }) }), 413, "bad_request");
    expect((await credit(await read("people/credit"))).setting.revision).toBe(0);
  });

  it("takes a PUT nowhere else", async () => {
    const url = new URL("http://localhost:3400/api/oversight/rules/settings");
    const refused = await PUT(new NextRequest(url, { method: "PUT", body: "{}", headers: { origin: url.origin, "content-type": "application/json" } }), params(url));
    await expectProblem(refused, 404, "not_found");
  });
});
