import { Pool } from "mysql2/promise";

type LogRow = {
    action: "INSERT" | "UPDATE" | "DELETE";
    old_value?: any;
    new_value?: any;
  };


export async function applyLogToNode(targetPool: Pool, log: LogRow) {
  const action = log.action;
  const newV = log.new_value ? JSON.parse(log.new_value) : null;
  const oldV = log.old_value ? JSON.parse(log.old_value) : null;

  switch (action) {
    case "INSERT":
      await targetPool.query(`REPLACE INTO Riders SET ?`, newV);
      break;

    case "UPDATE":
      await targetPool.query(`UPDATE Riders SET ? WHERE id = ?`, [newV, newV.id]);
      break;

    case "DELETE":
      await targetPool.query(`DELETE FROM Riders WHERE id = ?`, [oldV.id]);
      break;
  }
}
