// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";

import { countsFor, stepOneField, type CreditTicket } from "../sample/credit";
import { resetSampleCredit } from "../sample/credit-store";

const ADA = "p000000000a0a";
const BEN = "p000000000b0b";
const CAL = "p000000000c0c";
const DEE = "p000000000d0d";

const AUTOMATIC = { source: "auto", field: null } as const;
const ASSIGNEE = { source: "assignee", field: null } as const;
const TESTERS = { source: "field", field: "testers" } as const;
const CHOICES = { Automatic: AUTOMATIC, Assignee: ASSIGNEE, Testers: TESTERS } as const;

function ticket(overrides: Partial<CreditTicket>): CreditTicket {
  return { assignee: null, fields: {}, ...overrides };
}

const credited = (subject: CreditTicket, choice: (typeof CHOICES)[keyof typeof CHOICES]) =>
  countsFor(subject, choice).map(({ personId, basis, field }) => [personId, basis, field]);

afterEach(() => resetSampleCredit());

describe("the field each choice reads first", () => {
  it("Automatic reads Programmer, Assignee none, a chosen field that field, a field the site lacks none", () => {
    expect(stepOneField(AUTOMATIC)).toEqual({ key: "programmer", name: "Programmer" });
    expect(stepOneField(ASSIGNEE)).toBeNull();
    expect(stepOneField(TESTERS)).toEqual({ key: "testers", name: "Testers" });
    expect(stepOneField({ source: "field", field: "reporters" })).toBeNull();
    expect(stepOneField(AUTOMATIC, [{ key: "testers", name: "Testers" }])).toBeNull();
  });
});

describe("the credit rule, under each choice", () => {
  const cases: { name: string; ticket: CreditTicket; expected: Record<keyof typeof CHOICES, unknown[][]> }[] = [
    {
      name: "one Programmer",
      ticket: ticket({ assignee: BEN, fields: { programmer: [ADA] } }),
      expected: { Automatic: [[ADA, "field", "Programmer"]], Assignee: [[BEN, "assignee_now", null]], Testers: [] },
    },
    {
      name: "several Programmers, each once",
      ticket: ticket({ assignee: BEN, fields: { programmer: [ADA, CAL, ADA] } }),
      expected: {
        Automatic: [
          [ADA, "field", "Programmer"],
          [CAL, "field", "Programmer"],
        ],
        Assignee: [[BEN, "assignee_now", null]],
        Testers: [],
      },
    },
    {
      name: "Programmer removed (empty now): Automatic counts the assignee",
      ticket: ticket({ assignee: BEN, fields: { programmer: [] } }),
      expected: { Automatic: [[BEN, "assignee_now", null]], Assignee: [[BEN, "assignee_now", null]], Testers: [] },
    },
    {
      name: "an assignee and no field filled",
      ticket: ticket({ assignee: ADA }),
      expected: { Automatic: [[ADA, "assignee_now", null]], Assignee: [[ADA, "assignee_now", null]], Testers: [] },
    },
    {
      name: "a chosen field: Testers",
      ticket: ticket({ assignee: ADA, fields: { programmer: [BEN], testers: [DEE] } }),
      expected: { Automatic: [[BEN, "field", "Programmer"]], Assignee: [[ADA, "assignee_now", null]], Testers: [[DEE, "field", "Testers"]] },
    },
    {
      name: "a Programmer and no one assigned now",
      ticket: ticket({ fields: { programmer: [CAL] } }),
      expected: { Automatic: [[CAL, "field", "Programmer"]], Assignee: [], Testers: [] },
    },
    {
      name: "no assignee and no field: no one",
      ticket: ticket({}),
      expected: { Automatic: [], Assignee: [], Testers: [] },
    },
  ];

  for (const { name, ticket: subject, expected } of cases) {
    for (const [label, choice] of Object.entries(CHOICES) as [keyof typeof CHOICES, (typeof CHOICES)[keyof typeof CHOICES]][]) {
      it(`${name} (${label})`, () => {
        expect(credited(subject, choice)).toEqual(expected[label]);
      });
    }
  }

  it("a field the site lacks counts for no one, and Automatic falls to the assignee", () => {
    const subject = ticket({ assignee: BEN, fields: { programmer: [ADA] } });
    expect(countsFor(subject, { source: "field", field: "reporters" })).toEqual([]);
    expect(countsFor(subject, AUTOMATIC, [{ key: "testers", name: "Testers" }])).toEqual([{ personId: BEN, basis: "assignee_now", field: null }]);
  });
});
