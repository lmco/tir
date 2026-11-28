import { promisify } from "node:util";
import { Sequelize } from "sequelize";

const SQLITE_BUSY_TIMEOUT_MS = 5000;

export function createSequelize(dbConfig, options = {}) {
  if (dbConfig.dialect === "sqlite") {
    const sequelize = new Sequelize({ dialect: "sqlite", storage: dbConfig.storage, ...options });
    applySqlitePragmas(sequelize);
    return sequelize;
  }
  return new Sequelize(dbConfig.database, dbConfig.username, dbConfig.password, {
    dialect: "postgres",
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false,
      },
    },
    host: dbConfig.host,
    port: dbConfig.port,
    ...options,
  });
}

// Sequelize 6 opens one sqlite connection per transaction and never fires
// afterConnect for sqlite, so the pragmas have to be applied here.
function applySqlitePragmas(sequelize) {
  const manager = sequelize.connectionManager;
  const getConnection = manager.getConnection.bind(manager);
  manager.getConnection = async (connectionOptions) => {
    const connection = await getConnection(connectionOptions);
    if (connection.pragmasApplied) return connection;
    connection.pragmasApplied = true;
    const run = promisify(connection.run.bind(connection));
    await run(`PRAGMA busy_timeout=${SQLITE_BUSY_TIMEOUT_MS}`);
    await run("PRAGMA journal_mode=WAL");
    return connection;
  };
}
