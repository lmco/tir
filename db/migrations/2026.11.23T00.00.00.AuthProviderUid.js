import { randomUUID } from "node:crypto";

// Providers saved before the identifier existed get one here. Providers saved
// afterwards get theirs from the server on their first save.
const PROVIDER_KINDS = ["ldap", "oidc", "oauth"];

async function readIndex(sequelize, indexKey, tx) {
  const [rows] = await sequelize.query(`SELECT value FROM "TirConfigs" WHERE key = :key`, {
    replacements: { key: indexKey },
    transaction: tx,
  });
  if (!rows.length) return [];
  try {
    return JSON.parse(rows[0].value);
  } catch {
    return [];
  }
}

async function insertIfAbsent(sequelize, key, value, now, tx) {
  await sequelize.query(
    `INSERT INTO "TirConfigs" (key, value, "lastUpdate", "creationDate")
     SELECT :key, :value, :now, :now
     WHERE NOT EXISTS (SELECT 1 FROM "TirConfigs" WHERE key = :key)`,
    { replacements: { key, value, now }, transaction: tx },
  );
}

export const up = async ({ context: sequelize }) => {
  const migration = await sequelize.transaction();
  try {
    const now = new Date().toISOString();
    for (const kind of PROVIDER_KINDS) {
      const ids = await readIndex(sequelize, `auth:${kind}:index`, migration);
      for (const id of ids) {
        await insertIfAbsent(sequelize, `auth:${kind}:${id}:uid`, randomUUID(), now, migration);
      }
    }
    await migration.commit();
  } catch (error) {
    await migration.rollback();
    throw error;
  }
};

export const down = async ({ context: sequelize }) => {
  await sequelize.query(`DELETE FROM "TirConfigs" WHERE key LIKE 'auth:%:uid'`);
};
