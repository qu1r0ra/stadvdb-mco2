import { nodes } from "../config/db.js";
import { v4 as uuid } from "uuid";
import { runTransaction } from "../utils/transactions.js";
import { info, warn, error } from "../utils/logger.js";

// Choose correct node pool for inserts (partition by courier)
function chooseNodePool(courier) {
  return courier === "JNT" ? nodes.node2.pool : nodes.node3.pool;
}

// Map pool object to node name string
function poolName(pool) {
  if (pool === nodes.node1.pool) return "node1";
  if (pool === nodes.node2.pool) return "node2";
  return "node3";
}

/**
 * Insert a rider and create a pending log (with tx_id)
 */
export async function insertRider(data) {
  const pool = chooseNodePool(data.courierName);
  const txId = uuid();

  return await runTransaction(pool, async (conn) => {
    const insertSql = `
      INSERT INTO Riders
        (courierName, vehicleType, firstName, lastName, gender, age, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
    `;
    const [res] = await conn.query(insertSql, [
      data.courierName,
      data.vehicleType,
      data.firstName,
      data.lastName,
      data.gender ?? null,
      data.age ?? null,
    ]);

    const insertedId = res.insertId;
    const [rows] = await conn.query("SELECT * FROM Riders WHERE id = ?", [
      insertedId,
    ]);
    const newRow = rows[0];

    // Insert log entry with tx_id and pending status
    await conn.query(
      `INSERT INTO Logs (tx_id, node_name, action, rider_id, old_value, new_value, status)
       VALUES (?, ?, 'INSERT', ?, NULL, ?, 'pending')`,
      [txId, poolName(pool), insertedId, JSON.stringify(newRow)]
    );

    return { id: insertedId, txId };
  });
}

/**
 * Get all riders. Prefer central node1; fallback to fragments.
 */
export async function getAllRiders() {
  try {
    const [rows] = await nodes.node1.pool.query("SELECT * FROM Riders");
    return rows;
  } catch (err) {
    warn("node1 read failed, falling back to fragments:", err);
    const [r2] = await nodes.node2.pool.query("SELECT * FROM Riders");
    const [r3] = await nodes.node3.pool.query("SELECT * FROM Riders");
    return [...r2, ...r3];
  }
}

/**
 * Update rider by id. Creates log with tx_id & pending.
 */
export async function updateRider(id, data) {
  const pool = chooseNodePool(data.courierName || "");
  const txId = uuid();

  return await runTransaction(pool, async (conn) => {
    const [rows] = await conn.query("SELECT * FROM Riders WHERE id = ?", [id]);
    if (!rows || rows.length === 0) throw new Error(`Rider ${id} not found`);
    const oldRow = rows[0];

    const fields = [];
    const values = [];
    for (const [key, value] of Object.entries(data)) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
    if (fields.length === 0) return { id, txId }; // nothing to update

    values.push(id);
    await conn.query(
      `UPDATE Riders SET ${fields.join(", ")} WHERE id = ?`,
      values
    );

    const [newRows] = await conn.query("SELECT * FROM Riders WHERE id = ?", [
      id,
    ]);
    const newRow = newRows[0];

    // Log update
    await conn.query(
      `INSERT INTO Logs (tx_id, node_name, action, rider_id, old_value, new_value, status)
       VALUES (?, ?, 'UPDATE', ?, ?, ?, 'pending')`,
      [txId, poolName(pool), id, JSON.stringify(oldRow), JSON.stringify(newRow)]
    );

    return { id, txId };
  });
}

/**
 * Delete rider. Creates pending log.
 */
export async function deleteRider(id, courierName) {
  const pool = chooseNodePool(courierName || "");
  const txId = uuid();

  return await runTransaction(pool, async (conn) => {
    const [rows] = await conn.query("SELECT * FROM Riders WHERE id = ?", [id]);
    if (!rows || rows.length === 0) throw new Error(`Rider ${id} not found`);
    const oldRow = rows[0];

    await conn.query("DELETE FROM Riders WHERE id = ?", [id]);

    // Log delete
    await conn.query(
      `INSERT INTO Logs (tx_id, node_name, action, rider_id, old_value, new_value, status)
       VALUES (?, ?, 'DELETE', ?, ?, NULL, 'pending')`,
      [txId, poolName(pool), id, JSON.stringify(oldRow)]
    );

    return { id, txId };
  });
}
