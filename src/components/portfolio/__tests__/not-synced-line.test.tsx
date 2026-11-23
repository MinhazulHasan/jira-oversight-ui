import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useBoardPickerRequested } from "@/components/shell/board-switcher";
import { renderKit } from "@/components/ui/__tests__/kit";

import { NotSyncedLine } from "../not-synced-line";

/*
 * The Portfolio lists the synced boards only (JO-17); the boards in Jira not
 * synced yet are counted in one line, which points at the board picker.
 */

/** Says whether the picker was asked to open, as the top bar's (or the navigation sheet's) picker would take it up. */
function Picker() {
  return <p data-testid="picker">{useBoardPickerRequested() ? "asked" : "not asked"}</p>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("NotSyncedLine", () => {
  it("counts the boards not synced yet, as more than the ones listed", () => {
    const { rerender } = renderKit(<NotSyncedLine count={3} synced={2} />);
    expect(screen.getByText(/in Jira/).closest("p")).toHaveTextContent("3 more boards in Jira aren’t synced yet. Choose a board");
    rerender(<NotSyncedLine count={1} synced={2} />);
    expect(screen.getByText(/in Jira/).closest("p")).toHaveTextContent("1 more board in Jira isn’t synced yet.");
  });

  it("drops “more” when no board has synced, and says nothing when every board has", () => {
    const { rerender, container } = renderKit(<NotSyncedLine count={4} synced={0} />);
    expect(screen.getByText(/in Jira/).closest("p")).toHaveTextContent("4 boards in Jira aren’t synced yet.");
    rerender(<NotSyncedLine count={0} synced={5} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<NotSyncedLine count={undefined} synced={5} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("opens the board picker, where each can be picked and synced", () => {
    renderKit(
      <>
        <NotSyncedLine count={2} synced={1} />
        <Picker />
      </>,
    );
    expect(screen.getByTestId("picker")).toHaveTextContent("not asked");
    act(() => fireEvent.click(screen.getByRole("button", { name: "Choose a board" })));
    expect(screen.getByTestId("picker")).toHaveTextContent("asked");
  });
});
