import { describe, expect, test } from "vitest";
import {
  validateAuthConfigInput,
  AuthConfigValidationError,
} from "../../../server/utils/config/validateAuthConfig";

const ldap = {
  id: "ldap-1",
  label: "LDAP",
  template: "openldap",
  enable: true,
  url: "ldaps://ldap.example.com",
  bindDn: "cn=admin,dc=example,dc=com",
  password: "secret",
  passwordSet: false,
  baseDn: "dc=example,dc=com",
  ssl: true,
  sslInsecure: false,
  sslCa: "",
  groupAttribute: "memberOf",
  groupMappings: "",
};

describe("validateAuthConfigInput", () => {
  test("keeps schema fields, the secret and its flag", () => {
    const out = validateAuthConfigInput({ ldap: [ldap] });
    expect(out.ldap).toEqual([ldap]);
  });

  test("drops unknown local fields", () => {
    const out = validateAuthConfigInput({ local: { enable: true, passwordLength: 12, bogus: "x" } });
    expect(out.local).toEqual({ enable: true, passwordLength: 12 });
  });

  test("drops unknown provider fields", () => {
    const out = validateAuthConfigInput({ ldap: [{ ...ldap, extra: "x" }] });
    expect(out.ldap?.[0]).not.toHaveProperty("extra");
  });

  test("rejects a provider id with characters outside the pattern", () => {
    expect(() => validateAuthConfigInput({ oidc: [{ id: "kc~1" }] })).toThrow(AuthConfigValidationError);
    expect(() => validateAuthConfigInput({ oidc: [{ id: "KC" }] })).toThrow(AuthConfigValidationError);
    expect(() => validateAuthConfigInput({ oidc: [{ id: "" }] })).toThrow(AuthConfigValidationError);
  });

  test("rejects duplicate provider ids", () => {
    expect(() => validateAuthConfigInput({ oauth: [{ id: "gh" }, { id: "gh" }] })).toThrow(
      /duplicate provider id "gh"/,
    );
  });

  test("rejects a field of the wrong type", () => {
    expect(() => validateAuthConfigInput({ local: { enable: "yes" } })).toThrow(/enable must be a boolean/);
    expect(() => validateAuthConfigInput({ local: { passwordLength: -1 } })).toThrow(/passwordLength/);
    expect(() => validateAuthConfigInput({ ldap: [{ id: "a", url: 5 }] })).toThrow(/url must be a string/);
  });

  test("rejects a provider list that is not an array", () => {
    expect(() => validateAuthConfigInput({ ldap: { id: "a" } })).toThrow(/ldap must be a list/);
  });

  test("accepts the default login provider forms", () => {
    for (const value of ["", "local", "ldap:ad-1"]) {
      expect(validateAuthConfigInput({ defaultLoginProvider: value }).defaultLoginProvider).toBe(value);
    }
    expect(() => validateAuthConfigInput({ defaultLoginProvider: "oidc:x" })).toThrow(AuthConfigValidationError);
  });

  test("rejects a body that is not an object", () => {
    expect(() => validateAuthConfigInput(null)).toThrow(AuthConfigValidationError);
    expect(() => validateAuthConfigInput([])).toThrow(AuthConfigValidationError);
  });
});
