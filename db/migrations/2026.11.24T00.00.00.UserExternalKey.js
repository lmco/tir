import { DataTypes } from "sequelize";

export const up = async ({ context: sequelize }) => {
  await sequelize.getQueryInterface().addColumn("Users", "externalKey", {
    type: DataTypes.TEXT,
    allowNull: true,
  });
};

// Raw DROP COLUMN because queryInterface.removeColumn rebuilds the table on
// SQLite, and that DROP TABLE cascades into the tables that reference Users.
export const down = async ({ context: sequelize }) => {
  await sequelize.query('ALTER TABLE "Users" DROP COLUMN "externalKey";');
};
