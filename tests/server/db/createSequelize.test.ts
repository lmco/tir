import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Sequelize } from "sequelize";
import { afterEach, describe, expect, test } from "vitest";

import { createSequelize } from "../../../db/createSequelize.js";

describe("createSequelize", () => {
  let dir: string;
  let sequelize: Sequelize;

  afterEach(async () => {
    await sequelize?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("opens sqlite in WAL mode with a busy timeout", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "tir-sqlite-"));
    sequelize = createSequelize(
      { dialect: "sqlite", storage: path.join(dir, "test.sqlite") },
      { logging: false },
    );

    const [journal] = await sequelize.query("PRAGMA journal_mode");
    const [timeout] = await sequelize.query("PRAGMA busy_timeout");

    expect(journal).toEqual([{ journal_mode: "wal" }]);
    expect(timeout).toEqual([{ timeout: 5000 }]);
  });

  test("applies the same pragmas to a transaction's connection", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "tir-sqlite-"));
    sequelize = createSequelize(
      { dialect: "sqlite", storage: path.join(dir, "test.sqlite") },
      { logging: false },
    );

    const transaction = await sequelize.transaction();
    const [timeout] = await sequelize.query("PRAGMA busy_timeout", { transaction });
    await transaction.rollback();

    expect(timeout).toEqual([{ timeout: 5000 }]);
  });

  test("starts sqlite transactions as IMMEDIATE", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "tir-sqlite-"));
    const statements: string[] = [];
    sequelize = createSequelize(
      { dialect: "sqlite", storage: path.join(dir, "test.sqlite") },
      { logging: (sql: string) => statements.push(sql) },
    );

    const transaction = await sequelize.transaction();
    await transaction.rollback();

    expect(statements.some((sql) => sql.includes("BEGIN IMMEDIATE TRANSACTION"))).toBe(true);
  });
});
