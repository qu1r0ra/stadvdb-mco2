import { Router } from "express";
import { nodes } from "../config/db.js";
import { retryFailedLogs } from "../services/recoveryService.js";

const router = Router();

// List pending logs on a node
router.get("/pending/:node", async (req, res) => {
  const nodeName = req.params.node;
  const node = nodes[nodeName];
  if (!node) return res.status(400).json({ error: "invalid node" });
  const [rows] = await node.pool.query(
    `SELECT * FROM Logs WHERE status = 'pending' ORDER BY id ASC LIMIT 1000`
  );
  res.json(rows);
});

// List failed logs on a node
router.get("/failed/:node", async (req, res) => {
  const nodeName = req.params.node;
  const node = nodes[nodeName];
  if (!node) return res.status(400).json({ error: "invalid node" });
  const [rows] = await node.pool.query(
    `SELECT * FROM Logs WHERE status = 'failed' ORDER BY id ASC LIMIT 1000`
  );
  res.json(rows);
});

// Trigger retry for failed logs from source -> target
router.post("/retry-failed", async (req, res) => {
  // body: { source: "node2", target: "node1" }
  try {
    const { source, target } = req.body;
    const result = await retryFailedLogs(source, target);
    res.json(result);
  } catch (err) {
    console.error("retry-failed error:", err);
    res.status(500).json({ error: String(err) });
  }
});

export default router;
