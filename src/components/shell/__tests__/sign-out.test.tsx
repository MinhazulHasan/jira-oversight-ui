import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/notify", () => ({
  notify: { ok: vi.fn(), cite: vi.fn(), warn: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));

import { HISTORY_KEY } from "@/components/ask/history";
import { renderKit } from "@/components/ui/__tests__/kit";
import { notify } from "@/lib/notify";

import { SIGNED_OUT_PATH, SignOutButton, SignOutConfirm, cancelSignOut, leave, requestSignOut } from "../sign-out";

/*
 * Sign out is a POST from the dashboard's own page, labelled in both places
 * it appears. It goes as a same-origin fetch, so it carries the dashboard's
 * real Origin (the site's no-referrer policy would make a form's own POST say
 * "null", which the route refuses), and lands on /login?signed_out=1. It is a
 * plain button, never a form: pressed before the page hydrates, a form would
 * submit by itself and meet that refusal.
 *
 * It asks first (the product owner, 13 Nov 2026): every way to sign out opens
 * one confirmation, and only its own "Sign out" ends the session.
 */

function answer(response: Partial<Response>) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response as Response);
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/** The button and the confirmation the (app) layout mounts once. */
function renderSignOut(variant: "bar" | "sheet" = "bar") {
  return renderKit(
    <>
      <SignOutButton variant={variant} />
      <SignOutConfirm />
    </>,
  );
}

const confirmation = () => screen.getByRole("alertdialog", { name: "Sign out of Jira Oversight?" });
const confirmSignOut = () => within(confirmation()).getByRole("button", { name: "Sign out" });

afterEach(() => {
  act(() => cancelSignOut());
  vi.unstubAllGlobals();
  vi.mocked(notify.warn).mockClear();
  vi.restoreAllMocks();
});

describe("SignOutButton", () => {
  it.each(["bar", "sheet"] as const)("in the %s, is a labelled button that can never submit a form by itself", (variant) => {
    const { container } = renderKit(<SignOutButton variant={variant} />);

    const button = screen.getByRole("button", { name: "Sign out" });
    expect(button).toHaveAttribute("type", "button");
    expect(button.closest("form")).toBeNull();
    expect(container.querySelector("form, a")).toBeNull();
  });

  it("says so in words in the navigation sheet", () => {
    renderKit(<SignOutButton variant="sheet" />);
    expect(screen.getByRole("button", { name: "Sign out" })).toHaveTextContent("Sign out");
  });

  it.each(["bar", "sheet"] as const)("in the %s, asks first: a press opens the confirmation and ends nothing", async (variant) => {
    const fetch = answer({ type: "opaqueredirect", ok: false, status: 0 });
    const to = vi.spyOn(leave, "to").mockImplementation(() => undefined);
    renderSignOut(variant);

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Sign out of Jira Oversight?" });
    expect(dialog).toHaveAccessibleDescription(/sign in with Atlassian next time/);
    // "Stay signed in" holds the focus, so Enter or a second stray click keeps the session.
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Stay signed in" })).toHaveFocus());
    expect(fetch).not.toHaveBeenCalled();
    expect(to).not.toHaveBeenCalled();
  });

  it("keeps the session when the reader stays, by the button or by Escape", async () => {
    const fetch = answer({ type: "opaqueredirect", ok: false, status: 0 });
    renderSignOut();

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Stay signed in" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    fireEvent.keyDown(await screen.findByRole("alertdialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(fetch).not.toHaveBeenCalled();
  });

  it("ends the session with a same-origin POST that keeps its Origin, then goes to the sign-in page", async () => {
    const fetch = answer({ type: "opaqueredirect", ok: false, status: 0 });
    const to = vi.spyOn(leave, "to").mockImplementation(() => undefined);
    renderSignOut();

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await screen.findByRole("alertdialog");
    fireEvent.click(confirmSignOut());
    await waitFor(() => expect(to).toHaveBeenCalledWith(SIGNED_OUT_PATH));
    expect(SIGNED_OUT_PATH).toBe("/login?signed_out=1");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth/logout",
      expect.objectContaining({ method: "POST", referrerPolicy: "same-origin", redirect: "manual" }),
    );
    expect(notify.warn).not.toHaveBeenCalled();
  });

  it("says it is signing out, and cannot be dismissed, while the sign-out is under way", async () => {
    let finish: (response: Response) => void = () => undefined;
    vi.stubGlobal("fetch", vi.fn<typeof globalThis.fetch>().mockReturnValue(new Promise((resolve) => (finish = resolve))));
    const to = vi.spyOn(leave, "to").mockImplementation(() => undefined);
    renderSignOut();

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await screen.findByRole("alertdialog");
    fireEvent.click(confirmSignOut());
    expect(await within(confirmation()).findByRole("button", { name: /Signing out/ })).toHaveAttribute("aria-busy", "true");
    expect(within(confirmation()).getByRole("button", { name: "Stay signed in" })).toBeDisabled();
    fireEvent.keyDown(confirmation(), { key: "Escape" });
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    finish({ type: "opaqueredirect", ok: false, status: 0 } as Response);
    await waitFor(() => expect(to).toHaveBeenCalledWith(SIGNED_OUT_PATH));
  });

  it("forgets this tab's Ask questions and answers as the session ends", async () => {
    answer({ type: "opaqueredirect", ok: false, status: 0 });
    const to = vi.spyOn(leave, "to").mockImplementation(() => undefined);
    window.sessionStorage.setItem(HISTORY_KEY, JSON.stringify([{ question: "kept from before" }]));
    renderSignOut();

    act(() => requestSignOut());
    fireEvent.click(confirmSignOut());
    await waitFor(() => expect(to).toHaveBeenCalled());
    expect(JSON.parse(window.sessionStorage.getItem(HISTORY_KEY) ?? "[]")).toEqual([]);
  });

  it("sends one sign-out however many times it is pressed while it is under way", async () => {
    const fetch = answer({ type: "opaqueredirect", ok: false, status: 0 });
    const to = vi.spyOn(leave, "to").mockImplementation(() => undefined);
    renderSignOut("sheet");

    act(() => requestSignOut());
    const button = confirmSignOut();
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(to).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["refused", () => answer({ type: "basic", ok: false, status: 403 })],
    ["unreachable", () => vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")))],
  ])("stays put, keeps the confirmation open and says so when the sign-out is %s", async (_case, arrange) => {
    arrange();
    const to = vi.spyOn(leave, "to").mockImplementation(() => undefined);
    renderSignOut("sheet");

    act(() => requestSignOut());
    fireEvent.click(confirmSignOut());
    await waitFor(() => expect(notify.warn).toHaveBeenCalledWith("Could not sign out", expect.anything()));
    expect(within(confirmation()).getByRole("status")).toHaveTextContent("The dashboard did not answer");
    expect(confirmSignOut()).toBeEnabled();
    expect(to).not.toHaveBeenCalled();
  });
});
