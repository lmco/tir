import { describe, expect, test, vi } from "vitest";
import { withLockoutGuardLock } from "../../../server/auth/lockoutGuardLock";

vi.mock("../../../db/models", () => ({
  User: { sequelize: { getDialect: () => "sqlite" } },
}));

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("withLockoutGuardLock", () => {
  test("runs overlapping changes one after another", async () => {
    const events: string[] = [];
    const change = (name: string, ms: number) => async () => {
      events.push(`${name} start`);
      await tick(ms);
      events.push(`${name} end`);
      return name;
    };
    const results = await Promise.all([
      withLockoutGuardLock(change("a", 30)),
      withLockoutGuardLock(change("b", 5)),
      withLockoutGuardLock(change("c", 1)),
    ]);
    expect(results).toEqual(["a", "b", "c"]);
    expect(events).toEqual(["a start", "a end", "b start", "b end", "c start", "c end"]);
  });

  test("a change that throws rejects its caller and does not block the next one", async () => {
    const failed = withLockoutGuardLock(() => Promise.reject(new Error("refused")));
    const next = withLockoutGuardLock(() => Promise.resolve("ok"));
    await expect(failed).rejects.toThrow("refused");
    await expect(next).resolves.toBe("ok");
  });
});
