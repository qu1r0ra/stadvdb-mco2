import { Router, Request, Response } from "express";
import { nodes } from "../config/db";
import { v4 as uuid } from "uuid";

const router = Router();

router.get("/", async (_req: Request, res: Response) => {
  const [rows] = await nodes.node1.pool.query("SELECT * FROM Riders");
  res.json(rows);
});

router.post("/", async (req: Request, res: Response) => {
  const rider = req.body;
  rider.tx_id = uuid();

  await nodes.node1.pool.query(`INSERT INTO Riders SET ?`, rider);
  res.json({ status: "ok", rider });
});

router.put("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const rider = req.body;
  rider.tx_id = uuid();

  await nodes.node1.pool.query(`UPDATE Riders SET ? WHERE id = ?`, [rider, id]);
  res.json({ status: "updated", id });
});

router.delete("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);

  await nodes.node1.pool.query(`DELETE FROM Riders WHERE id = ?`, [id]);
  res.json({ status: "deleted", id });
});

export default router;
