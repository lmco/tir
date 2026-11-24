import { beforeEach, describe, expect, test, vi } from "vitest";
import { loadAuthConfig, saveAuthConfig } from "../../../server/utils/config/authConfig";

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
