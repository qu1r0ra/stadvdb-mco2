import { nodes } from "../config/db.js";
import { v4 as uuid } from "uuid";
import { runTransaction } from "../utils/transactions.js";
import { info, warn, error } from "../utils/logger.js";

// Helper: Determine which fragment (Node 2 or 3) handles this data
function getFragment(courier) {
  if (courier === "JNT") return nodes.node2;
  return nodes.node3;
}

/**
 * Insert Rider
 * Strategy: Master-First (Node 1) -> Fallback to Fragment (Node 2/3)
 */
export async function insertRider(data) {
  const txId = uuid();
  const fragment = getFragment(data.courierName);

  // 1. Try writing to Master (Node 1)
  try {
    return await runTransaction(nodes.node1.pool, async (conn) => {
      const insertSql = `
        INSERT INTO Riders (courierName, vehicleType, firstName, lastName, gender, age, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
      `;
      const [res] = await conn.query(insertSql, [
        data.courierName, data.vehicleType, data.firstName, data.lastName, data.gender ?? null, data.age ?? null,
      ]);

      const insertedId = res.insertId;
      const [rows] = await conn.query("SELECT * FROM Riders WHERE id = ?", [insertedId]);
      const newRow = rows[0];

      // Create Replication Log on Master
      await conn.query(
        `INSERT INTO Logs (tx_id, node_name, action, rider_id, old_value, new_value, status)
         VALUES (?, 'node1', 'INSERT', ?, NULL, ?, 'pending')`,
        [txId, insertedId, JSON.stringify(newRow)]
      );

      return { id: insertedId, txId, writtenTo: "node1" };
    });

  } catch (err) {
    warn(`Master (Node 1) failed: ${err.message}. Falling back to ${fragment.name}...`);

    // 2. Fallback: Write to Fragment
    try {
      return await runTransaction(fragment.pool, async (conn) => {
        const insertSql = `
        INSERT INTO Riders (courierName, vehicleType, firstName, lastName, gender, age, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
      `;
        const [res] = await conn.query(insertSql, [
          data.courierName, data.vehicleType, data.firstName, data.lastName, data.gender ?? null, data.age ?? null,
        ]);

        const insertedId = res.insertId;
        const [rows] = await conn.query("SELECT * FROM Riders WHERE id = ?", [insertedId]);
        const newRow = rows[0];

        // Create Replication Log on Fragment (to be synced back to Master later)
        await conn.query(
          `INSERT INTO Logs (tx_id, node_name, action, rider_id, old_value, new_value, status)
           VALUES (?, ?, 'INSERT', ?, NULL, ?, 'pending')`,
          [txId, fragment.name, insertedId, JSON.stringify(newRow)]
        );

        return { id: insertedId, txId, writtenTo: fragment.name, fallback: true };
      });
    } catch (err2) {
      error("All nodes failed.", err2);
      throw new Error("System outage: Unable to write to Master or Fragment.");
    }
  }
}

/**
 * Update Rider
 * Strategy: Master-First -> Fallback to Fragment
 */
export async function updateRider(id, data) {
  const txId = uuid();
  const courier = data.courierName; // Note: Frontend must pass courierName for routing if needed

  // We need to know the courier to find the fallback node. 
  // If not passed, we might fail to fallback correctly, but usually we have it.
  const fragment = courier ? getFragment(courier) : null;

  try {
    return await runTransaction(nodes.node1.pool, async (conn) => {
      const [rows] = await conn.query("SELECT * FROM Riders WHERE id = ?", [id]);
      if (!rows.length) throw new Error(`Rider ${id} not found on Master`);
      const oldRow = rows[0];

      const fields = [];
      const values = [];
      for (const [key, value] of Object.entries(data)) {
        fields.push(`${key} = ?`);
        values.push(value);
      }
      if (fields.length === 0) return { id, txId };

      values.push(id);
      await conn.query(`UPDATE Riders SET ${fields.join(", ")} WHERE id = ?`, values);

      const [newRows] = await conn.query("SELECT * FROM Riders WHERE id = ?", [id]);
      const newRow = newRows[0];

      await conn.query(
        `INSERT INTO Logs (tx_id, node_name, action, rider_id, old_value, new_value, status)
         VALUES (?, 'node1', 'UPDATE', ?, ?, ?, 'pending')`,
        [txId, id, JSON.stringify(oldRow), JSON.stringify(newRow)]
      );

      return { id, txId, writtenTo: "node1" };
    });

  } catch (err) {
    warn(`Master (Node 1) failed: ${err.message}. Attempting fallback...`);

    if (!fragment) throw new Error("Master down and Courier not provided for routing fallback.");

    return await runTransaction(fragment.pool, async (conn) => {
      const [rows] = await conn.query("SELECT * FROM Riders WHERE id = ?", [id]);
      if (!rows.length) throw new Error(`Rider ${id} not found on ${fragment.name}`);
      const oldRow = rows[0];

      const fields = [];
      const values = [];
      for (const [key, value] of Object.entries(data)) {
        fields.push(`${key} = ?`);
        values.push(value);
      }
      values.push(id);
      await conn.query(`UPDATE Riders SET ${fields.join(", ")} WHERE id = ?`, values);

      const [newRows] = await conn.query("SELECT * FROM Riders WHERE id = ?", [id]);
      const newRow = newRows[0];

      await conn.query(
        `INSERT INTO Logs (tx_id, node_name, action, rider_id, old_value, new_value, status)
         VALUES (?, ?, 'UPDATE', ?, ?, ?, 'pending')`,
        [txId, fragment.name, id, JSON.stringify(oldRow), JSON.stringify(newRow)]
      );

      return { id, txId, writtenTo: fragment.name, fallback: true };
    });
  }
}

/**
 * Delete Rider
 * Strategy: Master-First -> Fallback to Fragment
 */
export async function deleteRider(id, courierName) {
  const txId = uuid();
  const fragment = courierName ? getFragment(courierName) : null;

  try {
    return await runTransaction(nodes.node1.pool, async (conn) => {
      const [rows] = await conn.query("SELECT * FROM Riders WHERE id = ?", [id]);
      if (!rows.length) throw new Error(`Rider ${id} not found on Master`);
      const oldRow = rows[0];

      await conn.query("DELETE FROM Riders WHERE id = ?", [id]);

      await conn.query(
        `INSERT INTO Logs (tx_id, node_name, action, rider_id, old_value, new_value, status)
         VALUES (?, 'node1', 'DELETE', ?, ?, NULL, 'pending')`,
        [txId, id, JSON.stringify(oldRow)]
      );

      return { id, txId, writtenTo: "node1" };
    });

  } catch (err) {
    warn(`Master (Node 1) failed: ${err.message}. Attempting fallback...`);
    if (!fragment) throw new Error("Master down and Courier not provided for routing fallback.");

    return await runTransaction(fragment.pool, async (conn) => {
      const [rows] = await conn.query("SELECT * FROM Riders WHERE id = ?", [id]);
      if (!rows.length) throw new Error(`Rider ${id} not found on ${fragment.name}`);
      const oldRow = rows[0];

      await conn.query("DELETE FROM Riders WHERE id = ?", [id]);

      await conn.query(
        `INSERT INTO Logs (tx_id, node_name, action, rider_id, old_value, new_value, status)
         VALUES (?, ?, 'DELETE', ?, ?, NULL, 'pending')`,
        [txId, fragment.name, id, JSON.stringify(oldRow)]
      );

      return { id, txId, writtenTo: fragment.name, fallback: true };
    });
  }
}

/**
 * Get All Riders
 * Strategy: Try Master -> Fallback to Merged Fragments
 */
export async function getAllRiders() {
  try {
    const [rows] = await nodes.node1.pool.query("SELECT * FROM Riders ORDER BY id DESC");
    return rows;
  } catch (err) {
    warn("Master read failed. Merging fragments...", err.message);
    try {
      const [r2] = await nodes.node2.pool.query("SELECT * FROM Riders ORDER BY id DESC");
      const [r3] = await nodes.node3.pool.query("SELECT * FROM Riders ORDER BY id DESC");
      // Merge and sort
      return [...r2, ...r3].sort((a, b) => b.id - a.id);
    } catch (err2) {
      error("Cluster Read Failure");
      throw new Error("Entire cluster is down or unreachable.");
    }
  }
}

/**
 * Get Riders from specific node (for Dashboard columns)
 * Returns empty array if node is down, preventing dashboard crash
 */
export async function getRidersFromNode(nodeName) {
  const node = nodes[nodeName];
  if (!node) return [];
  try {
    const [rows] = await node.pool.query("SELECT * FROM Riders ORDER BY id DESC");
    return rows;
  } catch (err) {
    // If node is "killed" (offline), return empty to show it's empty/down in UI
    return [];
  }
}