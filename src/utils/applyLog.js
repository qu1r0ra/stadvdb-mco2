export async function applyLogToNode(targetPool, log) {
  const action = log.action;
  const newV = log.new_value ? JSON.parse(log.new_value) : null;
  const oldV = log.old_value ? JSON.parse(log.old_value) : null;

  try {
    if (action === "INSERT") {
      // REPLACE will insert or overwrite by PK — safe for idempotent replication.
      await targetPool.query(`REPLACE INTO Riders SET ?`, [newV]);
    } else if (action === "UPDATE") {
      if (!newV || !newV.id) {
        throw new Error("Malformed UPDATE log: missing new_value or id");
      }
      await targetPool.query(`UPDATE Riders SET ? WHERE id = ?`, [
        newV,
        newV.id,
      ]);
    } else if (action === "DELETE") {
      if (!oldV || !oldV.id) {
        throw new Error("Malformed DELETE log: missing old_value or id");
      }
      await targetPool.query(`DELETE FROM Riders WHERE id = ?`, [oldV.id]);
    } else {
      return { ok: false, error: new Error(`Unknown action ${action}`) };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err };
  }
}
