import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HISTORY_KEY } from "@/components/ask/history";

import { ForgetSessionTraces } from "../forget-session-traces";

/*
 * On the sign-in pages nobody is signed in, so what the last session left in
 * the tab goes: a session that expired, or a refused sign-in, leaves no Ask
 * answers behind for the next person.
 */

describe("the sign-in pages", () => {
  it("forget the last session's Ask questions and answers in this tab", () => {
    window.sessionStorage.setItem(HISTORY_KEY, JSON.stringify([{ question: "kept from before" }]));
    render(<ForgetSessionTraces />);
    expect(JSON.parse(window.sessionStorage.getItem(HISTORY_KEY) ?? "[]")).toEqual([]);
  });
});
