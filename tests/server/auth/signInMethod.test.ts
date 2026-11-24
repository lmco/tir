import { describe, expect, test } from "vitest";
import { accountMethod, isSignInMethod, methodChangeRefusal, signInRefusal } from "../../../server/auth/signInMethod";

const admin = { id: 1, UserRoleId: 1 };
const otherAdmin = { id: 2, UserRoleId: 1 };
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
  test("lets an admin change a non-admin user", () => {
    expect(methodChangeRefusal(admin, member)).toBeNull();
  });

  test("lets an admin change their own method", () => {
    expect(methodChangeRefusal(admin, admin)).toBeNull();
  });

  test("refuses an admin changing another admin", () => {
    expect(methodChangeRefusal(admin, otherAdmin)).toMatch(/only be changed by that administrator/);
  });

  test("refuses a non-admin, including on their own account", () => {
    expect(methodChangeRefusal(member, member)).toBe("Administrator role required.");
  });
});
