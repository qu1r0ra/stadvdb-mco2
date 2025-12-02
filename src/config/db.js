import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

// Global status to simulate failures
export const nodeStatus = {
  node1: true,
  node2: true,
  node3: true
};

function createPool(host, port, db, user, password, nodeKey) {
  const pool = mysql.createPool({
    host,
    port: Number(port),
    user,
    password,
    database: db,
    connectionLimit: 10,
  });

  // Wrapper to intercept query and simulate failure
  const originalGetConnection = pool.getConnection.bind(pool);
  pool.getConnection = async () => {
    if (nodeStatus[nodeKey] === false) {
      throw new Error(`Connection refused: ${nodeKey} is offline (Simulated)`);
    }
    return originalGetConnection();
  };

  // Also wrap direct query
  const originalQuery = pool.query.bind(pool);
  pool.query = async (...args) => {
    if (nodeStatus[nodeKey] === false) {
      throw new Error(`Connection refused: ${nodeKey} is offline (Simulated)`);
    }
    return originalQuery(...args);
  };

  return pool;
}

export const node1Pool = createPool(
  process.env.NODE1_HOST, process.env.NODE1_PORT, process.env.NODE1_DB, process.env.NODE1_USER, process.env.NODE1_PASSWORD, "node1"
);
export const node2Pool = createPool(
  process.env.NODE2_HOST, process.env.NODE2_PORT, process.env.NODE2_DB, process.env.NODE2_USER, process.env.NODE2_PASSWORD, "node2"
);
export const node3Pool = createPool(
  process.env.NODE3_HOST, process.env.NODE3_PORT, process.env.NODE3_DB, process.env.NODE3_USER, process.env.NODE3_PASSWORD, "node3"
);

export const nodes = {
  node1: { name: "node1", pool: node1Pool },
  node2: { name: "node2", pool: node2Pool },
  node3: { name: "node3", pool: node3Pool },
};