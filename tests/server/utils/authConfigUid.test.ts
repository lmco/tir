import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  loadAuthConfig,
  providersNeedingSecretReentry,
  saveAuthConfig,
  storedLDAPPassword,
  storedOIDCSecret,
} from "../../../server/utils/config/authConfig";

const store = vi.hoisted(() => new Map<string, string>());

vi.mock("~/server/utils/config/tirConfig", () => ({
  getRawConfigValue: (key: string) => Promise.resolve(store.get(key)),
  setRawConfigValue: (key: string, value: unknown) => {
    if (value !== undefined) store.set(key, typeof value === "string" ? value : JSON.stringify(value));
    return Promise.resolve();
  },
  deleteRawConfigValue: (key: string) => {
    store.delete(key);
    return Promise.resolve();
  },
}));

const oidc = (overrides: Record<string, unknown> = {}) =>
  ({ id: "oidc-1", label: "OIDC", enable: true, url: "https://idp.example.com", clientId: "tir", ...overrides }) as any;

const savedUid = async () => (await loadAuthConfig()).oidc[0]?.uid;

describe("provider uid", () => {
  beforeEach(() => store.clear());

  test("is assigned on the first save", async () => {
    await saveAuthConfig({ oidc: [oidc()] });
    expect(await savedUid()).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("survives an edit, including one that repoints the provider", async () => {
    await saveAuthConfig({ oidc: [oidc()] });
    const uid = await savedUid();
    await saveAuthConfig({ oidc: [oidc({ url: "https://other.example.com", label: "Renamed" })] });
    expect(await savedUid()).toBe(uid);
  });

  test("ignores a uid in the saved data", async () => {
    await saveAuthConfig({ oidc: [oidc()] });
    const uid = await savedUid();
    await saveAuthConfig({ oidc: [oidc({ uid: "chosen-by-client" })] });
    expect(await savedUid()).toBe(uid);
  });

  test("is not inherited by a provider added under a deleted provider's id", async () => {
    await saveAuthConfig({ oidc: [oidc()] });
    const uid = await savedUid();
    await saveAuthConfig({ oidc: [] });
    expect(store.has("auth:oidc:oidc-1:uid")).toBe(false);
    await saveAuthConfig({ oidc: [oidc()] });
    expect(await savedUid()).not.toBe(uid);
  });

  test("is replaced when a new provider lands on a leftover uid key", async () => {
    store.set("auth:oidc:oidc-1:uid", "leftover");
    await saveAuthConfig({ oidc: [oidc()] });
    expect(await savedUid()).not.toBe("leftover");
  });

  test("is assigned on the next save to a provider stored without one", async () => {
    await saveAuthConfig({ oidc: [oidc()] });
    store.delete("auth:oidc:oidc-1:uid");
    await saveAuthConfig({ oidc: [oidc()] });
    expect(await savedUid()).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("stored secret and TLS settings", () => {
  beforeEach(() => store.clear());

  const ldap = (overrides: Record<string, unknown> = {}) =>
    ({
      id: "ldap-1",
      label: "LDAP",
      url: "ldaps://ldap.example.com",
      bindDn: "cn=admin,dc=example,dc=com",
      ssl: true,
      sslInsecure: false,
      sslCa: "",
      passwordSet: true,
      ...overrides,
    }) as any;

  test("an LDAP bind password is reused while the TLS settings match", async () => {
    await saveAuthConfig({ ldap: [ldap({ password: "bind-secret" })] });
    expect(await storedLDAPPassword(ldap())).toBe("bind-secret");
    expect(await providersNeedingSecretReentry({ ldap: [ldap()] })).toEqual([]);
  });

  test.each([{ sslInsecure: true }, { ssl: false }, { sslCa: "other-ca" }])(
    "an LDAP bind password is not reused after %o",
    async (change) => {
      await saveAuthConfig({ ldap: [ldap({ password: "bind-secret" })] });
      expect(await storedLDAPPassword(ldap(change))).toBeUndefined();
      expect(await providersNeedingSecretReentry({ ldap: [ldap(change)] })).toEqual(["LDAP"]);
    },
  );

  test("an OIDC client secret is not reused once certificate checks are switched off", async () => {
    const saved = oidc({ sslInsecure: false, secretSet: true });
    await saveAuthConfig({ oidc: [{ ...saved, secret: "client-secret" }] });
    expect(await storedOIDCSecret(saved)).toBe("client-secret");
    expect(await storedOIDCSecret({ ...saved, sslInsecure: true })).toBeUndefined();
    expect(await providersNeedingSecretReentry({ oidc: [{ ...saved, sslInsecure: true }] })).toEqual(["OIDC"]);
  });
});

describe("fallback email domain", () => {
  beforeEach(() => store.clear());

  test("a save that does not carry it keeps the stored value", async () => {
    const ldap = { id: "openldap-1", label: "LDAP", url: "ldaps://ldap.example.com", bindDn: "cn=admin" } as any;
    await saveAuthConfig({ ldap: [ldap] });
    store.set("auth:ldap:openldap-1:fallbackEmailDomain", "example.com");
    await saveAuthConfig({ ldap: [{ ...ldap, label: "Renamed" }] });
    expect((await loadAuthConfig()).ldap[0].fallbackEmailDomain).toBe("example.com");
  });
});
