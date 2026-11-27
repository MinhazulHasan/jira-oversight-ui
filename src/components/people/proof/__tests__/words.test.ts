import { describe, expect, it } from "vitest";

import { detailWords } from "../model";

describe("a stuck ticket's detail", () => {
  it("keeps the time whole and leaves the status to the row's chip", () => {
    const ticket = { counted: true, detail: { status: "DISCUSSION REQUIRED", hours: 1522 * 24, threshold: null } };
    expect(detailWords("stuck_now", ticket as never, "en-GB")?.main).toMatch(/^For 1,522 days/);
  });
});
