import { Router } from "express";
import { nodes } from "../config/db.js";
import {
  retryFailedLogs,
  recoverNodes,
  syncPair,
  checkConsistency,
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

// Consistency check endpoint
router.get("/consistency-check", async (_req, res) => {
  try {
    const result = await checkConsistency();
    res.json(result);
  } catch (err) {
    console.error("consistency-check error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// Database cleanup endpoint (for testing)
router.post("/cleanup", async (_req, res) => {
  try {
    const tables = ["Riders", "Logs", "ReplicationErrors"];
    const results = {};

    // ID ranges: Node1=1-999999, Node2=1M-1.99M, Node3=2M-2.99M
    const autoIncrementOffsets = {
      node1: 1,
      node2: 1000000,
      node3: 2000000
    };

    for (const [nodeName, node] of Object.entries(nodes)) {
      results[nodeName] = {};
      for (const table of tables) {
        try {
          await node.pool.query(`DELETE FROM ${table}`);
          // Reset auto-increment with offset to prevent ID collisions
          const offset = autoIncrementOffsets[nodeName] || 1;
          await node.pool.query(`ALTER TABLE ${table} AUTO_INCREMENT = ${offset}`);
          results[nodeName][table] = { cleared: true, autoIncrementOffset: offset };
        } catch (err) {
          results[nodeName][table] = { error: String(err) };
        }
      }
    }

    res.json({ success: true, results });
  } catch (err) {
    console.error("cleanup error:", err);
    res.status(500).json({ error: String(err) });
  }
});

export default router;
