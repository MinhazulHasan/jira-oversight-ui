import sample from "../../../../docs/sample-responses/overview.json";
import peopleSample from "../../../../docs/sample-responses/people.json";

import { overviewSchema, peopleSchema, type Overview, type People } from "@/lib/api/schemas";

/**
 * The captured sample response (docs/sample-responses/overview.json), parsed
 * through the contract's schema so a drift between the two fails here first.
 * Pass a function to change a fresh copy for one test.
 */
export function overviewFixture(change?: (draft: Overview) => void): Overview {
  const data = overviewSchema.parse(structuredClone(sample));
  change?.(data);
  return data;
}

/**
 * The captured GET /people (docs/sample-responses/people.json): the eight
 * fictional people and the unassigned tickets, parsed through the contract.
 */
export function peopleFixture(change?: (draft: People) => void): People {
  const data = peopleSchema.parse(structuredClone(peopleSample));
  change?.(data);
  return peopleSchema.parse(data);
}
