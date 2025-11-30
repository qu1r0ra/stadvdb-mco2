import { nodes } from "../config/db.js";
import { applyLogToNode as applyLogToNodeImported } from "../utils/applyLogNew.js";
import sleep from "../utils/sleep.js";
import { info, warn, error } from "../utils/logger.js";

console.error(">>> recoveryService.js loaded <<<");
console.error(">>> applyLogToNode source:", applyLogToNodeImported.toString());

const BATCH_SIZE = 100;
const APPLY_ATTEMPTS = 3; // number of attempts to apply a single log
const BACKOFF_BASE_MS = 100; // backoff base for retries (100ms -> 300ms -> 900ms style)

/**
 * Fetch a page of pending logs from `source.pool`.
 * Only returns logs with status = 'pending', ordered ASC by id.
 *
 * Note: Partition filtering removed for master-slave architecture.
 * Node 1 replicates all logs to Node 2/3 during normal operation.
 */
export async function getPendingLogsFromSource(source, targetName, limit = BATCH_SIZE) {
  let filterClause = "";

  // If pulling FROM node1, we must filter based on the target node's partition responsibility
  if (source.name === "node1") {
    if (targetName === "node2") {
      // Node 2 only wants JNT
      filterClause = `
        AND (
          (new_value IS NOT NULL AND JSON_UNQUOTE(JSON_EXTRACT(new_value, '$.courierName')) = 'JNT')
          OR
          (new_value IS NULL AND JSON_UNQUOTE(JSON_EXTRACT(old_value, '$.courierName')) = 'JNT')
        )
      `;
    } else if (targetName === "node3") {
      // Node 3 wants everything EXCEPT JNT
      filterClause = `
        AND (
          (new_value IS NOT NULL AND JSON_UNQUOTE(JSON_EXTRACT(new_value, '$.courierName')) != 'JNT')
          OR
          (new_value IS NULL AND JSON_UNQUOTE(JSON_EXTRACT(old_value, '$.courierName')) != 'JNT')
        )
      `;
    }
  }

  const sql = `SELECT * FROM Logs WHERE status = 'pending' ${filterClause} ORDER BY id ASC LIMIT ?`;
  const [rows] = await source.pool.query(sql, [limit]);
  return rows;
}

/**
 * write replication diagnostic into ReplicationErrors table (best-effort)
 */
async function recordReplicationError(
  source,
  target,
  logId,
  attempts,
  lastError
) {
  try {
    await source.pool.query(
      `INSERT INTO ReplicationErrors (log_id, source_node, target_node, attempts, last_error, last_error_time)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE attempts = GREATEST(attempts, VALUES(attempts)), last_error = VALUES(last_error), last_error_time = CURRENT_TIMESTAMP`,
      [logId, source.name, target.name, attempts, String(lastError)]
    );
  } catch (err) {
    // best-effort only
    console.error("recordReplicationError failed:", err);
  }
}

/**
 * applyWithRetries: try applying a single log to target.pool with retries & backoff.
 * On final failure it marks the source log as 'failed' and records an error row.
 */
async function applyWithRetries(source, target, log) {
  let attempts = 0;
  let lastErr = null;

  while (attempts < APPLY_ATTEMPTS) {
    attempts++;
    const res = await applyLogToNodeImported(target.pool, log);
    if (res.ok) return { ok: true, attempts };

    lastErr = res.error;
    const backoff = BACKOFF_BASE_MS * Math.pow(3, attempts - 1); // 100, 300, 900...
    await sleep(backoff);
  }

  // all attempts failed: mark failed and record diagnostic
  try {
    await source.pool.query(`UPDATE Logs SET status = 'failed' WHERE id = ?`, [
      log.id,
    ]);
  } catch (err) {
    console.error("Failed to mark log.failed on source:", err);
  }

  await recordReplicationError(source, target, log.id, attempts, lastErr);

  return { ok: false, attempts, error: lastErr };
}

/**
 * syncFromTo: pull-based single direction replication:
 * - sourceName: who owns the logs
 * - targetName: where to apply them
 *
 * Process pending logs in batches; mark replicated on source when successfully applied.
 * Returns { appliedCount, halted, reason }.
 */
async function syncFromTo(sourceName, targetName) {
  const source = nodes[sourceName];
  const target = nodes[targetName];
  if (!source || !target) throw new Error("invalid node names for syncFromTo");

  let appliedCount = 0;

  while (true) {
    const batch = await getPendingLogsFromSource(source, targetName, BATCH_SIZE);
    if (!batch || batch.length === 0) break;

    for (const log of batch) {
      const res = await applyWithRetries(source, target, log);
      if (res.ok) {
        // mark replicated on the source node
        try {
          await source.pool.query(
            `UPDATE Logs SET status = 'replicated' WHERE id = ?`,
            [log.id]
          );
        } catch (err) {
          // best-effort; log and continue
          console.error(
            "Failed to update Logs.status to replicated on source:",
            err
          );
        }
        appliedCount++;
      } else {
        error(
          `Replication halted: failed to apply log ${log.id} from ${source.name} -> ${target.name}`,
          res.error
        );
        return {
          appliedCount,
          halted: true,
          failedLogId: log.id,
          direction: `${sourceName}->${targetName}`,
          error: String(res.error),
        };
      }
    }

    // if batch was full, loop to fetch next batch; otherwise we're done
    if (batch.length < BATCH_SIZE) break;
  }

  return { appliedCount, halted: false };
}

/**
 * syncPair: convenience to run both directions between two nodes.
 * We still use the pull-style internal function above: we call source->target and then the reverse.
 */
export async function syncPair(aName, bName) {
  const aToB = await syncFromTo(aName, bName);
  if (aToB.halted)
    return {
      syncedAtoB: aToB.appliedCount,
      syncedBtoA: 0,
      halted: true,
      reason: aToB,
    };

  const bToA = await syncFromTo(bName, aName);
  if (bToA.halted)
    return {
      syncedAtoB: aToB.appliedCount,
      syncedBtoA: bToA.appliedCount,
      halted: true,
      reason: bToA,
    };

  return {
    syncedAtoB: aToB.appliedCount,
    syncedBtoA: bToA.appliedCount,
    halted: false,
  };
}

/**
 * recoverNodes: top-level sync for the cluster.
 * We run pairwise syncs for node1<->node2 and node1<->node3.
 * This effectively pulls logs so each node converges.
 */
export async function recoverNodes() {
  const r12 = await syncPair("node1", "node2");
  const r13 = await syncPair("node1", "node3");

  return {
    node1_node2: r12,
    node1_node3: r13,
    timestamp: new Date().toISOString(),
  };
}

/**
 * retryFailedLogs(sourceName, targetName)
 * - Admin endpoint: retry logs previously marked 'failed' on the source node.
 * - Will attempt to apply them to the target in ascending id order.
 */
export async function retryFailedLogs(sourceName, targetName) {
  const source = nodes[sourceName];
  const target = nodes[targetName];
  if (!source || !target) throw new Error("invalid node names");

  const [failedRows] = await source.pool.query(
    `SELECT * FROM Logs WHERE status = 'failed' ORDER BY id ASC LIMIT 1000`
  );

  let retried = 0;
  for (const log of failedRows) {
    const res = await applyWithRetries(source, target, log);
    if (res.ok) {
      // mark replicated
      try {
        await source.pool.query(
          `UPDATE Logs SET status = 'replicated' WHERE id = ?`,
          [log.id]
        );
      } catch (err) {
        console.error("Failed to mark log replicated after retry:", err);
      }
      retried++;
    } else {
      // record latest diagnostics (best-effort)
      await recordReplicationError(
        source,
        target,
        log.id,
        res.attempts,
        res.error
      );
    }
  }

  return {
    retried,
    checked: failedRows.length,
    timestamp: new Date().toISOString(),
  };
}
/**
 * checkConsistency: Verify that Node 1 data matches Node 2 + Node 3 combined.
 * - Fetches all riders from Node 1.
 * - Fetches all riders from Node 2 and Node 3.
 * - Compares counts and IDs.
 */
export async function checkConsistency() {
  const [r1] = await nodes.node1.pool.query("SELECT * FROM Riders ORDER BY id ASC");
  const [r2] = await nodes.node2.pool.query("SELECT * FROM Riders ORDER BY id ASC");
  const [r3] = await nodes.node3.pool.query("SELECT * FROM Riders ORDER BY id ASC");

  const node1Count = r1.length;
  const node2Count = r2.length;
  const node3Count = r3.length;

  let consistent = true;
  let details = [];

  // Build a full picture: Node 1 should contain all unique riders (by id+courierName)
  // Node 2+3 should partition them correctly
  const r1Map = new Map(r1.map(r => [`${r.id}-${r.courierName}`, r]));
  const r2Map = new Map(r2.map(r => [`${r.id}-${r.courierName}`, r]));
  const r3Map = new Map(r3.map(r => [`${r.id}-${r.courierName}`, r]));

  // Check if all Node 2/3 riders exist in Node 1
  for (const [key, rider] of r2Map) {
    if (!r1Map.has(key)) {
      consistent = false;
      details.push(`Rider ${key} exists in Node 2 but not in Node 1`);
    }
  }
  for (const [key, rider] of r3Map) {
    if (!r1Map.has(key)) {
      consistent = false;
      details.push(`Rider ${key} exists in Node 3 but not in Node 1`);
    }
  }

  // Check if all Node 1 riders exist in either Node 2 or Node 3
  for (const [key, rider] of r1Map) {
    const inNode2 = r2Map.has(key);
    const inNode3 = r3Map.has(key);
    if (!inNode2 && !inNode3) {
      consistent = false;
      details.push(`Rider ${key} exists in Node 1 but not in Node 2 or Node 3`);
    }
  }

  // Verify Partitioning (Node 2 = JNT, Node 3 = Non-JNT)
  const node2NonJNT = r2.filter(r => r.courierName !== 'JNT');
  const node3JNT = r3.filter(r => r.courierName === 'JNT');

  if (node2NonJNT.length > 0) {
    consistent = false;
    details.push(`Node 2 has non-JNT riders: ${node2NonJNT.map(r => `${r.id}(${r.courierName})`).join(', ')}`);
  }
  if (node3JNT.length > 0) {
    consistent = false;
    details.push(`Node 3 has JNT riders: ${node3JNT.map(r => `${r.id}(${r.courierName})`).join(', ')}`);
  }

  // Collect ID lists
  const r1Ids = r1.map(r => r.id);
  const r2Ids = r2.map(r => r.id);
  const r3Ids = r3.map(r => r.id);
  const slaveIds = [...r2Ids, ...r3Ids];

  return {
    consistent,
    counts: { node1: node1Count, node2: node2Count, node3: node3Count, combined: r2Map.size + r3Map.size },
    ids: { node1: r1Ids, node2: r2Ids, node3: r3Ids, slaves: slaveIds },
    details
  };
}
