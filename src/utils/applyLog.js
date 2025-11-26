/**
 * applyLogToNode(targetPool, log)
 * - Applies the logged operation to the target DB.
 * - Returns { ok: true } on success or { ok: false, error } on failure.
 *
 * Important: this util DOES NOT change Logs.status. The caller (recovery service)
 * is responsible for marking Logs as 'replicated' or 'failed' on the source node.
 */

export async function applyLogToNode(targetPool, log) {
  const action = log.action;
  const newV = log.new_value ? JSON.parse(log.new_value) : null;
  const oldV = log.old_value ? JSON.parse(log.old_value) : null;

  try {
    if (action === "INSERT") {
      if (!newV) throw new Error("Malformed INSERT log: missing new_value");
      // REPLACE INTO is idempotent by primary key; safe for reapplications.
      await targetPool.query("REPLACE INTO Riders SET ?", [newV]);
    } else if (action === "UPDATE") {
      if (!newV || typeof newV.id === "undefined") {
        throw new Error("Malformed UPDATE log: missing new_value.id");
      }
      await targetPool.query("UPDATE Riders SET ? WHERE id = ?", [
        newV,
        newV.id,
      ]);
    } else if (action === "DELETE") {
      if (!oldV || typeof oldV.id === "undefined") {
        throw new Error("Malformed DELETE log: missing old_value.id");
      }
      await targetPool.query("DELETE FROM Riders WHERE id = ?", [oldV.id]);
    } else {
      return { ok: false, error: new Error(`Unknown action '${action}'`) };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err };
  }
}
