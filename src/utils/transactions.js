import sleep from "./sleep.js";

export async function runTransaction(pool, cb, isolationLevel = "REPEATABLE READ", maxAttempts = 3) {
  let attempt = 0;

  while (true) {
    const conn = await pool.getConnection();
    try {
      await conn.query(`SET SESSION TRANSACTION ISOLATION LEVEL ${isolationLevel}`);

      await conn.beginTransaction();

      //confirm level
      const [vars] = await conn.query("SELECT @@transaction_isolation as level");
      console.log(`[TX START] Level: ${vars[0].level} | TxID: ${Math.random().toString(36).substr(7)}`);

      const result = await cb(conn);

      await conn.commit();
      conn.release();
      return result;
    } catch (err) {
      try { await conn.rollback(); } catch (_) { }
      conn.release();

      attempt++;
      const isDeadlock = err && (err.errno === 1213 || err.errno === 1205); // Deadlock or Lock Wait Timeout

      if (isDeadlock) {
        console.warn(`[TX DEADLOCK] Attempt ${attempt}/${maxAttempts}. Retrying...`);
        if (attempt < maxAttempts) {
          const backoff = 100 * Math.pow(2, attempt - 1);
          await sleep(backoff);
          continue;
        }
      }
      throw err;
    }
  }
}