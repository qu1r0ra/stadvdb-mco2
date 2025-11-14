import { Router, Request, Response } from "express";
import { recoverNodes } from "../services/recoveryService";

const router = Router();

// POST trigger recovery process
router.post("/", async (_req: Request, res: Response) => {
  try {
    const report = await recoverNodes();
    res.json(report);
  } catch (err) {
    console.error("Recovery error:", err);
    res.status(500).json({ error: "Recovery process failed" });
  }
});

// Optional: GET recovery status without executing recovery
router.get("/status", async (_req: Request, res: Response) => {
  try {
    res.json({ status: "ready" });
  } catch (err) {
    res.status(500).json({ error: "Failed to check recovery status" });
  }
});

export default router;
