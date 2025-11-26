import { nodes } from "../config/db.js";
import { v4 as uuid } from "uuid";

// Choose correct node pool for inserts
function chooseNodePool(courier) {
  return courier === "JNT" ? nodes.node2.pool : nodes.node3.pool;
}

// Map pool object to node name string
function poolName(pool) {
  if (pool === nodes.node1.pool) return "node1";
  if (pool === nodes.node2.pool) return "node2";
  return "node3";
}

// Transaction helper with repeatable read
async function runTransaction(pool, cb) {
  const conn = await pool.getConnection();
  try {
    await conn.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await conn.beginTransaction();

    const result = await cb(conn);

    await conn.commit();
    return result;
  } catch (err) {
    try {
      await conn.rollback();
    } catch (_) {}
    throw err;
  } finally {
    conn.release();
  }
}

// Insert rider
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

    // Log the insert
    await conn.query(
      `INSERT INTO Logs (tx_id, node_name, action, rider_id, old_value, new_value, status)
       VALUES (?, ?, 'INSERT', ?, NULL, ?, 'pending')`,
      [txId, poolName(pool), insertedId, JSON.stringify(newRow)]
    );

    return { id: insertedId, txId };
  });
}

// Get all riders
export async function getAllRiders() {
  try {
    const [rows] = await nodes.node1.pool.query("SELECT * FROM Riders");
    return rows;
  } catch (err) {
    const [r2] = await nodes.node2.pool.query("SELECT * FROM Riders");
    const [r3] = await nodes.node3.pool.query("SELECT * FROM Riders");
    return [...r2, ...r3];
  }
}

// Update rider
export async function updateRider(id, data) {
  const pool = chooseNodePool(data.courierName || "");
  const txId = uuid();

  return await runTransaction(pool, async (conn) => {
    const [rows] = await conn.query("SELECT * FROM Riders WHERE id = ?", [id]);
    if (rows.length === 0) throw new Error(`Rider ${id} not found`);
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

    // Log the update
    await conn.query(
      `INSERT INTO Logs (tx_id, node_name, action, rider_id, old_value, new_value, status)
       VALUES (?, ?, 'UPDATE', ?, ?, ?, 'pending')`,
      [txId, poolName(pool), id, JSON.stringify(oldRow), JSON.stringify(newRow)]
    );

    return { id, txId };
  });
}

// Delete rider
export async function deleteRider(id, courierName) {
  const pool = chooseNodePool(courierName || "");
  const txId = uuid();

  return await runTransaction(pool, async (conn) => {
    const [rows] = await conn.query("SELECT * FROM Riders WHERE id = ?", [id]);
    if (rows.length === 0) throw new Error(`Rider ${id} not found`);
    const oldRow = rows[0];

    await conn.query("DELETE FROM Riders WHERE id = ?", [id]);

    // Log the delete
    await conn.query(
      `INSERT INTO Logs (tx_id, node_name, action, rider_id, old_value, new_value, status)
       VALUES (?, ?, 'DELETE', ?, ?, NULL, 'pending')`,
      [txId, poolName(pool), id, JSON.stringify(oldRow)]
    );

    return { id, txId };
  });
}
