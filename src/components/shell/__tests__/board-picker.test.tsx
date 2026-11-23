import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/findings" }));

import { BOARD_COOKIE } from "@/lib/board";

import { boardMatches, groupBoards } from "../board-picker";
import { BoardSwitcher, boardNavigation, requestBoardPicker } from "../board-switcher";
import { board, manyBoards, onScreen, pick, renderWithQueries, serve } from "./boards-harness";

/*
 * The board picker (JO-17): every board the service serves, which may be
 * dozens, searchable by name or key, in two groups, synced and not synced
 * yet, each synced board with its last sync; keyboard-complete; and a board
 * not synced yet can be picked, since every page offers its first sync.
 */

let assign: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  assign = vi.spyOn(boardNavigation, "assign").mockImplementation(() => undefined);
  window.sessionStorage.clear();
  pick(null);
});

afterEach(() => {
  pick(null);
});

async function openPicker() {
  const trigger = await screen.findByRole("button", { name: /^Board:/ });
  fireEvent.click(trigger);
  const dialog = await screen.findByRole("dialog", { name: "Jira boards" });
  const search = within(dialog).getByRole("combobox", { name: "Search boards" });
  await waitFor(() => expect(search).toHaveFocus());
  return { trigger, dialog, search, list: within(dialog).getByRole("listbox", { name: "Boards" }) };
}

const optionNames = (list: HTMLElement) => within(list).queryAllByRole("option").map((option) => option.getAttribute("data-board-option"));

describe("the board picker's search and groups", () => {
  it("matches every word typed against the name or the key, in any case", () => {
    const fin = board("FIN", "Finance systems");
    expect(boardMatches(fin, "")).toBe(true);
    expect(boardMatches(fin, "fin")).toBe(true);
    expect(boardMatches(fin, "SYSTEMS finance")).toBe(true);
    expect(boardMatches(fin, "fin payroll")).toBe(false);
  });

  it("puts synced boards first, then those not synced yet, each in the service's order, and leaves out an empty group", () => {
    const boards = manyBoards().projects;
    const groups = groupBoards(boards, "");
    expect(groups.map((group) => [group.label, group.boards.length])).toEqual([
      ["Synced", 26],
      ["Not synced yet", 6],
    ]);
    expect(groups[0].boards.slice(0, 2).map((each) => each.key)).toEqual(["ALPHA", "FIN"]);
    expect(groupBoards(boards, "new programme").map((group) => group.label)).toEqual(["Not synced yet"]);
    expect(groupBoards(boards, "nothing like it")).toEqual([]);
  });
});

describe("BoardSwitcher", () => {
  it("names the board on screen, and lists dozens in two labelled groups, with each synced board's last sync", async () => {
    serve({ projects: manyBoards(), refresh: {} });
    renderWithQueries(<BoardSwitcher />);
    const { list } = await openPicker();
    const synced = within(list).getByRole("group", { name: "Synced" });
    const waiting = within(list).getByRole("group", { name: "Not synced yet" });
    expect(within(synced).getAllByRole("option")).toHaveLength(26);
    expect(within(waiting).getAllByRole("option")).toHaveLength(6);
    const current = within(synced).getByRole("option", { selected: true });
    expect(current).toHaveAttribute("data-board-option", "ALPHA");
    expect(current).toHaveTextContent(/Alpha programme\s*ALPHA/);
    expect(current).toHaveTextContent(/synced .* ago/);
    // A board not synced yet says no sync time: its group says why.
    expect(within(waiting).getAllByRole("option")[0]).not.toHaveTextContent(/ago/);
  });

  it("is keyboard-complete: type to search, arrows to move, Enter to pick, and the page reloads on that board", async () => {
    serve({ projects: manyBoards(), refresh: {} });
    renderWithQueries(<BoardSwitcher />);
    const { search, list } = await openPicker();
    fireEvent.change(search, { target: { value: "programme" } });
    expect(optionNames(list)).toEqual(["ALPHA", "NEW10", "NEW11", "NEW12", "NEW13", "NEW14", "NEW15"]);
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    const active = list.querySelector("[data-active]");
    expect(active).toHaveAttribute("data-board-option", "NEW11");
    expect(search).toHaveAttribute("aria-activedescendant", active?.id);
    fireEvent.keyDown(search, { key: "Enter" });
    // A board not synced yet is picked like any other: its pages offer its first sync.
    expect(document.cookie).toContain(`${BOARD_COOKIE}=NEW11`);
    expect(assign).toHaveBeenCalledWith("/findings");
  });

  it("wraps at the ends, and jumps a page at a time", async () => {
    serve({ projects: manyBoards(), refresh: {} });
    renderWithQueries(<BoardSwitcher />);
    const { search, list } = await openPicker();
    fireEvent.keyDown(search, { key: "ArrowUp" });
    expect(list.querySelector("[data-active]")).toHaveAttribute("data-board-option", "NEW15");
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "PageDown" });
    expect(list.querySelector("[data-active]")).toHaveAttribute("data-board-option", "TEAM16");
  });

  it("says when nothing matches, clears the search with the first Escape and closes with the next", async () => {
    serve({ projects: manyBoards(), refresh: {} });
    renderWithQueries(<BoardSwitcher />);
    const { search, trigger, dialog } = await openPicker();
    fireEvent.change(search, { target: { value: "payroll" } });
    expect(within(dialog).getByText("No board matches “payroll”.")).toBeInTheDocument();
    fireEvent.keyDown(search, { key: "Escape" });
    expect(search).toHaveValue("");
    expect(screen.getByRole("dialog", { name: "Jira boards" })).toBeInTheDocument();
    fireEvent.keyDown(search, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Jira boards" })).toBeNull());
    expect(trigger).toHaveFocus();
    expect(assign).not.toHaveBeenCalled();
  });

  it("keeps the board on screen when it is picked again", async () => {
    serve({ projects: manyBoards(), refresh: {} });
    renderWithQueries(<BoardSwitcher />);
    const { list } = await openPicker();
    fireEvent.click(within(list).getByRole("option", { selected: true }));
    expect(assign).not.toHaveBeenCalled();
  });

  it("names a board not synced yet when it is the one picked", async () => {
    pick("NEW12");
    serve({ projects: manyBoards(), refresh: {} });
    renderWithQueries(<BoardSwitcher />);
    expect(await screen.findByRole("button", { name: /^Board:\s?New programme 12/ })).toHaveAttribute("data-board", "NEW12");
  });

  it("opens when the Portfolio asks for it, with the focus in its search", async () => {
    onScreen();
    serve({ projects: manyBoards(), refresh: {} });
    renderWithQueries(<BoardSwitcher />);
    await screen.findByRole("button", { name: /^Board:/ });
    act(() => requestBoardPicker());
    const dialog = await screen.findByRole("dialog", { name: "Jira boards" });
    await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "Search boards" })).toHaveFocus());
  });
});
