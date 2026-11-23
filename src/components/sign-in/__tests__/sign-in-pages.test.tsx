import { render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { Redirected } = vi.hoisted(() => ({
  /** What the mocked redirect() throws, as the real one throws to end rendering. */
  Redirected: class Redirected extends Error {
    constructor(readonly to: string) {
      super(`redirect to ${to}`);
    }
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Redirected(to);
  }),
}));
vi.mock("@/server/auth/config", () => ({ authStatus: vi.fn(() => ({ mode: "atlassian" })) }));
vi.mock("@/server/auth/session", () => ({ currentSession: vi.fn(async () => null) }));
vi.mock("@/lib/notify", () => ({
  notify: { ok: vi.fn(), cite: vi.fn(), warn: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));

import LoginPage from "@/app/(sign-in)/login/page";
import NoAccessPage from "@/app/(sign-in)/no-access/page";
import { notify } from "@/lib/notify";
import { LOGIN_ERRORS, NO_ACCESS_REASONS } from "@/lib/sign-in";
import { authStatus } from "@/server/auth/config";
import type { Session } from "@/server/auth/cookies";
import { currentSession } from "@/server/auth/session";

import {
  ATLASSIAN_LOGOUT_URL,
  LOGIN_ERROR_NOTICES,
  NOT_SET_UP,
  NO_ACCESS_FALLBACK,
  NO_ACCESS_REFUSALS,
  SIGNED_OUT_NOTICE,
} from "../copy";
import { LoginView } from "../login-view";
import { NoAccessView } from "../no-access-view";

/*
 * The two pages outside the shell. The views are checked as a reader meets
 * them (roles and names); the pages for what they decide: when to send the
 * reader straight on, and that a code in the address only ever picks one of
 * the fixed messages.
 */

type Query = Record<string, string | string[] | undefined>;

const SESSION: Session = { v: 2, sub: "account-1", dom: "allowed.test", site: "cloud-1", eh: "hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh", boards: ["DEMO"], iat: 1, exp: 2 };
const PROBLEM = "AUTH_SECRET must be at least 32 characters of random.";

function props(query: Query) {
  return { params: Promise.resolve({}), searchParams: Promise.resolve(query) };
}

async function login(query: Query) {
  return render((await LoginPage(props(query))) as ReactElement);
}

async function noAccess(query: Query) {
  return render((await NoAccessPage(props(query))) as ReactElement);
}

/** Where a page sent the reader instead of rendering. */
async function redirectOf(page: Promise<unknown>): Promise<string> {
  const outcome = await page.then(
    () => null,
    (error: unknown) => error,
  );
  expect(outcome).toBeInstanceOf(Redirected);
  return (outcome as InstanceType<typeof Redirected>).to;
}

const signInButton = () => screen.getByRole("link", { name: /^Sign in with Atlassian/ });

afterEach(() => {
  vi.mocked(authStatus).mockReset().mockReturnValue({ mode: "atlassian" });
  vi.mocked(currentSession).mockReset().mockResolvedValue(null);
  vi.mocked(notify.ok).mockClear();
});

describe("LoginView", () => {
  it("offers Sign in with Atlassian as a plain link that comes back to where the reader was going", () => {
    render(<LoginView state={{ kind: "sign_in", next: "/findings?severity=breach", notice: null }} />);

    expect(screen.getByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByText(/only reads Jira; it never changes anything there/)).toBeInTheDocument();
    expect(signInButton()).toHaveAttribute("href", "/api/auth/login?next=%2Ffindings%3Fseverity%3Dbreach");
    // A GET, never a form: the form-action policy would stop a redirect chain that ends at Atlassian.
    expect(signInButton().closest("form")).toBeNull();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("starts from the Overview when there is nowhere to come back to", () => {
    render(<LoginView state={{ kind: "sign_in", next: "/", notice: null }} />);
    expect(signInButton()).toHaveAttribute("href", "/api/auth/login");
  });

  it.each(LOGIN_ERRORS)("says calmly why a sign-in ended with %s, and offers to try again", (code) => {
    render(<LoginView state={{ kind: "sign_in", next: "/", notice: code }} />);

    const notice = screen.getByRole("status");
    expect(within(notice).getByText(LOGIN_ERROR_NOTICES[code].title)).toBeInTheDocument();
    expect(within(notice).getByText(LOGIN_ERROR_NOTICES[code].body)).toBeInTheDocument();
    expect(signInButton()).toBeInTheDocument();
    expect(notify.ok).not.toHaveBeenCalled();
  });

  it("acknowledges a sign-out on the page and with a toast, and says how to leave Atlassian too", () => {
    render(<LoginView state={{ kind: "sign_in", next: "/", notice: "signed_out" }} />);

    const notice = screen.getByRole("status");
    expect(within(notice).getByText(SIGNED_OUT_NOTICE.title)).toBeInTheDocument();
    const atlassian = within(notice).getByRole("link", { name: "Sign out of Atlassian, opens in a new tab" });
    expect(atlassian).toHaveAttribute("href", ATLASSIAN_LOGOUT_URL);
    expect(atlassian).toHaveAttribute("target", "_blank");
    expect(atlassian).toHaveAttribute("rel", "noopener noreferrer");
    expect(notify.ok).toHaveBeenCalledWith("Signed out", expect.objectContaining({ id: "signed-out" }));
  });

  it("says when sign-in is not set up, names what to fix, and offers no button that could only come back", () => {
    render(<LoginView state={{ kind: "not_set_up", problem: PROBLEM }} />);

    expect(screen.getByRole("heading", { level: 1, name: NOT_SET_UP.title })).toBeInTheDocument();
    expect(screen.getByText(PROBLEM)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("NoAccessView", () => {
  it.each(NO_ACCESS_REASONS)("explains %s, how to switch accounts, and starts again", (reason) => {
    render(<NoAccessView reason={reason} />);
    const refusal = NO_ACCESS_REFUSALS[reason];

    expect(screen.getByRole("heading", { level: 1, name: refusal.title })).toBeInTheDocument();
    expect(screen.getByText(refusal.body)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: new RegExp(`^${refusal.action}`) })).toHaveAttribute("href", "/api/auth/login");
    expect(screen.getByRole("link", { name: "id.atlassian.com, opens in a new tab" })).toHaveAttribute(
      "href",
      ATLASSIAN_LOGOUT_URL,
    );
    const steps = screen.getAllByRole("listitem");
    expect(steps).toHaveLength(2);
    expect(steps[0]).toHaveTextContent(/^Sign out of Atlassian at id\.atlassian\.com/);
    expect(steps[1]).toHaveTextContent(`Come back here and choose ${refusal.action}.`);
  });

  it("has a plain refusal for a reason it does not know", () => {
    render(<NoAccessView reason={null} />);
    expect(screen.getByRole("heading", { level: 1, name: NO_ACCESS_FALLBACK.title })).toBeInTheDocument();
  });

  it("words the domain refusal as the client asked", () => {
    render(<NoAccessView reason="domain" />);
    expect(screen.getByText(/^Only accounts on approved email domains can open Jira Oversight/)).toBeInTheDocument();
  });
});

describe("the /login page", () => {
  it("with sign-in off, sends the reader straight on", async () => {
    vi.mocked(authStatus).mockReturnValue({ mode: "off" });
    expect(await redirectOf(LoginPage(props({ next: "/findings?severity=breach" })))).toBe("/findings?severity=breach");
    expect(await redirectOf(LoginPage(props({ next: "//elsewhere.test/x" })))).toBe("/");
  });

  it("with a session already open, sends the reader straight on", async () => {
    vi.mocked(currentSession).mockResolvedValue(SESSION);
    expect(await redirectOf(LoginPage(props({ next: "/ask" })))).toBe("/ask");
  });

  it("says when sign-in is not set up, whatever the address asks", async () => {
    vi.mocked(authStatus).mockReturnValue({ mode: "unconfigured", problem: PROBLEM });
    await login({ error: "timeout", next: "/findings" });

    expect(screen.getByRole("heading", { level: 1, name: NOT_SET_UP.title })).toBeInTheDocument();
    expect(screen.getByText(PROBLEM)).toBeInTheDocument();
  });

  it("keeps where the reader was going, safely", async () => {
    await login({ next: ["/findings", "/ask"] });
    expect(signInButton()).toHaveAttribute("href", "/api/auth/login?next=%2Ffindings");
    await login({ next: "https://elsewhere.test/" });
    expect(screen.getAllByRole("link", { name: /^Sign in with Atlassian/ })[1]).toHaveAttribute("href", "/api/auth/login");
  });

  it("lets the code pick the message and shows nothing from the address", async () => {
    const { unmount } = await login({ error: "timeout", signed_out: "1" });
    expect(within(screen.getByRole("status")).getByText(LOGIN_ERROR_NOTICES.timeout.title)).toBeInTheDocument();
    unmount();

    await login({ signed_out: "1" });
    expect(within(screen.getByRole("status")).getByText(SIGNED_OUT_NOTICE.title)).toBeInTheDocument();
  });

  it("ignores a code it does not know", async () => {
    const { container } = await login({ error: "<b>planted-words</b>", signed_out: "yes", next: "/planted-path" });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(container.textContent).not.toContain("planted");
  });
});

describe("the /no-access page", () => {
  it("picks the refusal from the reason alone", async () => {
    await noAccess({ reason: "site" });
    expect(screen.getByRole("heading", { level: 1, name: NO_ACCESS_REFUSALS.site.title })).toBeInTheDocument();
  });

  it("shows nothing from the address", async () => {
    const { container } = await noAccess({ reason: "planted-words" });
    expect(screen.getByRole("heading", { level: 1, name: NO_ACCESS_FALLBACK.title })).toBeInTheDocument();
    expect(container.textContent).not.toContain("planted");
  });

  it("has nothing to say without sign-in, with a session open, or when sign-in is not set up", async () => {
    vi.mocked(authStatus).mockReturnValue({ mode: "off" });
    expect(await redirectOf(NoAccessPage(props({ reason: "domain" })))).toBe("/");

    vi.mocked(authStatus).mockReturnValue({ mode: "unconfigured", problem: PROBLEM });
    expect(await redirectOf(NoAccessPage(props({ reason: "domain" })))).toBe("/login");

    vi.mocked(authStatus).mockReturnValue({ mode: "atlassian" });
    vi.mocked(currentSession).mockResolvedValue(SESSION);
    expect(await redirectOf(NoAccessPage(props({ reason: "domain" })))).toBe("/");
  });
});
