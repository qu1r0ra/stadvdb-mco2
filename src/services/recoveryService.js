import { nodes } from "../config/db.js";
import { applyLogToNode } from "../utils/applyLog.js";
import sleep from "../utils/sleep.js";
import { info, warn, error } from "../utils/logger.js";

const BATCH_SIZE = 100;
const APPLY_ATTEMPTS = 3; // total attempts per log
const BACKOFF_BASE_MS = 100; // 100ms base (100, 300, 900)

// Notes for admin routes:
// Use /api/replication/replicate to run full recovery.
// Use /api/replication/replicate with body { "source": "node2", "target": "node1" } for pair sync.
// Use /api/replication/retry-failed to attempt retries.

async function getMaxLogId(pool) {
  const [[row]] = await pool.query(`SELECT MAX(id) AS maxId FROM Logs`);
  return row && row.maxId ? row.maxId : 0;
}

async function getLogsBatchSince(pool, sinceId, limit = BATCH_SIZE) {
  // Only pending logs; we don't want to reapply replicated/failed entries
  const [rows] = await pool.query(
    `SELECT * FROM Logs WHERE id > ? AND status = 'pending' ORDER BY id ASC LIMIT ?`,
    [sinceId, limit]
  );
  return rows;
}

async function recordReplicationError(
  source,
  target,
  logId,
  attempts,
  lastError
) {
  try {
    await source.pool.query(
      `INSERT INTO ReplicationErrors (log_id, source_node, target_node, attempts, last_error)
       VALUES (?, ?, ?, ?, ?)`,
      [logId, source.name, target.name, attempts, String(lastError)]
    );
  } catch (err) {
    // best effort
    console.error("Failed to insert into ReplicationErrors:", err);
  }
}

async function applyWithRetries(source, target, log) {
  let attempts = 0;
  let lastErr = null;

  while (attempts < APPLY_ATTEMPTS) {
    attempts++;
    const res = await applyLogToNode(target.pool, log);
    if (res.ok) return { ok: true, attempts };

    lastErr = res.error;
    const backoff = BACKOFF_BASE_MS * Math.pow(3, attempts - 1); // 100,300,900
    await sleep(backoff);
  }

  // all attempts failed -> record and mark failed
  await recordReplicationError(source, target, log.id, attempts, lastErr);

  try {
    await source.pool.query(`UPDATE Logs SET status = 'failed' WHERE id = ?`, [
      log.id,
    ]);
  } catch (err) {
    console.error("Failed to mark log as failed:", err);
  }

  return { ok: false, attempts, error: lastErr };
}

/**
 * syncPairNodes: replicate pending logs between two nodes (A <-> B),
 * processing A->B first in batches, then B->A.
 *
 * Returns an object describing counts and a halted indicator if a failure occurred.
 */
async function syncPairNodes(aName, bName) {
  const a = nodes[aName];
  const b = nodes[bName];
  if (!a || !b) throw new Error("Invalid node names for syncPairNodes");

  let syncedAtoB = 0;
  let syncedBtoA = 0;

  // A -> B
  let maxB = await getMaxLogId(b.pool);
  while (true) {
    const batch = await getLogsBatchSince(a.pool, maxB, BATCH_SIZE);
    if (!batch || batch.length === 0) break;

    for (const log of batch) {
      const res = await applyWithRetries(a, b, log);
      if (res.ok) {
        // mark replicated on source node (a)
        try {
          await a.pool.query(
            `UPDATE Logs SET status = 'replicated' WHERE id = ?`,
            [log.id]
          );
        } catch (err) {
          console.error("Failed to mark log replicated:", err);
        }
        syncedAtoB++;
        if (log.id > maxB) maxB = log.id;
      } else {
        error(
          `Failed to apply log ${log.id} from ${a.name} -> ${b.name}`,
          res.error
        );
        return {
          syncedAtoB,
          syncedBtoA,
          halted: true,
          failedLogId: log.id,
          direction: `${aName}->${bName}`,
        };
      }
    }
  }

  // B -> A
  let maxA = await getMaxLogId(a.pool);
  while (true) {
    const batch = await getLogsBatchSince(b.pool, maxA, BATCH_SIZE);
    if (!batch || batch.length === 0) break;

    for (const log of batch) {
      const res = await applyWithRetries(b, a, log);
      if (res.ok) {
        try {
          await b.pool.query(
            `UPDATE Logs SET status = 'replicated' WHERE id = ?`,
            [log.id]
          );
        } catch (err) {
          console.error("Failed to mark log replicated:", err);
        }
        syncedBtoA++;
        if (log.id > maxA) maxA = log.id;
      } else {
        error(
          `Failed to apply log ${log.id} from ${b.name} -> ${a.name}`,
          res.error
        );
        return {
          syncedAtoB,
          syncedBtoA,
          halted: true,
          failedLogId: log.id,
          direction: `${bName}->${aName}`,
        };
      }
    }
  }

  return { syncedAtoB, syncedBtoA, halted: false };
}

/**
 * recoverNodes: highest-level: run pairwise syncs
 * We sync node1 <-> node2 and node1 <-> node3.
 */
export async function recoverNodes() {
  const r12 = await syncPairNodes("node1", "node2");
  const r13 = await syncPairNodes("node1", "node3");

  return {
    node1_node2: r12,
    node1_node3: r13,
    timestamp: new Date().toISOString(),
  };
}

/**
 * retryFailedLogs: admin utility - retry logs in 'failed' state from source->target
 */
export async function retryFailedLogs(sourceName, targetName) {
  const source = nodes[sourceName];
  const target = nodes[targetName];
  if (!source || !target) throw new Error("invalid node names");

  // Fetch failed logs in ascending order to preserve ordering
  const [failedRows] = await source.pool.query(
    `SELECT * FROM Logs WHERE status = 'failed' ORDER BY id ASC`
  );

  let retried = 0;
  for (const log of failedRows) {
    const res = await applyWithRetries(source, target, log);
    if (res.ok) {
      await source.pool.query(
        `UPDATE Logs SET status = 'replicated' WHERE id = ?`,
        [log.id]
      );
      retried++;
    } else {
      // update ReplicationErrors with latest info (best-effort)
      try {
        await source.pool.query(
          `INSERT INTO ReplicationErrors (log_id, source_node, target_node, attempts, last_error)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE attempts = GREATEST(attempts, VALUES(attempts)), last_error = VALUES(last_error), last_error_time = CURRENT_TIMESTAMP`,
          [log.id, source.name, target.name, res.attempts, String(res.error)]
        );
      } catch (err) {
        console.error("Failed to update ReplicationErrors on retry:", err);
      }
    }
  }

  return {
    retried,
    checked: failedRows.length,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Expose sync for a specific pair via name if needed by the route
 */
export async function syncPair(aName, bName) {
  return await syncPairNodes(aName, bName);
}
