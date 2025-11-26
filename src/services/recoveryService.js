import { nodes } from "../config/db.js";
import { applyLogToNode } from "../utils/applyLog.js";

async function getMaxLogId(pool) {
  const [[row]] = await pool.query(`SELECT MAX(id) AS maxId FROM Logs`);
  return row.maxId || 0;
}

async function getLogsSince(pool, sinceId) {
  const [rows] = await pool.query(
    `SELECT * FROM Logs WHERE id > ? ORDER BY id ASC`,
    [sinceId]
  );
  return rows;
}

async function syncPair(a, b) {
  const maxA = await getMaxLogId(a.pool);
  const maxB = await getMaxLogId(b.pool);

  const missingOnB = await getLogsSince(a.pool, maxB);
  for (const log of missingOnB) await applyLogToNode(b.pool, log);

  const missingOnA = await getLogsSince(b.pool, maxA);
  for (const log of missingOnA) await applyLogToNode(a.pool, log);

  return {
    syncedAtoB: missingOnB.length,
    syncedBtoA: missingOnA.length,
  };
}

export async function recoverNodes() {
  const r12 = await syncPair(nodes.node1, nodes.node2);
  const r13 = await syncPair(nodes.node1, nodes.node3);

  return {
    node1_node2: r12,
    node1_node3: r13,
    timestamp: new Date().toISOString(),
  };
}
