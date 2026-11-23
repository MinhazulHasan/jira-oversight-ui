import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { askResponseSchema } from "@/lib/api/schemas";

import answeredJson from "../../../../docs/sample-responses/ask-answered.json";
import noDataJson from "../../../../docs/sample-responses/ask-no-data.json";
import { forgetAll, FRESH_MS, freshAnswer, HISTORY_KEY, HISTORY_LIMIT, readHistory, remember, resetHistoryCache } from "../history";

const answered = askResponseSchema.parse(answeredJson);
const noData = askResponseSchema.parse(noDataJson);

beforeEach(() => {
  window.sessionStorage.clear();
  resetHistoryCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("this tab's questions", () => {
  it("are kept newest first, in sessionStorage, and read back through the contract", () => {
    remember(answered, 1_000);
    remember(noData, 2_000);
    expect(readHistory().map((entry) => entry.response.question)).toEqual([noData.question, answered.question]);

    resetHistoryCache();
    expect(readHistory().map((entry) => entry.response.qa_id)).toEqual([noData.qa_id, answered.qa_id]);
    expect(JSON.parse(window.sessionStorage.getItem(HISTORY_KEY) ?? "[]")).toHaveLength(2);
  });

  it("list a question once, with its newest answer", () => {
    remember(answered, 1_000);
    remember({ ...answered, question: "  which EPICS have the most open breaches? ", qa_id: "f".repeat(32) }, 2_000);
    expect(readHistory()).toHaveLength(1);
    expect(readHistory()[0].response.qa_id).toBe("f".repeat(32));
  });

  it(`stop at ${HISTORY_LIMIT}`, () => {
    for (let index = 0; index < HISTORY_LIMIT + 5; index += 1) remember({ ...answered, question: `Question ${index}` }, index);
    expect(readHistory()).toHaveLength(HISTORY_LIMIT);
    expect(readHistory()[0].response.question).toBe(`Question ${HISTORY_LIMIT + 4}`);
  });

  it("drop anything stored that the contract does not accept", () => {
    window.sessionStorage.setItem(
      HISTORY_KEY,
      JSON.stringify([{ response: answered, keptAt: 1 }, { response: { question: "forged" }, keptAt: 2 }, "junk"]),
    );
    expect(readHistory().map((entry) => entry.response.qa_id)).toEqual([answered.qa_id]);
    window.sessionStorage.setItem(HISTORY_KEY, "{not json");
    resetHistoryCache();
    expect(readHistory()).toEqual([]);
  });

  it("still work in memory when storage refuses", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
    remember(answered, 1_000);
    expect(readHistory()).toHaveLength(1);
    forgetAll();
    expect(readHistory()).toHaveLength(0);
  });

  it("offer an answer again only within the half hour Jira takes to sync", () => {
    remember(answered, 10_000);
    expect(freshAnswer("which epics have the most open breaches?", 10_000 + FRESH_MS - 1)?.qa_id).toBe(answered.qa_id);
    expect(freshAnswer(answered.question, 10_000 + FRESH_MS)).toBeNull();
    expect(freshAnswer("Something never asked", 10_000)).toBeNull();
  });
});
