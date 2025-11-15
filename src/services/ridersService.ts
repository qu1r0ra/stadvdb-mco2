import { nodes } from "../config/db";
import { v4 as uuidv4 } from "uuid";
import { PoolConnection, RowDataPacket } from "mysql2/promise";

export type RiderInput = {
  courierName: "JNT" | "LBCD" | "FEDEZ" | string;
  vehicleType: "Motorcycle" | "Bicycle" | "Tricycle" | "Car" | string;
  firstName: string;
  lastName: string;
  gender?: string;
  age?: number | null;
};

export type RiderRow = {
  id: number;
  courierName: string;
  vehicleType: string;
  firstName: string;
  lastName: string;
  gender: string;
  age: number | null;
  createdAt: string;
  updatedAt: string;
};

// Choose correct node pool for inserts
function chooseNodePool(courier: string) {
  return courier === "JNT" ? nodes.node2.pool : nodes.node3.pool;
}

// Map pool object to node name string
function poolName(pool: typeof nodes.node1.pool) {
  if (pool === nodes.node1.pool) return "node1";
  if (pool === nodes.node2.pool) return "node2";
  return "node3";
}

// Small helper to run a transaction
async function runTransaction<T>(
  pool: typeof nodes.node1.pool,
  cb: (conn: PoolConnection) => Promise<T>
): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await cb(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Insert a rider into the appropriate node and log the action
 */
export async function insertRider(data: RiderInput) {
  const pool = chooseNodePool(data.courierName);
  const txId = uuidv4();

  return await runTransaction(pool, async (conn) => {
    // Insert rider
    const insertSql = `
      INSERT INTO Riders
        (courierName, vehicleType, firstName, lastName, gender, age, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
    `;
    const [res]: any = await conn.query(insertSql, [
      data.courierName,
      data.vehicleType,
      data.firstName,
      data.lastName,
      data.gender ?? null,
      data.age ?? null
    ]);

    const insertedId = res.insertId;

    // Fetch inserted row
    const [rows]: any = await conn.query("SELECT * FROM Riders WHERE id = ?", [insertedId]);
    const newRow = rows[0];

    // Insert log entry
    await conn.query(
      `INSERT INTO Logs (tx_id, node_name, action, rider_id, old_value, new_value)
       VALUES (?, ?, 'INSERT', ?, NULL, ?)`,
      [txId, poolName(pool), insertedId, JSON.stringify(newRow)]
    );

    return { id: insertedId, txId };
  });
}

/**
 * Fetch all riders, prefer central node first.
 * If node1 fails, fallback to fragments and merge
 */
export async function getAllRiders(): Promise<RiderRow[]> {
    try {
        const [rows] = await nodes.node1.pool.query<RowDataPacket[]>("SELECT * FROM Riders");
        return rows as RiderRow[];
    } catch (err) {
        const [r2] = await nodes.node2.pool.query<RowDataPacket[]>("SELECT * FROM Riders");
        const [r3] = await nodes.node3.pool.query<RowDataPacket[]>("SELECT * FROM Riders");
        return [...(r2 as RiderRow[]), ...(r3 as RiderRow[])];
    }
}

/**
 * Update a rider by ID
 */
export async function updateRider(id: number, data: Partial<RiderInput>) {
  const pool = chooseNodePool(data.courierName ?? ""); // fallback if courierName not provided
  const txId = uuidv4();

  return await runTransaction(pool, async (conn) => {
    try {
      // Fetch old row
      const [rows]: any = await conn.query("SELECT * FROM Riders WHERE id = ?", [id]);
      if (rows.length === 0) throw new Error(`Rider ${id} not found`);
      const oldRow = rows[0];

      // Update
      const fields: string[] = [];
      const values: any[] = [];
      for (const [key, value] of Object.entries(data)) {
        fields.push(`${key} = ?`);
        values.push(value);
      }
      if (fields.length === 0) return { id, txId }; // nothing to update

      values.push(id);
      await conn.query(`UPDATE Riders SET ${fields.join(", ")} WHERE id = ?`, values);

      // Fetch new row
      const [newRows]: any = await conn.query("SELECT * FROM Riders WHERE id = ?", [id]);
      const newRow = newRows[0];

      // Log the update
      await conn.query(
        `INSERT INTO Logs (tx_id, node_name, action, rider_id, old_value, new_value)
         VALUES (?, ?, 'UPDATE', ?, ?, ?)`,
        [txId, poolName(pool), id, JSON.stringify(oldRow), JSON.stringify(newRow)]
      );

      return { id, txId };
    } catch (err) {
      console.error(`Update failed on node ${poolName(pool)}:`, err);
      throw err;
    }
  });
}

/**
 * Delete a rider by ID
 */
export async function deleteRider(id: number, courierName?: string) {
  const pool = chooseNodePool(courierName ?? "");
  const txId = uuidv4();

  return await runTransaction(pool, async (conn) => {
    try {
      // Fetch old row
      const [rows]: any = await conn.query("SELECT * FROM Riders WHERE id = ?", [id]);
      if (rows.length === 0) throw new Error(`Rider ${id} not found`);
      const oldRow = rows[0];

      // Delete
      await conn.query("DELETE FROM Riders WHERE id = ?", [id]);

      // Log the delete
      await conn.query(
        `INSERT INTO Logs (tx_id, node_name, action, rider_id, old_value, new_value)
         VALUES (?, ?, 'DELETE', ?, ?, NULL)`,
        [txId, poolName(pool), id, JSON.stringify(oldRow)]
      );

      return { id, txId };
    } catch (err) {
      console.error(`Delete failed on node ${poolName(pool)}:`, err);
      throw err;
    }
  });
}
