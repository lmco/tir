import { DataTypes } from "sequelize";

const indexName = "StigOverrides_type_StigDatumId_SystemId_unique";
const duplicateTableName = "StigOverrideCompositeKeyDuplicates";

const hasTable = async (queryInterface, tableName, transaction) => {
  const tables = await queryInterface.showAllTables({ transaction });
  return tables.includes(tableName);
};

const hasIndex = async (queryInterface, tableName, indexName, transaction) => {
  const indexes = await queryInterface.showIndex(tableName, { transaction });
  return indexes.some((index) => index.name === indexName);
};

const areForeignKeysNotNull = async (queryInterface, tableName, transaction) => {
  const description = await queryInterface.describeTable(tableName, { transaction });
  return (
    description.SystemId?.allowNull === false &&
    description.StigDatumId?.allowNull === false
  );
};

const duplicateIds = (table) => `
  SELECT id
  FROM (
    SELECT
      overrides.id,
      ROW_NUMBER() OVER (
        PARTITION BY overrides.type, overrides."SystemId", overrides."StigDatumId"
        ORDER BY overrides.id DESC
      ) AS duplicate_rank
    FROM ${table} AS overrides
  ) ranked
  WHERE duplicate_rank > 1
`;

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
  await sequelize.query(
    `
    UPDATE sqlite_sequence
    SET seq = MAX(seq, :maxId)
    WHERE name = 'StigOverrides'
  `,
    { replacements: { maxId }, transaction },
  );
  await sequelize.query(
    `
    INSERT INTO sqlite_sequence (name, seq)
    SELECT 'StigOverrides', :maxId
    WHERE NOT EXISTS (
      SELECT 1 FROM sqlite_sequence WHERE name = 'StigOverrides'
    )
  `,
    { replacements: { maxId }, transaction },
  );
};

const sqliteHighWaterMark = async (sequelize, table, transaction) => {
  const [rows] = await sequelize.query(
    `
    SELECT MAX(
      COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'StigOverrides'), 0),
      COALESCE(MAX(id), 0)
    ) AS "maxId"
    FROM ${table}
  `,
    { transaction },
  );
  return Number(rows[0].maxId);
};

export const up = async ({ context: sequelize }) => {
  const dialect = sequelize.getDialect();
  const schemaPrefix = dialect === "postgres" ? "public." : "";
  const table = `${schemaPrefix}"StigOverrides"`;
  const duplicateTable = `${schemaPrefix}"${duplicateTableName}"`;
  const queryInterface = sequelize.getQueryInterface();

  const archiveExists = await hasTable(queryInterface, duplicateTableName);
  const keysNotNull = await areForeignKeysNotNull(queryInterface, "StigOverrides");
  const indexExists = await hasIndex(queryInterface, "StigOverrides", indexName);

  if (archiveExists && keysNotNull && indexExists) {
    return;
  }
  if ((!archiveExists && (keysNotNull || indexExists)) || (!keysNotNull && indexExists)) {
    throw new Error("STIG override migration is in an unexpected partial state.");
  }

  if (!archiveExists) {
    const archiveTransaction = await sequelize.transaction();
    try {
      await queryInterface.createTable(
        duplicateTableName,
        {
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
        },
        { transaction: archiveTransaction },
      );

      await sequelize.query(
        `
        INSERT INTO ${duplicateTable} (
          id, type, value, "lastUpdate", "creationDate", "SystemId", "StigDatumId"
        )
        SELECT id, type, value, "lastUpdate", "creationDate", "SystemId", "StigDatumId"
        FROM ${table}
        WHERE id IN (${rowsToArchive(table)})
      `,
        { transaction: archiveTransaction },
      );

      await sequelize.query(
        `
        DELETE FROM ${table}
        WHERE id IN (SELECT id FROM ${duplicateTable})
      `,
        { transaction: archiveTransaction },
      );

      await archiveTransaction.commit();
    } catch (error) {
      await archiveTransaction.rollback();
      throw error;
    }
  }

  if (!keysNotNull) {
    const schemaTransaction = await sequelize.transaction();
    try {
      if (dialect === "postgres") {
        await sequelize.query(
          `
          ALTER TABLE ${table}
            ALTER COLUMN "SystemId" SET NOT NULL,
            ALTER COLUMN "StigDatumId" SET NOT NULL
        `,
          { transaction: schemaTransaction },
        );
      }
      if (dialect === "sqlite") {
        const activeMaxId = await sqliteHighWaterMark(sequelize, table, schemaTransaction);
        const archiveMaxId = await sqliteHighWaterMark(
          sequelize,
          duplicateTable,
          schemaTransaction,
        );
        const sqliteMaxId = Math.max(activeMaxId, archiveMaxId);

        await sequelize.query(sqliteOverridesTable("StigOverrides_rebuild", true), {
          transaction: schemaTransaction,
        });
        await sequelize.query(
          `
          INSERT INTO "StigOverrides_rebuild" (${overrideColumns})
          SELECT ${overrideColumns} FROM "StigOverrides"
        `,
          { transaction: schemaTransaction },
        );
        await queryInterface.dropTable("StigOverrides", { transaction: schemaTransaction });
        await queryInterface.renameTable("StigOverrides_rebuild", "StigOverrides", {
          transaction: schemaTransaction,
        });
        await preserveSqliteSequence(sequelize, sqliteMaxId, schemaTransaction);
      }

      await schemaTransaction.commit();
    } catch (error) {
      await schemaTransaction.rollback();
      throw error;
    }
  }

  if (!indexExists) {
    const indexTransaction = await sequelize.transaction();
    try {
      await queryInterface.addIndex("StigOverrides", ["type", "StigDatumId", "SystemId"], {
        name: indexName,
        unique: true,
        transaction: indexTransaction,
      });
      await indexTransaction.commit();
    } catch (error) {
      await indexTransaction.rollback();
      throw error;
    }
  }
};

export const down = async ({ context: sequelize }) => {
  const dialect = sequelize.getDialect();
  const schemaPrefix = dialect === "postgres" ? "public." : "";
  const table = `${schemaPrefix}"StigOverrides"`;
  const duplicateTable = `${schemaPrefix}"${duplicateTableName}"`;
  const queryInterface = sequelize.getQueryInterface();

  const archiveExists = await hasTable(queryInterface, duplicateTableName);
  const keysNotNull = await areForeignKeysNotNull(queryInterface, "StigOverrides");
  const indexExists = await hasIndex(queryInterface, "StigOverrides", indexName);

  if (!archiveExists && !keysNotNull && !indexExists) {
    return;
  }
  if ((!archiveExists && (keysNotNull || indexExists)) || (!keysNotNull && indexExists)) {
    throw new Error("STIG override rollback is in an unexpected partial state.");
  }

  if (indexExists) {
    const indexTransaction = await sequelize.transaction();
    try {
      await queryInterface.removeIndex("StigOverrides", indexName, {
        transaction: indexTransaction,
      });
      await indexTransaction.commit();
    } catch (error) {
      await indexTransaction.rollback();
      throw error;
    }
  }

  if (keysNotNull) {
    const schemaTransaction = await sequelize.transaction();
    try {
      if (dialect === "postgres") {
        await sequelize.query(
          `
          ALTER TABLE ${table}
            ALTER COLUMN "StigDatumId" DROP NOT NULL,
            ALTER COLUMN "SystemId" DROP NOT NULL
        `,
          { transaction: schemaTransaction },
        );
      }

      if (dialect === "sqlite") {
        const activeMaxId = await sqliteHighWaterMark(sequelize, table, schemaTransaction);
        const archiveMaxId = await sqliteHighWaterMark(
          sequelize,
          duplicateTable,
          schemaTransaction,
        );
        const sqliteMaxId = Math.max(activeMaxId, archiveMaxId);

        await sequelize.query(sqliteOverridesTable("StigOverrides_rebuild", false), {
          transaction: schemaTransaction,
        });
        await sequelize.query(
          `
          INSERT INTO "StigOverrides_rebuild" (${overrideColumns})
          SELECT ${overrideColumns} FROM "StigOverrides"
        `,
          { transaction: schemaTransaction },
        );
        await queryInterface.dropTable("StigOverrides", { transaction: schemaTransaction });
        await queryInterface.renameTable("StigOverrides_rebuild", "StigOverrides", {
          transaction: schemaTransaction,
        });
        await preserveSqliteSequence(sequelize, sqliteMaxId, schemaTransaction);
      }

      await schemaTransaction.commit();
    } catch (error) {
      await schemaTransaction.rollback();
      throw error;
    }
  }

  if (archiveExists) {
    const restoreTransaction = await sequelize.transaction();
    try {
      await sequelize.query(
        `
        INSERT INTO ${table} (${overrideColumns})
        SELECT ${overrideColumns} FROM ${duplicateTable}
      `,
        { transaction: restoreTransaction },
      );

      if (dialect === "sqlite") {
        const sqliteMaxId = await sqliteHighWaterMark(sequelize, table, restoreTransaction);
        await preserveSqliteSequence(sequelize, sqliteMaxId, restoreTransaction);
      }

      await queryInterface.dropTable(duplicateTableName, { transaction: restoreTransaction });
      await restoreTransaction.commit();
    } catch (error) {
      await restoreTransaction.rollback();
      throw error;
    }
  }
};