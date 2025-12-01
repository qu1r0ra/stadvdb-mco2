import sleep from "./sleep.js";

export async function runTransaction(pool, cb, isolationLevel = "REPEATABLE READ", maxAttempts = 3) {
  let attempt = 0;

  while (true) {
    const conn = await pool.getConnection();
    try {
      // Set dynamic isolation level
      await conn.query(`SET SESSION TRANSACTION ISOLATION LEVEL ${isolationLevel}`);
      await conn.beginTransaction();

      const result = await cb(conn);

      await conn.commit();
      conn.release();
      return result;
    } catch (err) {
      try { await conn.rollback(); } catch (_) { }
      conn.release();

      attempt++;
      // Retry on deadlock
      const isDeadlock = err && (err.errno === 1213 || err.errno === 1205);
      if (isDeadlock && attempt < maxAttempts) {
        const backoff = 100 * Math.pow(2, attempt - 1);
        await sleep(backoff);
        continue;
      }
      throw err;
    }
  }
}