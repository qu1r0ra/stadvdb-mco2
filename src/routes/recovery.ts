import { Router, Request, Response } from "express";
import { recoverNodes } from "../services/recoveryService";

const router = Router();

router.post("/", async (_req: Request, res: Response) => {
  try {
    const report = await recoverNodes();
    res.json(report);
  } catch (err) {
    console.error("Recovery error:", err);
    res.status(500).json({ error: "Recovery process failed" });
  }
});

router.get("/status", (_req: Request, res: Response) => {
  res.json({ status: "ready" });
});

export default router;
