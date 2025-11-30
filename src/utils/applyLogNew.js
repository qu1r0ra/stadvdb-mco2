console.error(">>> LOADING src/utils/applyLog.js <<<");
/**
 * applyLogToNode(targetPool, log)
 * - Applies the logged operation to the target DB.
 * - Returns { ok: true } on success or { ok: false, error } on failure.
 *
 * Important: this util DOES NOT change Logs.status. The caller (recovery service)
 * is responsible for marking Logs as 'replicated' or 'failed' on the source node.
 */

export async function applyLogToNode(targetPool, log) {
  process.stdout.write("DEBUG: applyLogToNode ENTERED\n");
  // throw new Error("TOP LEVEL THROW");
  const action = log.action;
  const parseJSON = (val) => {
    process.stdout.write(`DEBUG: parseJSON called with type: ${typeof val}\n`);
    if (!val) return null;
    let obj;
    if (typeof val === "object") {
      obj = { ...val }; // Shallow copy to ensure mutability
    } else {
      obj = JSON.parse(val);
    }
    process.stdout.write(`DEBUG: Parsed obj keys: ${obj ? Object.keys(obj) : "null"}\n`);

    // Sanitize dates for MySQL
    const formatDate = (d) => {
      if (!d) return d;
      try {
        const formatted = new Date(d).toISOString().slice(0, 19).replace("T", " ");
        process.stdout.write(`DEBUG: formatDate: ${d} -> ${formatted}\n`);
        return formatted;
      } catch (e) {
        process.stdout.write(`DEBUG: formatDate error: ${e}\n`);
        return d;
      }
    };

    if (obj) {
      if (obj.createdAt) obj.createdAt = formatDate(obj.createdAt);
      if (obj.updatedAt) obj.updatedAt = formatDate(obj.updatedAt);
    }
    return obj;
  };

  const newV = parseJSON(log.new_value);
  const oldV = parseJSON(log.old_value);

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
    return { ok: false, error: new Error("CUSTOM ERROR: " + err.message) };
  }
}
