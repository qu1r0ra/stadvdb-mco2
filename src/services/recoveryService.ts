import { node1, node2, node3 } from "../db/connection.js";
import { runQuery, runTransaction } from "../db/nodeClient.js";
import { info, error } from "../utils/logger.js";

type LogRow = {
  id: number;
  tx_id: string;
  node_name: string; // "node1" | "node2" | "node3"
  action: "INSERT" | "UPDATE" | "DELETE" | string;
  rider_id: number | null;
  old_value: string | null; // JSON string
  new_value: string | null; // JSON string
  timestamp: string;
};

async function maxLogId(pool: typeof node1) {
  const r = await runQuery<{ id: number }>(pool, "SELECT MAX(id) AS id FROM Logs");
  return r[0].id || 0;
}

async function fetchLogsFrom(pool: typeof node1, startId: number) {
  return (await runQuery<LogRow>(pool, "SELECT * FROM Logs WHERE id >= ? ORDER BY id ASC", [
    startId
  ])) as LogRow[];
}

/**
 * Apply a single log entry to a target pool inside an active transaction connection.
 * Uses row JSON to perform INSERT / UPDATE / DELETE.
 */
async function applyLog(conn: any, log: LogRow) {
  const newRow = log.new_value ? JSON.parse(log.new_value) : null;
  const oldRow = log.old_value ? JSON.parse(log.old_value) : null;

  switch (log.action) {
    case "INSERT": {
      if (!newRow) return;
      // Use INSERT ... ON DUPLICATE KEY UPDATE to avoid duplicate PK errors
      const sql = `INSERT INTO Riders
        (id, courierName, vehicleType, firstName, lastName, gender, age, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          courierName = VALUES(courierName),
          vehicleType = VALUES(vehicleType),
          firstName = VALUES(firstName),
          lastName = VALUES(lastName),
          gender = VALUES(gender),
          age = VALUES(age),
          createdAt = VALUES(createdAt),
          updatedAt = VALUES(updatedAt)
      `;
      const params = [
        newRow.id,
        newRow.courierName,
        newRow.vehicleType,
        newRow.firstName,
        newRow.lastName,
        newRow.gender ?? null,
        newRow.age ?? null,
        newRow.createdAt ?? new Date(),
        newRow.updatedAt ?? new Date()
      ];
      await conn.query(sql, params);
      break;
    }
    case "UPDATE": {
      if (!newRow || !log.rider_id) return;
      const updates = [];
      const params: any[] = [];
      for (const k of ["courierName", "vehicleType", "firstName", "lastName", "gender", "age", "updatedAt"]) {
        if (k in newRow) {
          updates.push(`${k} = ?`);
          params.push((newRow as any)[k]);
        }
      }
      if (updates.length === 0) return;
      params.push(log.rider_id);
      const sql = `UPDATE Riders SET ${updates.join(", ")} WHERE id = ?`;
      await conn.query(sql, params);
      break;
    }
    case "DELETE": {
      if (!log.rider_id) return;
      await conn.query("DELETE FROM Riders WHERE id = ?", [log.rider_id]);
      break;
    }
    default:
      // ignore unknown actions
      break;
  }
}

/**
 * Replay logs from sourcePool starting at startId into targetPool.
 * Each log application is executed inside a runTransaction on the target pool.
 */
async function replayLogs(sourcePool: typeof node1, targetPool: typeof node1, startId: number) {
  const logs = await fetchLogsFrom(sourcePool, startId);
  if (logs.length === 0) return 0;

  // Apply logs in small batches inside a transaction to avoid partial application.
  // For simplicity apply all in one transaction per target here.
  await runTransaction(targetPool, async (conn) => {
    for (const log of logs) {
      try {
        await applyLog(conn, log);
        // After applying to target, also insert a log entry on target so its Logs head advances.
        await conn.query(
          `INSERT INTO Logs (tx_id, node_name, action, rider_id, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)`,
          [log.tx_id, log.node_name, log.action, log.rider_id, log.old_value, log.new_value]
        );
      } catch (err) {
        // log and continue with next entry (we don't want a single bad log to abort everything)
        error("Failed to apply log", log.id, err);
      }
    }
  });

  return logs.length;
}

/**
 * Public recovery entrypoint. Compares log heads and replays missing logs:
 * - node2 <-> node1
 * - node3 <-> node1
 */
export async function recoverNodes() {
  const m1 = await maxLogId(node1);
  const m2 = await maxLogId(node2);
  const m3 = await maxLogId(node3);

  info("Log heads", { node1: m1, node2: m2, node3: m3 });

  const actions: Array<{ from: string; to: string; applied: number }> = [];

  // node2 vs node1
  if (m2 > m1) {
    const applied = await replayLogs(node2, node1, m1 + 1);
    actions.push({ from: "node2", to: "node1", applied });
  } else if (m1 > m2) {
    const applied = await replayLogs(node1, node2, m2 + 1);
    actions.push({ from: "node1", to: "node2", applied });
  }

  // node3 vs node1
  if (m3 > m1) {
    const applied = await replayLogs(node3, node1, m1 + 1);
    actions.push({ from: "node3", to: "node1", applied });
  } else if (m1 > m3) {
    const applied = await replayLogs(node1, node3, m3 + 1);
    actions.push({ from: "node1", to: "node3", applied });
  }

  return { timestamp: new Date().toISOString(), actions };
}
