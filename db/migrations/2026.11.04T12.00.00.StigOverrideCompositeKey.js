import { DataTypes } from "sequelize";

const indexName = "StigOverrides_type_StigDatumId_SystemId_unique";
const duplicateTableName = "StigOverrideCompositeKeyDuplicates";

// Select one winner per identity: same-value rows prefer the highest id;
// conflicting values prefer the newest lastUpdate, then the highest id.
const duplicateIds = (table) => `
  SELECT id
  FROM (
    SELECT
      overrides.id,
      ROW_NUMBER() OVER (
        PARTITION BY overrides.type, overrides."SystemId", overrides."StigDatumId"
        ORDER BY
          CASE WHEN value_counts.distinct_value_count = 1 THEN overrides.id END DESC,
          CASE WHEN value_counts.distinct_value_count > 1 THEN overrides."lastUpdate" END DESC,
          overrides.id DESC
      ) AS duplicate_rank
    FROM ${table} AS overrides
    INNER JOIN (
      SELECT type, "SystemId", "StigDatumId", COUNT(DISTINCT value) AS distinct_value_count
      FROM ${table}
      GROUP BY type, "SystemId", "StigDatumId"
    ) AS value_counts
      ON value_counts.type = overrides.type
      AND value_counts."SystemId" = overrides."SystemId"
      AND value_counts."StigDatumId" = overrides."StigDatumId"
  ) ranked
  WHERE duplicate_rank > 1
`;

// Rows without both foreign keys cannot satisfy the new required identity.
const rowsToArchive = (table) => `
  SELECT id
  FROM ${table}
  WHERE "SystemId" IS NULL OR "StigDatumId" IS NULL
  UNION
  ${duplicateIds(table)}
`;

const overrideColumns = `id, type, value, "lastUpdate", "creationDate", "SystemId", "StigDatumId"`;

const sqliteOverridesTable = (tableName, keysRequired) => {
  const required = keysRequired ? " NOT NULL" : "";
  return `
    CREATE TABLE "${tableName}" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      value TEXT NOT NULL,
      "lastUpdate" TEXT NOT NULL,
      "creationDate" TEXT NOT NULL,
      "SystemId" INTEGER${required} REFERENCES "Systems" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      "StigDatumId" INTEGER${required} REFERENCES "StigData" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `;
};

const preserveSqliteSequence = async (sequelize, maxId, transaction) => {
  await sequelize.query(`
    UPDATE sqlite_sequence
    SET seq = MAX(seq, :maxId)
    WHERE name = 'StigOverrides'
  `, { replacements: { maxId }, transaction });
  await sequelize.query(`
    INSERT INTO sqlite_sequence (name, seq)
    SELECT 'StigOverrides', :maxId
    WHERE NOT EXISTS (
      SELECT 1 FROM sqlite_sequence WHERE name = 'StigOverrides'
    )
  `, { replacements: { maxId }, transaction });
};

const sqliteHighWaterMark = async (sequelize, table, transaction) => {
  const [rows] = await sequelize.query(`
    SELECT MAX(
      COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'StigOverrides'), 0),
      COALESCE(MAX(id), 0)
    ) AS "maxId"
    FROM ${table}
  `, { transaction });
  return Number(rows[0].maxId);
};

export const up = async ({ context: sequelize }) => {
  const schemaPrefix = sequelize.getDialect() === "postgres" ? "public." : "";
  const table = `${schemaPrefix}"StigOverrides"`;
  const duplicateTable = `${schemaPrefix}"${duplicateTableName}"`;
  const queryInterface = sequelize.getQueryInterface();
  let transaction;
  let sqliteMaxId = 0;

  try {
    transaction = await sequelize.transaction();
    if (sequelize.getDialect() === "sqlite") {
      sqliteMaxId = await sqliteHighWaterMark(sequelize, table, transaction);
    }

    // Keep removed rows so down can restore the pre-migration data.
    await queryInterface.createTable(duplicateTableName, {
      id: { type: DataTypes.INTEGER, primaryKey: true, allowNull: false },
      type: { type: DataTypes.TEXT, allowNull: false },
      value: { type: DataTypes.TEXT, allowNull: false },
      lastUpdate: { type: DataTypes.TEXT, allowNull: false },
      creationDate: { type: DataTypes.TEXT, allowNull: false },
      SystemId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Systems", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      StigDatumId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "StigData", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
    }, { transaction });

    // Archive invalid and duplicate rows before enforcing the identity constraints.
    await sequelize.query(`
      INSERT INTO ${duplicateTable} (
        id, type, value, "lastUpdate", "creationDate", "SystemId", "StigDatumId"
      )
      SELECT id, type, value, "lastUpdate", "creationDate", "SystemId", "StigDatumId"
      FROM ${table}
      WHERE id IN (${rowsToArchive(table)})
    `, { transaction });

    await sequelize.query(`
      DELETE FROM ${table}
      WHERE id IN (${rowsToArchive(table)})
    `, { transaction });

    // PostgreSQL can change nullability in place; SQLite rebuilds the table.
    if (sequelize.getDialect() === "postgres") {
      await sequelize.query(`
        ALTER TABLE ${table}
          ALTER COLUMN "SystemId" SET NOT NULL,
          ALTER COLUMN "StigDatumId" SET NOT NULL
      `, { transaction });
    }
    if (sequelize.getDialect() === "sqlite") {
      await sequelize.query(sqliteOverridesTable("StigOverrides_rebuild", true), { transaction });
      await sequelize.query(`
        INSERT INTO "StigOverrides_rebuild" (${overrideColumns})
        SELECT ${overrideColumns} FROM "StigOverrides"
      `, { transaction });
      await queryInterface.dropTable("StigOverrides", { transaction });
      await queryInterface.renameTable("StigOverrides_rebuild", "StigOverrides", { transaction });
      await preserveSqliteSequence(sequelize, sqliteMaxId, transaction);
    }

    // Enforce one active row per (type, StigDatumId, SystemId).
    await queryInterface.addIndex(
      "StigOverrides",
      ["type", "StigDatumId", "SystemId"],
      { name: indexName, unique: true, transaction },
    );
    await transaction.commit();
  } catch (error) {
    if (transaction) {
      await transaction.rollback();
    }
    throw error;
  }
};

export const down = async ({ context: sequelize }) => {
  const schemaPrefix = sequelize.getDialect() === "postgres" ? "public." : "";
  const table = `${schemaPrefix}"StigOverrides"`;
  const duplicateTable = `${schemaPrefix}"${duplicateTableName}"`;
  const queryInterface = sequelize.getQueryInterface();
  let transaction;

  try {
    transaction = await sequelize.transaction();
    let sqliteMaxId = 0;
    if (sequelize.getDialect() === "sqlite") {
      sqliteMaxId = await sqliteHighWaterMark(sequelize, table, transaction);
    }
    // Remove the uniqueness rule and make both identity columns nullable again.
    await queryInterface.removeIndex("StigOverrides", indexName, { transaction });
    if (sequelize.getDialect() === "postgres") {
      await sequelize.query(`
        ALTER TABLE ${table}
          ALTER COLUMN "StigDatumId" DROP NOT NULL,
          ALTER COLUMN "SystemId" DROP NOT NULL
      `, { transaction });
      await sequelize.query(`
        INSERT INTO ${table} (${overrideColumns})
        SELECT ${overrideColumns} FROM ${duplicateTable}
      `, { transaction });
      await queryInterface.dropTable(duplicateTableName, { transaction });
    }
    if (sequelize.getDialect() === "sqlite") {
      await sequelize.query(sqliteOverridesTable("StigOverrides_rebuild", false), { transaction });
      await sequelize.query(`
        INSERT INTO "StigOverrides_rebuild" (${overrideColumns})
        SELECT ${overrideColumns} FROM "StigOverrides"
      `, { transaction });
      await sequelize.query(`
        INSERT INTO "StigOverrides_rebuild" (${overrideColumns})
        SELECT ${overrideColumns} FROM "${duplicateTableName}"
      `, { transaction });
      await queryInterface.dropTable("StigOverrides", { transaction });
      await queryInterface.renameTable("StigOverrides_rebuild", "StigOverrides", { transaction });
      await queryInterface.dropTable(duplicateTableName, { transaction });
      await preserveSqliteSequence(sequelize, sqliteMaxId, transaction);
    }

    await transaction.commit();
  } catch (error) {
    if (transaction) {
      await transaction.rollback();
    }
    throw error;
  }
};