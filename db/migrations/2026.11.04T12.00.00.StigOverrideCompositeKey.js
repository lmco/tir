import { DataTypes } from "sequelize";

const indexName = "StigOverrides_type_StigDatumId_SystemId_unique";
const duplicateTableName = "StigOverrideCompositeKeyDuplicates";

const duplicateIds = (table) => `
  SELECT id
  FROM (
    SELECT
      overrides.id,
      ROW_NUMBER() OVER (
        PARTITION BY overrides.type, overrides."SystemId", overrides."StigDatumId"
        ORDER BY overrides."lastUpdate" DESC, overrides.id DESC
      ) AS duplicate_rank
    FROM ${table} AS overrides
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

// SQLite needs a table rebuild to change nullability; this definition keeps both cascade FKs.
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

// SQLite rebuilds reset AUTOINCREMENT, so retain its previous high-water mark.
const preserveSqliteSequence = async (sequelize, maxId) => {
  await sequelize.query(
    `
    UPDATE sqlite_sequence
    SET seq = MAX(seq, :maxId)
    WHERE name = 'StigOverrides'
  `,
    { replacements: { maxId } },
  );
  await sequelize.query(
    `
    INSERT INTO sqlite_sequence (name, seq)
    SELECT 'StigOverrides', :maxId
    WHERE NOT EXISTS (
      SELECT 1 FROM sqlite_sequence WHERE name = 'StigOverrides'
    )
  `,
    { replacements: { maxId } },
  );
};

// Read the greater of the stored sequence and current maximum ID before rebuilding.
const sqliteHighWaterMark = async (sequelize, table) => {
  // Query both values so deleted IDs are not reused after the rebuild.
  const [rows] = await sequelize.query(`
    SELECT MAX(
      COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'StigOverrides'), 0),
      COALESCE(MAX(id), 0)
    ) AS "maxId"
    FROM ${table}
  `);
  return Number(rows[0].maxId);
};

export const up = async ({ context: sequelize }) => {
  const schemaPrefix = sequelize.getDialect() === "postgres" ? "public." : "";
  const table = `${schemaPrefix}"StigOverrides"`;
  const duplicateTable = `${schemaPrefix}"${duplicateTableName}"`;
  const queryInterface = sequelize.getQueryInterface();
  let sqliteMaxId = 0;

  if (sequelize.getDialect() === "sqlite") {
    sqliteMaxId = await sqliteHighWaterMark(sequelize, table);
  }

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
  });

  await sequelize.query(`
      INSERT INTO ${duplicateTable} (
        id, type, value, "lastUpdate", "creationDate", "SystemId", "StigDatumId"
      )
      SELECT id, type, value, "lastUpdate", "creationDate", "SystemId", "StigDatumId"
      FROM ${table}
      WHERE id IN (${rowsToArchive(table)})
    `);

  await sequelize.query(`
      DELETE FROM ${table}
      WHERE id IN (SELECT id FROM ${duplicateTable})
    `);

  // PostgreSQL can change nullability in place; SQLite rebuilds the table.
  if (sequelize.getDialect() === "postgres") {
    await sequelize.query(`
        ALTER TABLE ${table}
          ALTER COLUMN "SystemId" SET NOT NULL,
          ALTER COLUMN "StigDatumId" SET NOT NULL
      `);
  }
  if (sequelize.getDialect() === "sqlite") {
    await sequelize.query(sqliteOverridesTable("StigOverrides_rebuild", true));
    await sequelize.query(`
        INSERT INTO "StigOverrides_rebuild" (${overrideColumns})
        SELECT ${overrideColumns} FROM "StigOverrides"
      `);
    await queryInterface.dropTable("StigOverrides");
    await queryInterface.renameTable("StigOverrides_rebuild", "StigOverrides");
    await preserveSqliteSequence(sequelize, sqliteMaxId);
  }

  // Enforce one active row per (type, StigDatumId, SystemId).
  await queryInterface.addIndex("StigOverrides", ["type", "StigDatumId", "SystemId"], {
    name: indexName,
    unique: true,
  });
};

export const down = async ({ context: sequelize }) => {
  const schemaPrefix = sequelize.getDialect() === "postgres" ? "public." : "";
  const table = `${schemaPrefix}"StigOverrides"`;
  const duplicateTable = `${schemaPrefix}"${duplicateTableName}"`;
  const queryInterface = sequelize.getQueryInterface();

  // Preserve SQLite's existing AUTOINCREMENT high-water mark through the rollback rebuild.
  let sqliteMaxId = 0;
  if (sequelize.getDialect() === "sqlite") {
    sqliteMaxId = await sqliteHighWaterMark(sequelize, table);
  }
  await queryInterface.removeIndex("StigOverrides", indexName);
  if (sequelize.getDialect() === "postgres") {
    await sequelize.query(`
        ALTER TABLE ${table}
          ALTER COLUMN "StigDatumId" DROP NOT NULL,
          ALTER COLUMN "SystemId" DROP NOT NULL
      `);
    await sequelize.query(`
        INSERT INTO ${table} (${overrideColumns})
        SELECT ${overrideColumns} FROM ${duplicateTable}
      `);
    await queryInterface.dropTable(duplicateTableName);
  }
  if (sequelize.getDialect() === "sqlite") {
    await sequelize.query(sqliteOverridesTable("StigOverrides_rebuild", false));
    await sequelize.query(`
        INSERT INTO "StigOverrides_rebuild" (${overrideColumns})
        SELECT ${overrideColumns} FROM "StigOverrides"
      `);
    await sequelize.query(`
        INSERT INTO "StigOverrides_rebuild" (${overrideColumns})
        SELECT ${overrideColumns} FROM "${duplicateTableName}"
      `);
    await queryInterface.dropTable("StigOverrides");
    await queryInterface.renameTable("StigOverrides_rebuild", "StigOverrides");
    await queryInterface.dropTable(duplicateTableName);
    await preserveSqliteSequence(sequelize, sqliteMaxId);
  }
};
