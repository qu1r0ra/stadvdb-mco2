import sleep from "./sleep.js";

/**
 * runTransaction
 * - pool: mysql2/promise pool
 * - cb: async callback receiving a connection (conn) to run queries
 * - maxAttempts: deadlock retry attempts (default 3 total attempts)
 */
export async function runTransaction(pool, cb, maxAttempts = 3) {
  let attempt = 0;

  while (true) {
    const conn = await pool.getConnection();
    try {
      // Ensure the required isolation level for the transaction
      await conn.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      await conn.beginTransaction();

      const result = await cb(conn);

      await conn.commit();
      conn.release();
      return result;
    } catch (err) {
      try {
        await conn.rollback();
      } catch (_) {}
      conn.release();

      attempt++;
      const isDeadlock = err && (err.errno === 1213 || err.errno === 1205);
      if (isDeadlock && attempt < maxAttempts) {
        // exponential-ish backoff: 100ms, 200ms, 400ms...
        const backoff = 100 * Math.pow(2, attempt - 1);
        await sleep(backoff);
        continue;
      }

      // rethrow for non-deadlock or exhausted attempts
      throw err;
    }
  }
}
