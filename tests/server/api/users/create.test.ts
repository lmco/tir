import { beforeEach, describe, expect, test, vi } from "vitest";

import handler from "../../../../server/api/users/create.post";

const models = vi.hoisted(() => ({
  User: { findOne: vi.fn(), findByPk: vi.fn(), create: vi.fn() },
  Timezone: { findOne: vi.fn() },
  UserRole: { findByPk: vi.fn() },
}));

vi.hoisted(() => {
  vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
  vi.stubGlobal("readBody", (event: { body: unknown }) => Promise.resolve(event.body));
  vi.stubGlobal("createError", (init: { statusCode: number; statusMessage: string }) =>
    Object.assign(new Error(init.statusMessage), init),
  );
  vi.stubGlobal("userCheck", vi.fn().mockResolvedValue({ UserRoleId: 1 }));
  vi.stubGlobal("getPasswordViolations", vi.fn().mockResolvedValue([]));
  vi.stubGlobal("useRuntimeConfig", () => ({ secret_key: "test-secret" }));
  vi.stubGlobal("generateSalt", () => "salt");
  vi.stubGlobal("hashPassword", () => "hashed");
  vi.stubGlobal("logger", { info: vi.fn(), error: vi.fn() });
});

vi.mock("../../../../db/models", () => models);

type Zone = { id: number; name: string };

const call = handler as unknown as (event: { body: Record<string, unknown> }) => Promise<any>;

const body = {
  firstName: "Test",
  lastName: "User",
  email: "test.user@example.test",
  UserRoleId: 2,
  password: "Str0ng!Passw0rd",
};

function seedTimezones(zones: Zone[]) {
  models.Timezone.findOne.mockImplementation((query: any = {}) => {
    const { where } = query;
    if (!where) return Promise.resolve(zones[0] ?? null);
    const names = Array.isArray(where.name) ? where.name : [where.name];
    return Promise.resolve(zones.find((zone) => names.includes(zone.name)) ?? null);
  });
}

describe("POST /api/users/create", () => {
  let created: Record<string, unknown> | null;

  beforeEach(() => {
    vi.clearAllMocks();
    created = null;
    models.User.findOne.mockResolvedValue(null);
    models.UserRole.findByPk.mockResolvedValue({ id: 2, name: "User" });
    models.User.create.mockImplementation((values: Record<string, unknown>) => {
      created = { id: 9, ...values };
      return Promise.resolve(created);
    });
    models.User.findByPk.mockImplementation((id: number, options: any) => {
      if (!created || created.id !== id) return Promise.resolve(null);
      const copy: Record<string, unknown> = { ...created };
      for (const key of options?.attributes?.exclude ?? []) delete copy[key];
      return Promise.resolve(copy);
    });
  });

  test("falls back to the first timezone when TimezoneName is omitted and no UTC zone exists", async () => {
    seedTimezones([
      { id: 1, name: "Africa/Abidjan" },
      { id: 2, name: "America/New_York" },
    ]);

    const user = await call({ body });

    expect(models.User.create).toHaveBeenCalledTimes(1);
    expect(models.User.create.mock.calls[0][0]).toMatchObject({ email: body.email, TimezoneId: 1 });
    expect(user).toMatchObject({ id: 9, email: body.email, TimezoneId: 1 });
    expect(user).not.toHaveProperty("password");
    expect(user).not.toHaveProperty("salt");
  });

  test("prefers a UTC zone as the default when one is seeded", async () => {
    seedTimezones([
      { id: 1, name: "Africa/Abidjan" },
      { id: 300, name: "UTC" },
    ]);

    await call({ body });

    expect(models.User.create.mock.calls[0][0]).toMatchObject({ TimezoneId: 300 });
  });

  test("uses the requested timezone when it exists", async () => {
    seedTimezones([
      { id: 1, name: "Africa/Abidjan" },
      { id: 2, name: "America/New_York" },
    ]);

    await call({ body: { ...body, TimezoneName: "America/New_York" } });

    expect(models.User.create.mock.calls[0][0]).toMatchObject({ TimezoneId: 2 });
  });

  test("rejects an unknown timezone with 400 and creates nothing", async () => {
    seedTimezones([{ id: 1, name: "Africa/Abidjan" }]);

    await expect(call({ body: { ...body, TimezoneName: "Mars/Olympus" } })).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(models.User.create).not.toHaveBeenCalled();
  });

  test("fails instead of answering 200 when no timezone is seeded", async () => {
    seedTimezones([]);

    await expect(call({ body })).rejects.toMatchObject({ statusCode: 500 });
    expect(models.User.create).not.toHaveBeenCalled();
  });
});
