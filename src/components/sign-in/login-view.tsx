import { Callout } from "@/components/ui/callout";
import { signInPath, type LoginError } from "@/lib/sign-in";

import { ATLASSIAN_LOGOUT_URL, LOGIN_ERROR_NOTICES, NOT_SET_UP, SIGNED_OUT_NOTICE, SIGN_IN_PURPOSE } from "./copy";
import { ExternalTextLink, PrimaryLink, SignInHeading, SignInSheet } from "./sign-in-sheet";
import { SignedOutToast } from "./signed-out-toast";

export type LoginState =
  /** Ready to sign in, coming back to `next`, perhaps after a failed attempt or a sign-out. */
  | { kind: "sign_in"; next: string; notice: LoginError | "signed_out" | null }
  /** Sign-in is on but cannot work. `problem` names the variable to fix, never its value. */
  | { kind: "not_set_up"; problem: string };

/** /login. */
export function LoginView({ state }: { state: LoginState }) {
  if (state.kind === "not_set_up") {
    return (
      <SignInSheet>
        <SignInHeading title={NOT_SET_UP.title} purpose={NOT_SET_UP.purpose} />
        <Callout tone="warn" label={NOT_SET_UP.label}>
          <p className="break-words">{state.problem}</p>
        </Callout>
      </SignInSheet>
    );
  }

  return (
    <SignInSheet>
      <SignInHeading title="Sign in" purpose={SIGN_IN_PURPOSE} />
      {state.notice ? (
        <div role="status">
          <LoginNotice notice={state.notice} />
        </div>
      ) : null}
      <PrimaryLink href={signInPath(state.next)}>Sign in with Atlassian</PrimaryLink>
      {state.notice === "signed_out" ? <SignedOutToast /> : null}
    </SignInSheet>
  );
}

function LoginNotice({ notice }: { notice: LoginError | "signed_out" }) {
  if (notice === "signed_out") {
    return (
      <Callout
        tone="info"
        label={SIGNED_OUT_NOTICE.label}
        title={SIGNED_OUT_NOTICE.title}
        action={
          <p className="text-sm">
            <ExternalTextLink href={ATLASSIAN_LOGOUT_URL}>Sign out of Atlassian</ExternalTextLink>
          </p>
        }
      >
        {SIGNED_OUT_NOTICE.body}
      </Callout>
    );
  }
  const { label, title, body } = LOGIN_ERROR_NOTICES[notice];
  return (
    <Callout tone="warn" label={label} title={title}>
      {body}
    </Callout>
  );
}
