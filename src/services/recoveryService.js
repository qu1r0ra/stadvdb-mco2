import { nodes } from "../config/db.js";
import { applyLogToNode } from "../utils/applyLog.js";
import sleep from "../utils/sleep.js";
import { info, warn, error } from "../utils/logger.js";

const BATCH_SIZE = 100;
const APPLY_ATTEMPTS = 3; // number of attempts to apply a single log
const BACKOFF_BASE_MS = 100; // backoff base for retries (100ms -> 300ms -> 900ms style)

/**
 * Fetch a page of pending logs from `source.pool`.
 * Only returns logs with status = 'pending', ordered ASC by id.
 */
async function getPendingLogsFromSource(source, limit = BATCH_SIZE) {
  const [rows] = await source.pool.query(
    `SELECT * FROM Logs WHERE status = 'pending' ORDER BY id ASC LIMIT ?`,
    [limit]
  );
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
    const res = await applyLogToNode(target.pool, log);
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
    const batch = await getPendingLogsFromSource(source, BATCH_SIZE);
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
