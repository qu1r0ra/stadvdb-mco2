import { node1, node2, node3 } from "../db/connection.js";
import { runQuery, runTransaction } from "../db/nodeClient.js";
import { v4 as uuidv4 } from "uuid";

export type RiderInput = {
  courierName: "JNT" | "LBCD" | "FEDEZ" | string;
  vehicleType: "Motorcycle" | "Bike" | "Trike" | "Car" | string;
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

function chooseNodePool(courier: string) {
  return courier === "JNT" ? node2 : node3;
}

function poolName(pool: typeof node1) {
  if (pool === node1) return "node1";
  if (pool === node2) return "node2";
  return "node3";
}

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

    // Insert log (old_value null)
    await conn.query(
      `INSERT INTO Logs (tx_id, node_name, action, rider_id, old_value, new_value) VALUES (?, ?, 'INSERT', ?, NULL, ?)`,
      [txId, poolName(pool), insertedId, JSON.stringify(newRow)]
    );

    return { id: insertedId, txId };
  });
}

/**
 * Get all riders. Prefer central node (node1). If node1 not reachable or empty, fetch from fragments and concat.
 */
export async function getAllRiders(): Promise<RiderRow[]> {
  try {
    return await runQuery<RiderRow>(node1, "SELECT * FROM Riders");
  } catch (err) {
    // Fallback: read both fragments and merge
    const r2 = await runQuery<RiderRow>(node2, "SELECT * FROM Riders");
    const r3 = await runQuery<RiderRow>(node3, "SELECT * FROM Riders");
    return [...r2, ...r3];
  }
}
