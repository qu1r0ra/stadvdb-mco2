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

  let newV = (typeof log.new_value === 'string') ? JSON.parse(log.new_value) : log.new_value;
  let oldV = (typeof log.old_value === 'string') ? JSON.parse(log.old_value) : log.old_value;

  if (newV) {
    if (newV.createdAt) newV.createdAt = new Date(newV.createdAt);
    if (newV.updatedAt) newV.updatedAt = new Date(newV.updatedAt);
  }
  if (oldV) {
    if (oldV.createdAt) oldV.createdAt = new Date(oldV.createdAt);
    if (oldV.updatedAt) oldV.updatedAt = new Date(oldV.updatedAt);
  }

  try {
    if (action === "INSERT") {
      if (!newV) throw new Error("Malformed INSERT log: missing new_value");

      // REPLACE INTO is idempotent by primary key; safe for reapplications.
      await targetPool.query("REPLACE INTO Riders SET ?", [newV]);

    } else if (action === "UPDATE") {
      if (!newV || typeof newV.id === "undefined") {
        throw new Error("Malformed UPDATE log: missing new_value.id");
      }
      // removing the ID from the SET clause to avoid "id = id" possible redundancy issue ??? but "UPDATE SET ? WHERE id" usually works fine if ID is in the object.
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