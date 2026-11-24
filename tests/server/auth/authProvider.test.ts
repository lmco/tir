import { describe, expect, test, vi } from "vitest";

import { assertEmailVerified, recordExternalLogin } from "../../../server/auth/authProvider";
import { GroupClaimExtractor } from "../../../server/auth/groupClaimExtractor";

vi.mock("../../../db/models", () => ({
  User: { findOne: vi.fn(), create: vi.fn() },
  Session: { create: vi.fn(), destroy: vi.fn(), findOne: vi.fn() },
  UserRole: {},
}));

vi.mock("../../../server/utils/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    alert: vi.fn(),
  },
}));

describe("assertEmailVerified", () => {
  test("allows claims when required is false", () => {
    expect(() => assertEmailVerified({ email_verified: false }, false)).not.toThrow();
  });

  test("allows verified boolean true", () => {
    expect(() => assertEmailVerified({ email_verified: true }, true)).not.toThrow();
  });

  test("allows verified string 'true'", () => {
    expect(() => assertEmailVerified({ email_verified: "true" }, true)).not.toThrow();
  });

  test("allows missing email_verified claim", () => {
    expect(() => assertEmailVerified({}, true)).not.toThrow();
    expect(() => assertEmailVerified({ email_verified: undefined }, true)).not.toThrow();
  });

  test("rejects verified boolean false", () => {
    expect(() => assertEmailVerified({ email_verified: false }, true)).toThrow(
      "The identity provider has not verified this email address.",
    );
  });

  test("rejects unverified string values", () => {
    expect(() => assertEmailVerified({ email_verified: "false" }, true)).toThrow(
      "The identity provider has not verified this email address.",
    );
  });
});

describe("GroupClaimExtractor", () => {
  test("parses comma delimited group mappings with colon separators", () => {
    const raw = "Admins:1,Developers:2,Users:3";
    const parsed = GroupClaimExtractor.parseGroupMappings(raw);
    expect(parsed).toEqual([
      { groupName: "Admins", userRoleId: 1 },
      { groupName: "Developers", userRoleId: 2 },
      { groupName: "Users", userRoleId: 3 },
    ]);
  });

  test("parses pipe delimited group mappings for LDAP DNs", () => {
    const raw = "CN=Admins,DC=example,DC=com:1|CN=Users,DC=example,DC=com:2";
    const parsed = GroupClaimExtractor.parseGroupMappings(raw, "|");
    expect(parsed).toEqual([
      { groupName: "CN=Admins,DC=example,DC=com", userRoleId: 1 },
      { groupName: "CN=Users,DC=example,DC=com", userRoleId: 2 },
    ]);
  });

  test("extracts groups from scope string", () => {
    const extractor = new GroupClaimExtractor({
      mode: "scope",
      claimPath: "",
      groupRoleMappings: [
        { groupName: "admins", userRoleId: 1 },
        { groupName: "users", userRoleId: 2 },
      ],
    });

    const groups = extractor.extractGroups({ scope: "openid profile group:admins group:users group:unmapped" });
    expect(groups).toEqual(["admins", "users"]);
  });

  test("extracts groups from nested claim path", () => {
    const extractor = new GroupClaimExtractor({
      mode: "claim",
      claimPath: "realm_access.roles",
      groupRoleMappings: [{ groupName: "admin", userRoleId: 1 }],
    });

    const groups = extractor.extractGroups({
      realm_access: {
        roles: ["admin", "guest"],
      },
    });
    expect(groups).toEqual(["admin", "guest"]);
  });

  test("matches extracted groups to user role ids", () => {
    const extractor = new GroupClaimExtractor({
      mode: "scope",
      claimPath: "",
      groupRoleMappings: [
        { groupName: "Admins", userRoleId: 1 },
        { groupName: "Users", userRoleId: 2 },
      ],
    });

    const roles = extractor.getAllMatchingRoles(["admins", "users"]);
    expect(roles).toEqual([1, 2]);
  });

  test("returns empty array when no groups match", () => {
    const extractor = new GroupClaimExtractor({
      mode: "scope",
      claimPath: "",
      groupRoleMappings: [{ groupName: "Admins", userRoleId: 1 }],
    });

    const roles = extractor.getAllMatchingRoles(["unknown"]);
    expect(roles).toEqual([]);
  });
});

describe("recordExternalLogin", () => {
  const notice = vi.fn();
  vi.stubGlobal("logger", { notice });
  const account = (providerId: string | null = null, externalKey: string | null = null) => ({
    email: "fry@example.com",
    providerId,
    externalKey,
  });

  test("stores the provider and key on the first login", () => {
    const user = account();
    expect(recordExternalLogin(user, { providerUid: "uid-1", key: "sub-1" })).toBe(true);
    expect(user).toMatchObject({ providerId: "uid-1", externalKey: "sub-1" });
  });

  test("reports no change when both already match", () => {
    expect(recordExternalLogin(account("uid-1", "sub-1"), { providerUid: "uid-1", key: "sub-1" })).toBe(false);
  });

  test("stores nothing when the provider or the key is missing", () => {
    const user = account();
    expect(recordExternalLogin(user, { providerUid: "uid-1" })).toBe(false);
    expect(recordExternalLogin(user, { key: "sub-1" })).toBe(false);
    expect(user).toMatchObject({ providerId: null, externalKey: null });
  });

  test("replaces the key and logs when the same provider reports a different one", () => {
    notice.mockClear();
    const user = account("uid-1", "sub-1");
    expect(recordExternalLogin(user, { providerUid: "uid-1", key: "sub-2" })).toBe(true);
    expect(user.externalKey).toBe("sub-2");
    expect(notice).toHaveBeenCalledOnce();
  });

  test("replaces both without a log when the login comes through another provider", () => {
    notice.mockClear();
    const user = account("uid-1", "sub-1");
    expect(recordExternalLogin(user, { providerUid: "uid-2", key: "dn-9" })).toBe(true);
    expect(user).toMatchObject({ providerId: "uid-2", externalKey: "dn-9" });
    expect(notice).not.toHaveBeenCalled();
  });
});
