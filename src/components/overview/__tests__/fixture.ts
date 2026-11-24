import sample from "../../../../docs/sample-responses/overview.json";
import peopleSample from "../../../../docs/sample-responses/people.json";

import { overviewSchema, peopleSchema, type Overview, type People } from "@/lib/api/schemas";

export function overviewFixture(change?: (draft: Overview) => void): Overview {
  const data = overviewSchema.parse(structuredClone(sample));
  change?.(data);
  return data;
}

export function peopleFixture(change?: (draft: People) => void): People {
  const data = peopleSchema.parse(structuredClone(peopleSample));
  change?.(data);
  return peopleSchema.parse(data);
}
