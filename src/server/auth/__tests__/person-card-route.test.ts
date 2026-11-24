// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET } from "@/app/api/oversight/[...path]/route";
import { apiErrorBodySchema, personCardSchema, SCORECARD_DAYS, type PersonCard } from "@/lib/api/schemas";

import { cardForBoards } from "../../boards";
import { resetSampleClock } from "../../sample/clock";
import { sampleBoard } from "../../sample/boards";
import { buildDataset, CATALOGUE_SETTINGS } from "../../sample/dataset";
import { peopleView } from "../../sample/people";
import { personCardView, SAMPLE_OTHER_BOARDS } from "../../sample/person-card";
import { scorecards } from "../../sample/scorecard";
import { EVERYONE, MEMBERS, personIdFor, TEAM } from "../../sample/team";
import { sealSession } from "../cookies";
import { emailHash } from "../roles";

import { SECRET, SESSION_KEYS, stubAuthEnv } from "./fixtures";

const NOW = "2026-11-04T14:30:00Z";
const ADA = personIdFor("acc-01");
const DEV = personIdFor("acc-04");
const NOOR = personIdFor(MEMBERS[0].accountId);
const IDENTITY = { sub: "557058:account", dom: "stellainternational.com", site: "cloud-id", eh: "hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh", boards: ["DEMO"] };
const LEAD = "lead@stellainternational.com";

function call(path: string, cookie?: string) {
  const url = new URL(`http://localhost:3400/api/oversight/${path}`);
  const request = new NextRequest(url, { headers: cookie ? { cookie } : {} });
  return GET(request, { params: Promise.resolve({ path: url.pathname.replace(/^\/api\/oversight\//, "").split("/") }) });
}

async function expectProblem(response: Response, status: number, error: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = apiErrorBodySchema.parse(await response.json());
  expect(body.error).toBe(error);
  return body;
}

async function read(response: Response): Promise<PersonCard> {
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body: unknown = await response.json();
  const parsed = personCardSchema.parse(body);
  expect(parsed).toStrictEqual(body);
  return parsed;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetSampleClock();
});

describe("the person card in sample mode, sign-in off (people level)", () => {
  beforeEach(() => {
    for (const [name, value] of Object.entries({ OVERSIGHT_DATA: "sample", SAMPLE_NOW: NOW, SAMPLE_LATENCY: "0", AUTH_MODE: "off" })) vi.stubEnv(name, value);
  });

  it("answers for someone who holds tickets: their work, findings, process, what they work on, and the other boards", async () => {
    const card = await read(await call(`people/${ADA}/card`));
    expect(card.person).toEqual({ id: ADA, name: "Ada Brooks", avatar: null });
    expect(card.board).toEqual({ key: "DEMO", name: "Demo project" });
    expect(card.membership).toBe("holds_tickets");
    expect(card.work.days).toBe(90);
    expect(card.in_progress_now).toHaveLength(3);
    expect(card.in_progress_now.length + card.in_progress_more).toBe(card.work.in_progress);
    // The sample's other synced board first, counted from its own scorecard, then the made-up boards it does not serve.
    const mob = buildDataset(Date.parse(NOW), CATALOGUE_SETTINGS, sampleBoard("MOB")!);
    const onMob = scorecards(mob, 90).byId.get(ADA)!.values.open_tickets.value;
    expect(onMob).toBeGreaterThan(0);
    expect(card.other_boards).toEqual([{ key: "MOB", name: "Mobile app", open_tickets: onMob }, ...SAMPLE_OTHER_BOARDS["acc-01"]]);
    expect(card.last_activity_at).not.toBeNull();
  });

  it("reads a card on the sample's other board, naming DEMO among the other boards (JO-17)", async () => {
    const card = await read(await call(`people/${ADA}/card?board=MOB`));
    expect(card.board).toEqual({ key: "MOB", name: "Mobile app" });
    expect(card.other_boards[0]).toMatchObject({ key: "DEMO", name: "Demo project" });
    // HELP has never synced: nothing to read a card from.
    await expectProblem(await call(`people/${ADA}/card?board=HELP`), 409, "board_not_synced");
    await expectProblem(await call(`people/${ADA}/card?board=NOPE`), 404, "unknown_board");
  });

  it("answers for a member who holds none of the board's tickets: nothing to count or compare", async () => {
    const card = await read(await call(`people/${NOOR}/card?days=30`));
    expect(card.membership).toBe("member_no_tickets");
    expect(card.work).toEqual({ open_tickets: 0, in_progress: 0, done_in_period: 0, days: 30 });
    expect(card.findings).toEqual({ open_breaches: 0, open_warnings: 0 });
    expect([card.process, card.in_progress_now, card.in_progress_more, card.last_activity_at]).toEqual([null, [], 0, null]);
  });

  it("refuses what the contract refuses, before anything is computed", async () => {
    await expectProblem(await call("people/ada/card"), 404, "not_found");
    await expectProblem(await call("people/P0123456789AB/card"), 404, "not_found");
    await expectProblem(await call("people/p000000000000/card"), 404, "not_found");
    await expectProblem(await call(`people/${ADA}/card?days=45`), 400, "bad_request");
    await expectProblem(await call(`people/${ADA}/card?days=90&days=30`), 400, "bad_request");
    await expectProblem(await call(`people/${ADA}/card?project=DEMO`), 400, "bad_request");
    await expectProblem(await call(`people/${ADA}/card?level=people`), 400, "bad_request");
    await expectProblem(await call(`people/${ADA}/card?board=demo-1`), 400, "bad_request");
    await expectProblem(await call(`people/${ADA}/card?board=DEMO&board=OPS`), 400, "bad_request");
    // A board the page names is read like the top bar's pick: the sample's is DEMO.
    expect((await read(await call(`people/${ADA}/card?board=DEMO`))).board.key).toBe("DEMO");
  });

  it("gives every figure the scorecard and GET /people give, for everyone on the board, over every period", async () => {
    const dataset = buildDataset(Date.parse(NOW));
    const people = peopleView(dataset).people;
    expect(EVERYONE).toHaveLength(11);
    for (const days of SCORECARD_DAYS) {
      const set = scorecards(dataset, days);
      for (const member of EVERYONE) {
        const id = personIdFor(member.accountId);
        const answer = personCardView(dataset, id, days);
        if (!answer.found) throw new Error(`${member.name} has no card`);
        const card = personCardSchema.parse(answer.body);
        const row = set.byId.get(id)!;
        const summary = people.find((entry) => entry.person?.id === id);
        expect(card.work, `${member.name}, ${days} days`).toEqual({
          open_tickets: row.values.open_tickets.value ?? 0,
          in_progress: row.values.in_progress.value ?? 0,
          done_in_period: row.values.done_in_period.value ?? 0,
          days,
        });
        // GET /people's open tickets: one meaning everywhere.
        expect(card.work.open_tickets).toBe(summary?.open_tickets ?? 0);
        expect(card.findings).toEqual({ open_breaches: summary?.open_breaches ?? 0, open_warnings: summary?.open_warnings ?? 0 });
        expect(card.membership).toBe(row.tickets > 0 ? "holds_tickets" : "member_no_tickets");
        // The scorecard's marks, counted over the measures that compare.
        const marks = set.measures
          .filter((measure) => measure.measurable && measure.kind !== "count")
          .map((measure) => row.values[measure.key].vs_board ?? "too_few");
        const count = (mark: string) => marks.filter((each) => each === mark).length;
        const compared = count("closer") + count("level") + count("further");
        expect(card.process).toEqual(
          compared === 0 ? null : { closer: count("closer"), level: count("level"), further: count("further"), too_few: count("too_few"), measurable: marks.length },
        );
      }
    }
    // The states the card shows are all here: many in progress, a member with none, other boards, a picture and none.
    const cards = EVERYONE.map((member) => personCardView(dataset, personIdFor(member.accountId), 90)).flatMap((answer) => (answer.found ? [answer.body] : []));
    expect(cards.some((card) => card.in_progress_more > 0)).toBe(true);
    expect(cards.some((card) => card.membership === "member_no_tickets" && card.other_boards.length > 0)).toBe(true);
    expect(cards.some((card) => card.person.avatar !== null) && cards.some((card) => card.person.avatar === null)).toBe(true);
    expect(cards.filter((card) => card.process === null).every((card) => card.membership === "member_no_tickets")).toBe(true);
    expect(TEAM.every((member) => cards.some((card) => card.person.name === member.name && card.membership === "holds_tickets"))).toBe(true);
  });

  it("lists what they work on longest in progress first, and nothing that is not theirs or not in progress", async () => {
    const card = await read(await call(`people/${DEV}/card`));
    expect(card.work.in_progress).toBeGreaterThan(3);
    const since = card.in_progress_now.map((ticket) => Date.parse(ticket.since ?? ""));
    expect(since).toEqual([...since].sort((a, b) => a - b));
    expect(card.in_progress_now.every((ticket) => ticket.status === "In Progress" && ticket.key.startsWith("DEMO-"))).toBe(true);
  });
});

describe("the person card with sign-in on", () => {
  beforeEach(() => {
    stubAuthEnv({ OVERSIGHT_DATA: "sample", SAMPLE_NOW: NOW, SAMPLE_LATENCY: "0" });
  });

  it("is never served to a reader at team level (users get no card), and asks nothing of anyone", async () => {
    const upstream = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", upstream);
    const session = await sealSession(IDENTITY, SESSION_KEYS);
    const refused = await expectProblem(await call(`people/${ADA}/card`, `jo-session=${session}`), 403, "people_not_allowed");
    expect(refused.message).toBe("Only admins can see person cards.");
    await expectProblem(await call(`people/${ADA}/card`), 401, "unauthenticated");
    vi.stubEnv("OVERSIGHT_DATA", "live");
    vi.stubEnv("OVERSIGHT_API_URL", "http://oversight.internal:3300");
    vi.stubEnv("OVERSIGHT_SERVICE_KEY", "svc-key");
    await expectProblem(await call(`people/${ADA}/card`, `jo-session=${session}`), 403, "people_not_allowed");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("is served to an admin, a board the page names held to the reader's boards as a pick is", async () => {
    vi.stubEnv("ADMIN_EMAILS", LEAD);
    const admin = await sealSession({ ...IDENTITY, eh: emailHash(LEAD, SECRET) }, SESSION_KEYS);
    expect((await read(await call(`people/${ADA}/card`, `jo-session=${admin}`))).person.id).toBe(ADA);
    // A user is refused a board not theirs before the level is even asked: the board rule comes first.
    const user = await sealSession(IDENTITY, SESSION_KEYS);
    await expectProblem(await call(`people/${ADA}/card?board=OPS`, `jo-session=${user}`), 403, "board_not_allowed");
  });
});

describe("the other boards a card names", () => {
  const dataset = buildDataset(Date.parse(NOW));
  const answer = personCardView(dataset, ADA, 90);
  if (!answer.found) throw new Error("Ada Brooks has no card");
  const card = answer.body;

  it("are every one for an admin, or with sign-in off; only theirs for anyone who reads some boards", () => {
    expect(cardForBoards(card, null)).toBe(card);
    expect(cardForBoards(card, ["DEMO", "WEB"]).other_boards.map((board) => board.key)).toEqual(["WEB"]);
    expect(cardForBoards(card, ["DEMO"]).other_boards).toEqual([]);
    // Nothing else of the card changes.
    expect({ ...cardForBoards(card, ["DEMO"]), other_boards: card.other_boards }).toEqual(card);
  });
});

describe("the person card in live mode", () => {
  const dataset = buildDataset(Date.parse(NOW));
  /** The service's body for a person, as the sample computes it, labelled live on a made-up board. */
  const serviceBody = (person: string, days: 30 | 90 | 180 = 90, board = "ALPHA") => {
    const answer = personCardView(dataset, person, days);
    if (!answer.found) throw new Error(answer.message);
    const other = board === "BETA" ? { key: "ALPHA", name: "Alpha", open_tickets: 5 } : { key: "BETA", name: "Beta", open_tickets: 2 };
    return { ...answer.body, meta: { ...answer.body.meta, data_mode: "live", projects: [board] }, board: { key: board, name: board }, other_boards: [other] };
  };

  function liveService(answer: (url: URL) => Response) {
    for (const [name, value] of Object.entries({ OVERSIGHT_DATA: "live", OVERSIGHT_API_URL: "http://oversight.internal:3300", OVERSIGHT_SERVICE_KEY: "svc-key", AUTH_MODE: "off" })) {
      vi.stubEnv(name, value);
    }
    const upstream = vi.fn<typeof fetch>(async (input) => answer(new URL(String(input))));
    vi.stubGlobal("fetch", upstream);
    return upstream;
  }

  it("tells the service the level this route decided, the period and the board, and passes the card on", async () => {
    const upstream = liveService(() => Response.json(serviceBody(ADA, 30)));
    const card = await read(await call(`people/${ADA}/card?days=30`, "jo-board=ALPHA"));
    expect(card.other_boards).toEqual([{ key: "BETA", name: "Beta", open_tickets: 2 }]);
    const [url] = upstream.mock.calls.map(([input]) => new URL(String(input)));
    expect(url.pathname).toBe(`/api/v1/people/${ADA}/card`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ days: "30", level: "people", project: "ALPHA" });
    const headers = new Headers(upstream.mock.calls[0][1]?.headers);
    expect(headers.get("x-service-key")).toBe("svc-key");
    // Who is reading, for the access log's person_card_view: the local reader with sign-in off.
    expect(headers.get("x-oversight-viewer")).toBe("local");
  });

  it("reads the board the page names (an access log entry's) rather than the top bar's pick, and never forwards it as itself", async () => {
    const upstream = liveService(() => Response.json(serviceBody(ADA, 90, "BETA")));
    await read(await call(`people/${ADA}/card?board=BETA`, "jo-board=ALPHA"));
    const url = new URL(String(upstream.mock.calls[0][0]));
    expect(Object.fromEntries(url.searchParams)).toEqual({ level: "people", project: "BETA" });
  });

  it("says plainly when the person is not on the board, the read could not be logged, or the service failed", async () => {
    liveService(() => Response.json({ detail: "nobody by that id is on this board" }, { status: 404 }));
    const missing = await expectProblem(await call(`people/${ADA}/card`), 404, "not_found");
    expect(missing.message).toBe("This person is not on this board.");
    liveService(() => Response.json({ detail: "the access log could not be written", code: "access_log_unavailable" }, { status: 500 }));
    await expectProblem(await call(`people/${ADA}/card`), 503, "access_log_unavailable");
    liveService(() => Response.json({ detail: { code: "people_level_only" } }, { status: 403 }));
    await expectProblem(await call(`people/${ADA}/card`), 502, "upstream_refused");
    liveService(() => Response.json({ detail: [{ loc: ["query", "days"] }] }, { status: 422 }));
    await expectProblem(await call(`people/${ADA}/card`), 502, "upstream_error");
  });

  it("tells a board the service does not serve from a person not on a board it serves, by the service's code", async () => {
    // The service's own bodies: its board check's 404 carries the code; the card route's own 404 does not.
    const notServed = () => Response.json({ detail: "that board is not one this service serves", code: "unknown_board" }, { status: 404 });
    liveService(notServed);
    // An access log entry's board, since taken off the service's list: never "not on this board".
    const named = await expectProblem(await call(`people/${ADA}/card?board=ZZZ`), 404, "unknown_board");
    expect(named.message).toBe("The board this card is read on is not one the oversight service serves.");
    // The top bar's pick, gone stale, reads the same on a card as on every other route.
    await expectProblem(await call(`people/${ADA}/card`, "jo-board=ZZZ"), 404, "unknown_board");
    const people = await expectProblem(await call("people", "jo-board=ZZZ"), 404, "unknown_board");
    expect(people.message).toBe("The board picked in the top bar is not one the oversight service serves.");
    // A route's own 404 with the board's code is the board's too: a scorecard asked for someone, a finding.
    await expectProblem(await call(`people/scorecard?person=${ADA}`, "jo-board=ZZZ"), 404, "unknown_board");
    liveService(() => Response.json({ detail: "nobody by that id is on this board" }, { status: 404 }));
    await expectProblem(await call(`people/${ADA}/card?board=BETA`), 404, "not_found");
  });

  it("refuses a card for someone else, another period, another board, or figures that contradict themselves", async () => {
    liveService(() => Response.json(serviceBody(DEV)));
    await expectProblem(await call(`people/${ADA}/card`), 502, "upstream_invalid");
    liveService(() => Response.json(serviceBody(ADA, 180)));
    await expectProblem(await call(`people/${ADA}/card`), 502, "upstream_invalid");
    liveService(() => Response.json(serviceBody(ADA, 90, "GAMMA")));
    await expectProblem(await call(`people/${ADA}/card`, "jo-board=ALPHA"), 502, "upstream_invalid");
    const broken = serviceBody(ADA);
    broken.in_progress_more += 1;
    liveService(() => Response.json(broken));
    const invalid = await expectProblem(await call(`people/${ADA}/card`), 502, "upstream_invalid");
    expect(invalid.issues?.map((issue) => issue.path)).toContain("in_progress_more");
  });

  it("drops anything the contract does not name, an email or a picture's address among them", async () => {
    const body = { ...serviceBody(ADA), person: { id: ADA, name: "Ada Brooks", avatar: null, emailAddress: "ada@example.com", avatarUrls: { "48x48": "https://x" } } };
    liveService(() => Response.json(body));
    const text = JSON.stringify(await read(await call(`people/${ADA}/card`)));
    expect(text).not.toMatch(/emailAddress|example\.com|avatarUrls/);
  });
});
