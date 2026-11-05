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

const rowsToArchive = (table) => `
  SELECT id
  FROM ${table}
  WHERE "SystemId" IS NULL OR "StigDatumId" IS NULL
  UNION
  ${duplicateIds(table)}
`;

export const up = async ({ context: sequelize }) => {
  const schemaPrefix = sequelize.getDialect() === "postgres" ? "public." : "";
  const table = `${schemaPrefix}"StigOverrides"`;
  const duplicateTable = `${schemaPrefix}"${duplicateTableName}"`;
  const queryInterface = sequelize.getQueryInterface();
  const transaction = await sequelize.transaction();

  try {
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

    if (sequelize.getDialect() === "postgres") {
      await sequelize.query(`
        ALTER TABLE ${table}
          ALTER COLUMN "SystemId" SET NOT NULL,
          ALTER COLUMN "StigDatumId" SET NOT NULL
      `, { transaction });
    } else {
      await queryInterface.changeColumn("StigOverrides", "SystemId", {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Systems", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      }, { transaction });
      await queryInterface.changeColumn("StigOverrides", "StigDatumId", {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "StigData", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      }, { transaction });
    }

    await queryInterface.addIndex(
      "StigOverrides",
      ["type", "StigDatumId", "SystemId"],
      { name: indexName, unique: true, transaction },
    );
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

export const down = async ({ context: sequelize }) => {
  const queryInterface = sequelize.getQueryInterface();
  const transaction = await sequelize.transaction();

  try {
    await queryInterface.removeIndex("StigOverrides", indexName, { transaction });
    if (sequelize.getDialect() === "postgres") {
      await sequelize.query(`
        ALTER TABLE "StigOverrides"
          ALTER COLUMN "StigDatumId" DROP NOT NULL,
          ALTER COLUMN "SystemId" DROP NOT NULL
      `, { transaction });
    } else {
      await queryInterface.changeColumn("StigOverrides", "StigDatumId", {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "StigData", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      }, { transaction });
      await queryInterface.changeColumn("StigOverrides", "SystemId", {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Systems", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      }, { transaction });
    }

    await sequelize.query(`
      INSERT INTO "StigOverrides" (
        id, type, value, "lastUpdate", "creationDate", "SystemId", "StigDatumId"
      )
      SELECT id, type, value, "lastUpdate", "creationDate", "SystemId", "StigDatumId"
      FROM "${duplicateTableName}"
    `, { transaction });
    await queryInterface.dropTable(duplicateTableName, { transaction });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};