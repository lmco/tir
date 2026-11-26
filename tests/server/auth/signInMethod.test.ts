import { describe, expect, test } from "vitest";
import {
  accountMethod,
  anyAdminCanSignIn,
  demotionLocksOut,
  isSignInMethod,
  methodChangeRefusal,
  signInRefusal,
} from "../../../server/auth/signInMethod";

const admin = { id: 1, UserRoleId: 1 };
const member = { id: 3, UserRoleId: 2 };

describe("accountMethod", () => {
  test("reads a missing or unknown value as local", () => {
    expect(accountMethod({})).toBe("local");
    expect(accountMethod({ creationMethod: null })).toBe("local");
    expect(accountMethod({ creationMethod: "saml" })).toBe("local");
  });

  test("returns a known method", () => {
    expect(accountMethod({ creationMethod: "oidc" })).toBe("oidc");
  });
});

describe("isSignInMethod", () => {
  test("accepts only the four methods", () => {
    expect(isSignInMethod("oauth")).toBe(true);
    expect(isSignInMethod("saml")).toBe(false);
    expect(isSignInMethod(undefined)).toBe(false);
  });
});

describe("signInRefusal", () => {
  test("allows the account's own method", () => {
    expect(signInRefusal({ creationMethod: "ldap" }, "ldap")).toBeNull();
    expect(signInRefusal({ creationMethod: null, password: "hash" }, "local")).toBeNull();
  });

  test("refuses an external login on a local account and names the method", () => {
    expect(signInRefusal({ creationMethod: "local", password: "hash" }, "oidc")).toMatch(/signs in with Local/);
  });

  test("refuses one external method on an account that uses another", () => {
    expect(signInRefusal({ creationMethod: "ldap" }, "oauth")).toMatch(/signs in with LDAP/);
  });

  test("keeps local sign-in open while a password is still stored", () => {
    expect(signInRefusal({ creationMethod: "oidc", password: "hash" }, "local")).toBeNull();
  });

  test("refuses local sign-in once the password is gone", () => {
    expect(signInRefusal({ creationMethod: "oidc", password: null }, "local")).toMatch(/signs in with OIDC/);
  });
});

describe("methodChangeRefusal", () => {
  test("lets an admin change any account, another admin's included", () => {
    expect(methodChangeRefusal(admin)).toBeNull();
  });

  test("refuses a non-admin, including on their own account", () => {
    expect(methodChangeRefusal(member)).toBe("Administrator role required.");
  });
});

describe("anyAdminCanSignIn", () => {
  const all = { local: true, ldap: true, oidc: true, oauth: true };
  const localAdmin = { UserRoleId: 1, creationMethod: "local", password: "hash" };
  const oidcAdmin = { UserRoleId: 1, creationMethod: "oidc", password: null };

  test("is true while an admin's method has an enabled provider", () => {
    expect(anyAdminCanSignIn([oidcAdmin], all)).toBe(true);
  });

  test("is false when the only admin's method has no enabled provider", () => {
    expect(anyAdminCanSignIn([oidcAdmin], { ...all, oidc: false })).toBe(false);
  });

  test("counts a fallback password while local sign-in is available", () => {
    const switched = { ...oidcAdmin, password: "hash" };
    expect(anyAdminCanSignIn([switched], { ...all, oidc: false })).toBe(true);
    expect(anyAdminCanSignIn([switched], { ...all, oidc: false, local: false })).toBe(false);
  });

  test("does not count a local admin without a password", () => {
    expect(anyAdminCanSignIn([{ ...localAdmin, password: null }], all)).toBe(false);
  });

  test("ignores non-admin accounts", () => {
    expect(anyAdminCanSignIn([{ ...localAdmin, UserRoleId: 2 }], all)).toBe(false);
  });

  test("is satisfied by any one admin", () => {
    expect(anyAdminCanSignIn([oidcAdmin, localAdmin], { ...all, oidc: false })).toBe(true);
  });
});

describe("demotionLocksOut", () => {
  const all = { local: true, ldap: true, oidc: true, oauth: true };
  const ldapAdmin = (id: number) => ({ id, UserRoleId: 1, creationMethod: "ldap", password: null });

  test("is true for the only admin who can sign in", () => {
    expect(demotionLocksOut([ldapAdmin(1)], 1, all)).toBe(true);
  });

  test("is false while another admin can sign in", () => {
    expect(demotionLocksOut([ldapAdmin(1), ldapAdmin(2)], 1, all)).toBe(false);
  });

  test("is true when the other admin's method has no enabled provider", () => {
    const oidcAdmin = { id: 2, UserRoleId: 1, creationMethod: "oidc", password: null };
    expect(demotionLocksOut([ldapAdmin(1), oidcAdmin], 1, { ...all, oidc: false })).toBe(true);
  });

  test("is false when no admin could sign in already", () => {
    expect(demotionLocksOut([ldapAdmin(1)], 1, { ...all, ldap: false })).toBe(false);
  });
});
