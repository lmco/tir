import { describe, expect, test, vi } from "vitest";

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

import { assertEmailVerified } from "../../../server/auth/authProvider";
import { GroupClaimExtractor } from "../../../server/auth/groupClaimExtractor";

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
