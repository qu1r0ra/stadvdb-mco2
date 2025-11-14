import { Pool, PoolConnection } from "mysql2/promise";

export async function runQuery<T = any>(pool: Pool, sql: string, params: any[] = []): Promise<T[]> {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query(sql, params);
    return rows as T[];
  } finally {
    conn.release();
  }
}

/**
 * Run a set of operations inside a transaction.
 * cb receives the connection and should execute prepared statements via conn.query(...)
 */
export async function runTransaction<T = any>(
  pool: Pool,
  cb: (conn: PoolConnection) => Promise<T>
): Promise<T> {
  const conn = await pool.getConnection();
  try {
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
