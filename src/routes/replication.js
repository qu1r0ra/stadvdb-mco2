import { Router } from "express";
import { nodes } from "../config/db.js";
import {
  retryFailedLogs,
  recoverNodes,
  syncPair,
} from "../services/recoveryService.js";
import {
  getFailoverStatus,
  promoteSlaves,
  demoteSlaves,
} from "../services/failoverService.js";

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

// Trigger replication: if body has { source, target } -> sync pair; otherwise run full recoverNodes()
router.post("/replicate", async (req, res) => {
  try {
    const { source, target } = req.body || {};
    if (source && target) {
      const result = await syncPair(source, target);
      return res.json({ type: "pair", source, target, result });
    } else {
      const result = await recoverNodes();
      return res.json({ type: "full", result });
    }
  } catch (err) {
    console.error("replicate error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// Failover control endpoints
router.get("/failover-status", (_req, res) => {
  res.json(getFailoverStatus());
});

router.post("/promote", (_req, res) => {
  const status = promoteSlaves();
  res.json({ message: "Node 2/3 promoted to masters", status });
});

router.post("/demote", (_req, res) => {
  const status = demoteSlaves();
  res.json({ message: "Node 2/3 demoted to slaves", status });
});

export default router;
