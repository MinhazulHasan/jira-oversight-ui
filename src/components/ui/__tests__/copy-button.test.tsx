import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { notify } from "@/lib/notify";

import { CopyButton } from "../copy-button";
import { renderKit } from "./kit";

vi.mock("@/lib/notify", () => ({
  notify: { ok: vi.fn(), cite: vi.fn(), warn: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));

beforeEach(() => {
  vi.mocked(notify.ok).mockClear();
  vi.mocked(notify.warn).mockClear();
});

describe("CopyButton", () => {
  it("copies the exact value, turns to a tick, and says what was copied", async () => {
    const user = userEvent.setup();
    renderKit(<CopyButton value="DEMO-142" what="issue key" />);

    await user.click(screen.getByRole("button", { name: "Copy issue key" }));

    expect(await navigator.clipboard.readText()).toBe("DEMO-142");
    expect(notify.ok).toHaveBeenCalledWith("Copied issue key", { description: "DEMO-142" });
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("names an icon-only button for what it copies", async () => {
    const user = userEvent.setup();
    renderKit(<CopyButton value="10423" what="changelog id" iconOnly />);
    await user.click(screen.getByRole("button", { name: "Copy changelog id" }));
    expect(await navigator.clipboard.readText()).toBe("10423");
  });

  it("says plainly when the browser blocks the clipboard", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("Denied"));
    renderKit(<CopyButton value="DEMO-142" what="issue key" />);

    await user.click(screen.getByRole("button", { name: "Copy issue key" }));

    expect(notify.ok).not.toHaveBeenCalled();
    expect(notify.warn).toHaveBeenCalledWith("Could not copy", expect.objectContaining({ description: expect.any(String) }));
    expect(screen.getByRole("button", { name: "Copy issue key" })).toBeInTheDocument();
  });
});
