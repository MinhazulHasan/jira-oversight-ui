import { afterEach, describe, expect, it, vi } from "vitest";

import type * as SignIn from "@/lib/sign-in";

vi.mock("@/lib/sign-in", async (importOriginal) => ({
  ...(await importOriginal<typeof SignIn>()),
  sendToSignIn: vi.fn(),
}));

import { LEAVE_GUARD_MS, sendToSignIn } from "@/lib/sign-in";

import { getHealth, getOverview, isApiError, postAsk, type ApiError } from "../client";

/*
 * When the session ends, the next API call answers 401 "unauthenticated":
 * the client sends the browser to sign in (and back to the page). While the
 * browser leaves, the call is held rather than failed, so the page keeps what
 * it shows instead of an error that blames the data source; should the
 * browser stay, the call fails as an ApiError, so nothing renders data it
 * does not have.
 */

function respond(body: unknown, status: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })),
  );
}

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(isApiError(error)).toBe(true);
  return error as ApiError;
}

const ENDED = { error: "unauthenticated", message: "You are not signed in, or your session has ended. Sign in to continue." };

/** Whether `promise` has settled yet, without waiting for it. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  promise.then(
    () => (done = true),
    () => (done = true),
  );
  await vi.advanceTimersByTimeAsync(0);
  return done;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.mocked(sendToSignIn).mockReset();
});

describe("a session that has ended", () => {
  it("holds the call while the browser leaves for the sign-in page", async () => {
    vi.useFakeTimers();
    vi.mocked(sendToSignIn).mockReturnValue(true);
    respond(ENDED, 401);
    const call = getOverview();
    expect(await settled(call)).toBe(false);
    expect(sendToSignIn).toHaveBeenCalledTimes(1);

    // Still here once the guard has passed (a navigation cancelled, say): the call fails like any other.
    await vi.advanceTimersByTimeAsync(LEAVE_GUARD_MS - 1);
    expect(await settled(call)).toBe(false);
    const caught = call.catch((reason: unknown) => reason);
    await vi.advanceTimersByTimeAsync(1);
    const error = (await caught) as ApiError;
    expect(isApiError(error)).toBe(true);
    expect(error).toMatchObject({ status: 401, code: "unauthenticated" });
    // A 4xx is not retried: the QueryClient skips it.
    expect(error.retryable).toBe(false);
  });

  it("still ends a held call at once when its query is cancelled", async () => {
    vi.useFakeTimers();
    vi.mocked(sendToSignIn).mockReturnValue(true);
    respond(ENDED, 401);
    const controller = new AbortController();
    const caught = getOverview({ signal: controller.signal }).catch((reason: unknown) => reason);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    expect(await caught).toMatchObject({ name: "AbortError" });
  });

  it("fails the call at once when the browser stays (it left a moment ago, or this is a sign-in page)", async () => {
    vi.mocked(sendToSignIn).mockReturnValue(false);
    respond(ENDED, 401);
    const error = await failure(getOverview());
    expect(sendToSignIn).toHaveBeenCalledTimes(1);
    expect(error).toMatchObject({ status: 401, code: "unauthenticated" });
  });

  it("does the same for a question posted to Ask", async () => {
    vi.mocked(sendToSignIn).mockReturnValue(false);
    respond({ error: "unauthenticated", message: "Sign in to continue." }, 401);
    await failure(postAsk("Where do tickets get stuck most?"));
    expect(sendToSignIn).toHaveBeenCalledTimes(1);
  });

  it("leaves every other failure where it is", async () => {
    const cases: [unknown, number][] = [
      [{ error: "not_configured", message: "Signing in with Atlassian needs APP_URL, which is not set." }, 500],
      [{ error: "upstream_refused", message: "The oversight service refused this interface's credentials." }, 502],
      [{ error: "not_found", message: "Nothing here." }, 404],
      // A 401 that is not this interface's own answer (a proxy in between, say).
      [{ error: "unauthorized", message: "Nope." }, 401],
      ["<html>401 Authorization Required</html>", 401],
      // The code on a status that does not go with it.
      [{ error: "unauthenticated", message: "Odd." }, 403],
    ];
    for (const [body, status] of cases) {
      respond(body, status);
      await failure(getHealth());
    }
    expect(sendToSignIn).not.toHaveBeenCalled();
  });
});
