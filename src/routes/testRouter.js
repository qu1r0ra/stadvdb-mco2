import { Router } from "express";
import { nodeStatus } from "../config/db.js";
import { testConcurrentReads, testReadWrite, testWriteWrite } from "../services/simulationService.js";

const router = Router();

// Toggle Node Status (Kill/Revive)
router.post("/node-status", (req, res) => {
    const { node, status } = req.body;
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
    // We grab the whole body as 'options' to pass ID, name, etc.
    const { caseId, isolationLevel, ...options } = req.body;

    try {
        let result;
        // PASS 'options' AS THE SECOND ARGUMENT
        if (caseId === 1) result = await testConcurrentReads(isolationLevel, options);
        if (caseId === 2) result = await testReadWrite(isolationLevel, options);
        if (caseId === 3) result = await testWriteWrite(isolationLevel, options);

        res.json({ success: true, result });
    } catch (err) {
        console.error("Test Error:", err);
        res.status(500).json({ error: err.message });
    }
});

export default router;