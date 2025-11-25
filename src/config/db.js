import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

function createPool(host, port, db, user, password) {
  const pool = mysql.createPool({
    host,
    port: Number(port),
    user,
    password,
    database: db,
    connectionLimit: 10,
  });

  // enforce REPEATABLE READ for each new connection
  pool.getConnection().then((conn) => {
    conn.query("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    conn.release();
  });

  return pool;
}

export const node1Pool = createPool(
  process.env.NODE1_HOST,
  process.env.NODE1_PORT,
  process.env.NODE1_DB,
  process.env.NODE1_USER,
  process.env.NODE1_PASSWORD
);

export const node2Pool = createPool(
  process.env.NODE2_HOST,
  process.env.NODE2_PORT,
  process.env.NODE2_DB,
  process.env.NODE2_USER,
  process.env.NODE2_PASSWORD
);

export const node3Pool = createPool(
  process.env.NODE3_HOST,
  process.env.NODE3_PORT,
  process.env.NODE3_DB,
  process.env.NODE3_USER,
  process.env.NODE3_PASSWORD
);

export const nodes = {
  node1: { name: "node1", pool: node1Pool },
  node2: { name: "node2", pool: node2Pool },
  node3: { name: "node3", pool: node3Pool },
};
