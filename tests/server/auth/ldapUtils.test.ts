import { describe, expect, test } from "vitest";
import { fallbackEmail, ldapClientOptions } from "../../../server/auth/ldapUtils";

describe("fallbackEmail", () => {
  test("uses a reserved address under the provider's identifier", () => {
    expect(fallbackEmail("jsmith", { id: "ldap-2", uid: "8e68eade-d508" })).toBe(
      "jsmith@8e68eade-d508.example.com",
    );
  });

  test("keeps two providers apart", () => {
    const a = fallbackEmail("jsmith", { id: "ldap-1", uid: "uid-a" });
    const b = fallbackEmail("jsmith", { id: "ldap-2", uid: "uid-b" });
    expect(a).not.toBe(b);
  });

  test("keeps the old address for the provider an upgrade carried over", () => {
    const carriedOver = { id: "openldap-1", uid: "uid-a", fallbackEmailDomain: "example.com" };
    expect(fallbackEmail("jsmith", carriedOver)).toBe("jsmith@example.com");
  });

  test("falls back to the config id when no identifier is known", () => {
    expect(fallbackEmail("jsmith", { id: "unsaved" })).toBe("jsmith@unsaved.example.com");
  });
});

describe("ldapClientOptions", () => {
  test("opens TLS at connect only for an ldaps:// url", () => {
    const opts = ldapClientOptions({ url: "ldaps://ldap.example.com:636", ssl: true }, 1000);
    expect(opts.tlsOptions).toEqual({});
  });

  test("leaves an ldap:// url in clear text at connect so StartTLS can upgrade it", () => {
    const opts = ldapClientOptions({ url: "ldap://ldap.example.com:389", ssl: true }, 1000);
    expect(opts.tlsOptions).toBeUndefined();
  });

  test("passes the CA or the skip switch through for ldaps://", () => {
    const url = "ldaps://ldap.example.com";
    expect(ldapClientOptions({ url, ssl: true, sslCa: "PEM" }, 1000).tlsOptions).toEqual({ ca: "PEM" });
    expect(ldapClientOptions({ url, ssl: true, sslInsecure: true }, 1000).tlsOptions).toEqual({
      rejectUnauthorized: false,
    });
  });

  test("sets no TLS options when the switch is off", () => {
    expect(ldapClientOptions({ url: "ldap://ldap.example.com", ssl: false }, 1000).tlsOptions).toBeUndefined();
  });
});
