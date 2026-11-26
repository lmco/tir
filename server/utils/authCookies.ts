import { deleteCookie } from "h3";
import type { H3Event } from "h3";

export const AUTH_COOKIES = {
  STATE: "pkce_state",
  NONCE: "oidc_nonce",
  CODE_VERIFIER: "oidc_code_verifier",
  TEST_MODE: "tir_auth_test",
} as const;

/** For the short-lived cookies of a login in progress. Secure matches the session cookie. */
export const LOGIN_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  secure: process.env.NODE_ENV === "production",
} as const;

export function clearAuthCookie(event: H3Event, name: string) {
  deleteCookie(event, name, { path: "/" });
}

export function clearLoginCookies(event: H3Event) {
  for (const name of Object.values(AUTH_COOKIES)) clearAuthCookie(event, name);
}
