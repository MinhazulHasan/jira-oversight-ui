import { render } from "@testing-library/react";
import { Tooltip } from "radix-ui";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ projects: {} as Record<string, unknown>, health: {} as Record<string, unknown> }));

vi.mock("@/lib/api/hooks", () => ({
  useProjects: () => hooks.projects,
  useHealth: () => hooks.health,
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import { ApiError } from "@/lib/api/client";
import { BOARD_COOKIE } from "@/lib/board";

import { BoardSwitcher, boardRepair } from "../board-switcher";

/* The board switcher repairs a board the dashboard cannot show. */

const BOARDS = {
  default: "BRAVO",
  projects: [
    { key: "ALPHA", name: "Alpha", issues: 120, last_synced_at: "2026-11-10T10:00:00Z" },
    { key: "BRAVO", name: "Bravo", issues: 640, last_synced_at: "2026-11-10T10:00:00Z" },
  ],
};

const wrap = (ui: ReactNode) => <Tooltip.Provider>{ui}</Tooltip.Provider>;
const boardCookie = () => document.cookie.split("; ").find((part) => part.startsWith(`${BOARD_COOKIE}=`)) ?? null;

let reload: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  reload = vi.spyOn(boardRepair, "reload").mockImplementation(() => undefined);
  window.sessionStorage.clear();
  document.cookie = `${BOARD_COOKIE}=; path=/; max-age=0`;
  hooks.projects = { data: BOARDS, isError: false };
  hooks.health = { data: { projects: ["BRAVO"] }, error: null };
});

afterEach(() => {
  reload.mockRestore();
});

describe("the board switcher's repairs", () => {
  it("forgets a pick the board list does not hold, and reloads once", () => {
    document.cookie = `${BOARD_COOKIE}=CHARLIE; path=/`;
    hooks.health = { data: undefined, error: new ApiError(403, "board_not_allowed", "Not yours.") };
    const { unmount } = render(wrap(<BoardSwitcher />));
    expect(boardCookie()).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);

    // The cookie comes back (another tab, a cookie on a parent domain): no second reload within the minute.
    document.cookie = `${BOARD_COOKIE}=CHARLIE; path=/`;
    unmount();
    render(wrap(<BoardSwitcher />));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("with no pick, picks the listed default when the board read by default is no longer served", () => {
    hooks.health = { data: undefined, error: new ApiError(404, "unknown_board", "Not served.") };
    render(wrap(<BoardSwitcher />));
    expect(boardCookie()).toBe(`${BOARD_COOKIE}=BRAVO`);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("leaves a served board alone", () => {
    render(wrap(<BoardSwitcher />));
    document.cookie = `${BOARD_COOKIE}=ALPHA; path=/`;
    render(wrap(<BoardSwitcher />));
    expect(reload).not.toHaveBeenCalled();
  });
});
