import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

function createPool(host: string, port: number) {
  const pool = mysql.createPool({
    host,
    port,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: 10,
  });

  // enforce REPEATABLE READ
  pool.getConnection().then((conn) => {
    conn.query("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    conn.release();
  });

  return pool;
}

export const node1Pool = createPool(process.env.NODE1_HOST!, Number(process.env.NODE1_PORT));
export const node2Pool = createPool(process.env.NODE2_HOST!, Number(process.env.NODE2_PORT));
export const node3Pool = createPool(process.env.NODE3_HOST!, Number(process.env.NODE3_PORT));

export const nodes = {
  node1: { name: "node1", pool: node1Pool },
  node2: { name: "node2", pool: node2Pool },
  node3: { name: "node3", pool: node3Pool },
};
