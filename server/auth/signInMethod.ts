import { SIGN_IN_METHODS, SIGN_IN_METHOD_LABELS, type SignInMethod } from "~/types/auth";

const ADMIN_ROLE_ID = 1;

export function isSignInMethod(value: unknown): value is SignInMethod {
  return SIGN_IN_METHODS.includes(value as SignInMethod);
}

export function accountMethod(user: { creationMethod?: string | null }): SignInMethod {
  return isSignInMethod(user.creationMethod) ? user.creationMethod : "local";
}

/**
 * Why this account may not sign in through the attempted method, or null when it may.
 * A stored password keeps local sign-in open after a switch away from local, until the
 * first sign-in through the new method clears it.
 */
export function signInRefusal(
  user: { creationMethod?: string | null; password?: string | null },
  attempted: SignInMethod,
): string | null {
  const method = accountMethod(user);
  if (method === attempted) return null;
  if (attempted === "local" && user.password) return null;
  return `This account signs in with ${SIGN_IN_METHOD_LABELS[method]}. Use that method, or ask an administrator to change the account's sign-in method.`;
}

/** Why the actor may not change the target's sign-in method, or null when they may. */
export function methodChangeRefusal(
  actor: { id: number; UserRoleId: number },
  target: { id: number; UserRoleId: number },
): string | null {
  if (actor.UserRoleId !== ADMIN_ROLE_ID) return "Administrator role required.";
  if (actor.id === target.id) return null;
  if (target.UserRoleId === ADMIN_ROLE_ID) {
    return "An administrator's sign-in method can only be changed by that administrator.";
  }
  return null;
}
