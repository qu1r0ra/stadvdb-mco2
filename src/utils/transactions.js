import sleep from "./sleep.js";

export async function runTransaction(pool, cb, maxAttempts = 3) {
  let attempt = 0;
  while (true) {
    const conn = await pool.getConnection();
    try {
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
        const backoff = 100 * Math.pow(2, attempt - 1); // 100ms, 200ms
        await sleep(backoff);
        continue; // retry whole transaction
      }
      throw err;
    }
  }
}
