// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { expectedComparison, forgetReportedComparison, noteComparison } from "../comparison";
import { readConfig } from "../env";

/** The comparison setting the People page lays itself out for while its */

afterEach(() => forgetReportedComparison());

const LIVE = { OVERSIGHT_DATA: "live", OVERSIGHT_API_URL: "http://localhost:3301", OVERSIGHT_SERVICE_KEY: "k" };

describe("the comparison setting the People page expects", () => {
  it("is the sample's setting in sample mode, whatever the service last said", () => {
    noteComparison("on");
    expect(expectedComparison(readConfig({ OVERSIGHT_DATA: "sample", SAMPLE_PEOPLE_COMPARISON: "off" }))).toBe("off");
    expect(expectedComparison(readConfig({ OVERSIGHT_DATA: "sample" }))).toBe("on");
  });

  it("in live mode, is on until the service reports, then what it last reported", () => {
    expect(expectedComparison(readConfig(LIVE))).toBe("on");
    noteComparison("off");
    expect(expectedComparison(readConfig(LIVE))).toBe("off");
    noteComparison("on");
    expect(expectedComparison(readConfig(LIVE))).toBe("on");
  });
});
