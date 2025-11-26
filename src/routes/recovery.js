import { Router } from "express";
import { recoverNodes } from "../services/recoveryService.js";

const router = Router();

router.post("/", async (_req, res) => {
  try {
    const report = await recoverNodes();
    res.json(report);
  } catch (err) {
    console.error("Recovery error:", err);
    res.status(500).json({ error: "Recovery process failed" });
  }
});

router.get("/status", (_req, res) => {
  res.json({ status: "ready" });
});

export default router;
