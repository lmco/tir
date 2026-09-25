/* eslint-disable no-use-before-define */
import {
  Model,
  DataTypes,
  type InferAttributes,
  type InferCreationAttributes,
  type CreationOptional,
  type ForeignKey,
} from "sequelize";
import type { User } from "./user";

export class Token extends Model<InferAttributes<Token>, InferCreationAttributes<Token>> {
  declare id: CreationOptional<number>;
  declare name: string;
  declare prefix: string;
  declare tokenHash: string;
  declare expiresAt: string;
  declare lastUsedAt: CreationOptional<string | null>;
  declare lastUpdate: CreationOptional<string>;
  declare creationDate: CreationOptional<string>;
  declare UserId: ForeignKey<User["id"]>;
}

Token.init(
  {
    id: {
      type: DataTypes.INTEGER,
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
    lastUpdate: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    creationDate: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
  },
  {
    sequelize,
    modelName: "Token",
    timestamps: false,
  },
);
