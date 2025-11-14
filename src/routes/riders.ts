import { Router, Request, Response } from "express";
import { insertRider, getAllRiders } from "../services/ridersService";

const router = Router();

// GET all riders (fallback: node1 → node2 → node3)
router.get("/", async (_req: Request, res: Response) => {
  try {
    const riders = await getAllRiders();
    res.json(riders);
  } catch (err) {
    res.status(500).json({ error: "Failed to retrieve riders" });
  }
});

// POST create a new rider
router.post("/", async (req: Request, res: Response) => {
  try {
    const data = req.body;

    if (!data.courierName || !data.firstName || !data.lastName) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const result = await insertRider(data);
    res.status(201).json(result);
  } catch (err) {
    console.error("Insert error:", err);
    res.status(500).json({ error: "Failed to insert rider" });
  }
});

export default router;
