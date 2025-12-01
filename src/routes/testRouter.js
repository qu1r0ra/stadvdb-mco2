import { Router } from "express";
import { nodeStatus } from "../config/db.js";
import { testConcurrentReads, testReadWrite, testWriteWrite } from "../services/simulationService.js";

const router = Router();

// Toggle Node Status (Kill/Revive)
router.post("/node-status", (req, res) => {
    const { node, status } = req.body; // e.g., { node: "node1", status: false }
    if (node in nodeStatus) {
        nodeStatus[node] = status;
        console.log(`[SIMULATION] ${node} is now ${status ? "ONLINE" : "OFFLINE"}`);
        res.json({ success: true, nodeStatus });
    } else {
        res.status(400).json({ error: "Invalid node" });
    }
});

// Get Status
router.get("/node-status", (req, res) => {
    res.json(nodeStatus);
});

// Run Concurrency Test
router.post("/concurrency", async (req, res) => {
    const { caseId, isolationLevel, param } = req.body;

    try {
        let result;
        if (caseId === 1) result = await testConcurrentReads(isolationLevel);
        if (caseId === 2) result = await testReadWrite(isolationLevel);
        if (caseId === 3) result = await testWriteWrite(isolationLevel, param || 1);

        res.json({ success: true, result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;