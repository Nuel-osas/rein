// Where a person was going when sign-in interrupted them. Nuntio keeps this in sessionStorage
// because Google sign-in leaves the page (lib/useJoinTeam.ts there); Rein does the same, and also
// carries it on the onboarding URL as ?next= so a reload of /onboarding keeps it.
//
// Fail closed: only a path on this site is ever returned. Anything else (another origin, a
// protocol-relative "//host", a backslash, the sign-in pages themselves) is dropped and the caller
// falls back to /dashboard.

const KEY = "rein:return-to";
const SIGN_IN = /^\/(onboarding|signin|auth)(\/|\?|$)/;
const SAFE = /^\/(?![/\\])[A-Za-z0-9\-._~/?=&%+,:@]{0,511}$/;
const INVITE = /^\/invite\/[A-Za-z0-9_-]+\/?$/;

/** The path itself when it is a safe place on this site to return to; null otherwise. */
export function safeReturnTo(path: string | null | undefined): string | null {
  if (typeof path !== "string") return null;
  if (!SAFE.test(path) || SIGN_IN.test(path)) return null;
  return path;
}

/** True for an invite link, which a person with no team of their own still goes back to. */
export function isInvitePath(path: string): boolean {
  return INVITE.test(path.split("?")[0]);
}

export function rememberReturnTo(path: string): void {
  const safe = safeReturnTo(path);
  if (!safe) return;
  try {
    globalThis.sessionStorage?.setItem(KEY, safe);
  } catch {
    // Storage unavailable: the ?next= on the onboarding URL still carries it.
  }
}

/** ?next= on the current URL first, then what an earlier page remembered. */
export function readReturnTo(search?: string): string | null {
  try {
    const fromQuery = safeReturnTo(new URLSearchParams(search ?? globalThis.location?.search ?? "").get("next"));
    if (fromQuery) return fromQuery;
  } catch {
    // no URL to read
  }
  try {
    return safeReturnTo(globalThis.sessionStorage?.getItem(KEY) ?? null);
  } catch {
    return null;
  }
}

export function forgetReturnTo(): void {
  try {
    globalThis.sessionStorage?.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
}

/** The onboarding URL that brings a person back to `path` after Google sign-in. */
export function onboardingHref(path: string | null | undefined): string {
  const safe = safeReturnTo(path);
  return safe && safe !== "/dashboard" ? `/onboarding?next=${encodeURIComponent(safe)}` : "/onboarding";
}
