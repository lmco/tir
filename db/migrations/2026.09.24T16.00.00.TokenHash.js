import { DataTypes } from "sequelize";

const timestamps = {
  lastUpdate: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  creationDate: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  UserId: {
    type: DataTypes.INTEGER,
    references: {
      model: "Users",
      key: "id",
    },
    onUpdate: "CASCADE",
    onDelete: "CASCADE",
  },
};

// Every row created by the placeholder implementation holds the same literal
// string and never authenticated anything, so the table is rebuilt rather than
// migrated in place.
export const up = async ({ context: sequelize }) => {
  const queryInterface = sequelize.getQueryInterface();
  await queryInterface.dropTable("Tokens");
  await queryInterface.createTable("Tokens", {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      autoIncrement: true,
    },
    name: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    prefix: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    tokenHash: {
      type: DataTypes.TEXT,
      allowNull: false,
      unique: true,
    },
    expiresAt: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    lastUsedAt: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    ...timestamps,
  });
};

export const down = async ({ context: sequelize }) => {
  const queryInterface = sequelize.getQueryInterface();
  await queryInterface.dropTable("Tokens");
  await queryInterface.createTable("Tokens", {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      autoIncrement: true,
    },
    name: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    token: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    date: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    ...timestamps,
  });
};
