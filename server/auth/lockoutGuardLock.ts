import { User } from "../../db/models";

// Any fixed number works. Every lockout-guarded change takes the same Postgres advisory lock.
const ADVISORY_LOCK_KEY = 741_100_114;

let queue: Promise<unknown> = Promise.resolve();

/**
 * Runs one lockout-guarded change at a time, so its check and its write cannot interleave with
 * another's. Every caller must read the state it judges inside `change`.
 */
export function withLockoutGuardLock<T>(change: () => Promise<T>): Promise<T> {
  // One at a time in this process first. On SQLite that is the whole lock, and on Postgres it
  // keeps waiters from each holding a pooled connection while the holder needs one.
  const run = queue.then(
    () => acrossProcesses(change),
    () => acrossProcesses(change),
  );
  queue = run.catch(() => undefined);
  return run;
}

function acrossProcesses<T>(change: () => Promise<T>): Promise<T> {
  const sequelize = User.sequelize!;
  if (sequelize.getDialect() !== "postgres") return change();
  // The transaction exists only to hold the lock until `change` settles. The queries inside
  // `change` run on other connections and are not part of it.
  return sequelize.transaction(async (transaction) => {
    await sequelize.query("SELECT pg_advisory_xact_lock(:key)", {
      replacements: { key: ADVISORY_LOCK_KEY },
      transaction,
    });
    return change();
  });
}
