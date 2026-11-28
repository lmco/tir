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

/** Why the actor may not change an account's sign-in method, or null when they may. */
export function methodChangeRefusal(actor: { UserRoleId: number }): string | null {
  return actor.UserRoleId === ADMIN_ROLE_ID ? null : "Administrator role required.";
}

export type MethodAvailability = Record<SignInMethod, boolean>;

type LockoutSubject = {
  UserRoleId?: number | null;
  creationMethod?: string | null;
  password?: string | null;
};

function canSignIn(user: LockoutSubject, available: MethodAvailability): boolean {
  if (available.local && user.password) return true;
  const method = accountMethod(user);
  return method !== "local" && available[method];
}

/** Whether at least one Admin has a way in. It judges by method, since any provider of an account's method lets it in. */
export function anyAdminCanSignIn(users: LockoutSubject[], available: MethodAvailability): boolean {
  return users.some((u) => u.UserRoleId === ADMIN_ROLE_ID && canSignIn(u, available));
}

/** Whether lowering this account's role would take away the last Admin who can sign in. */
export function demotionLocksOut(
  users: (LockoutSubject & { id: number })[],
  userId: number,
  available: MethodAvailability,
): boolean {
  if (!anyAdminCanSignIn(users, available)) return false;
  return !anyAdminCanSignIn(
    users.filter((u) => u.id !== userId),
    available,
  );
}

export const LOCKOUT_REFUSAL = "This change would leave no administrator able to sign in.";
