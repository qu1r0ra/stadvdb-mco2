import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

function createPool(host?: string, port?: string, db?: string, user?: string, pass?: string) {
  if (!host || !port || !db || !user) {
    throw new Error("DB connection env missing (host/port/db/user).");
  }
  return mysql.createPool({
    host,
    port: parseInt(port, 10),
    user,
    password: pass,
    database: db,
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: true
  });
}

export const node1 = createPool(
  process.env.NODE1_HOST,
  process.env.NODE1_PORT,
  process.env.NODE1_DB,
  process.env.NODE1_USER,
  process.env.NODE1_PASS
);

export const node2 = createPool(
  process.env.NODE2_HOST,
  process.env.NODE2_PORT,
  process.env.NODE2_DB,
  process.env.NODE2_USER,
  process.env.NODE2_PASS
);

export const node3 = createPool(
  process.env.NODE3_HOST,
  process.env.NODE3_PORT,
  process.env.NODE3_DB,
  process.env.NODE3_USER,
  process.env.NODE3_PASS
);

export const sourceDB = createPool(
  process.env.SOURCE_HOST || process.env.NODE1_HOST,
  process.env.SOURCE_PORT || process.env.NODE1_PORT,
  process.env.SOURCE_DB || process.env.NODE1_DB,
  process.env.SOURCE_USER || process.env.NODE1_USER,
  process.env.SOURCE_PASS || process.env.NODE1_PASS
);
